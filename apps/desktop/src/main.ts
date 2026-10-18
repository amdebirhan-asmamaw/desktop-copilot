import { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen, clipboard, Menu, session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHudWindow } from './windows/hud-window.js';
import { SessionManager, JsonSessionStore, OrchestrationPipeline } from '@repo/core';
import { createChatProvider, loadAIConfigFromEnv, ConfigurableSTTService } from '@repo/ai';
import { validateScreenSnapshot, createBase64DataUrl, DualAudioStreamManager } from '@repo/capture';

// Ensure clean application name and isolated user data directory (avoids scoped package name / Windows cache errors)
app.setName('desktop-copilot');
const appDataRoot = app.getPath('appData');
const userDataDir = path.join(appDataRoot, 'desktop-copilot');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}
app.setPath('userData', userDataDir);

// Prevent multiple simultaneous Electron instances from colliding on Chromium disk cache
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Automatically load .env file if present in workspace root or app directory
const possibleEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../../.env'),
  path.resolve(__dirname, '../../../.env')
];

function loadEnvFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(filePath);
      return true;
    } catch {
      // fallback to manual parse if process.loadEnvFile encounters syntax errors
    }
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

for (const p of possibleEnvPaths) {
  if (loadEnvFile(p)) {
    break;
  }
}

let hudWin: BrowserWindow | null = null;
let currentMode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN' = 'PASSIVE';

async function resolveRendererUrl(): Promise<string> {
  const configuredUrl = process.env.RENDERER_URL;
  if (configuredUrl) {
    return configuredUrl;
  }

  const localDistIndex = [
    path.resolve(__dirname, '../overlay/index.html'),
    path.resolve(__dirname, 'overlay/index.html'),
    path.resolve(__dirname, '../../overlay/dist/index.html'),
    path.resolve(process.cwd(), 'apps/overlay/dist/index.html'),
    path.resolve(process.cwd(), '../overlay/dist/index.html')
  ].find((candidate) => fs.existsSync(candidate));

  if (app.isPackaged && localDistIndex) {
    return localDistIndex;
  }

  // In development, probe Vite dev server first
  const devUrl = 'http://localhost:5173';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const res = await fetch(devUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok || res.status < 500) {
      return devUrl;
    }
  } catch {
    // Live server is not running; fall back to local dist
  }

  return localDistIndex || devUrl;
}

const storagePath = path.join(app.getPath('userData'), 'copilot-sessions.json');
const sessionManager = new SessionManager(new JsonSessionStore(storagePath));

const aiConfig = loadAIConfigFromEnv();
const chatProvider = createChatProvider(aiConfig);
const sttService = new ConfigurableSTTService(aiConfig.capabilities.stt);
const audioManager = new DualAudioStreamManager();
const pipeline = new OrchestrationPipeline();
let lastAttemptedQuestion: string = '';

async function captureCurrentScreenBase64(): Promise<string | undefined> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    });
    if (!sources || sources.length === 0) return undefined;
    const primary = sources[0]!;
    const jpegBuffer = primary.thumbnail.toJPEG(75);
    return jpegBuffer.toString('base64');
  } catch (err) {
    console.warn('[Screen] Failed to capture screen snapshot for question context:', err);
    return undefined;
  }
}

export async function triggerQuestionAnswer(
  sessionId: string,
  question: string,
  retryAttempt: number = 0
): Promise<void> {
  lastAttemptedQuestion = question;
  const activeReq = pipeline.beginRequest(question);

  // Multimodal screen context: Capture active screen snapshot
  const screenBase64 = await captureCurrentScreenBase64();
  if (screenBase64) {
    await sessionManager.addSnapshotRef(sessionId, {
      sourceTitle: 'Active Screen Display',
      base64Jpeg: screenBase64
    });
  }

  const payload = await sessionManager.assembleContextPayload(sessionId);

  const startPayload = {
    requestId: activeReq.requestId,
    question,
    isDemo: chatProvider.id === 'demo'
  };
  hudWin?.webContents.send('ghost:stream-start', startPayload);

  let accumulatedText = '';

  try {
    for await (const event of chatProvider.streamAnswer(payload, question, {
      signal: activeReq.signal,
      requestId: activeReq.requestId
    })) {
      if (pipeline.getActiveRequestId() !== activeReq.requestId) {
        break;
      }

      if (event.type === 'text-delta') {
        accumulatedText += event.text;
        const chunkPayload = {
          requestId: activeReq.requestId,
          text: event.text
        };
        hudWin?.webContents.send('ghost:stream-chunk', chunkPayload);
      } else if (event.type === 'error') {
        const isTransient =
          event.error.code.includes('429') ||
          event.error.code.includes('503') ||
          event.error.code.includes('RATE_LIMIT') ||
          event.error.code.includes('NETWORK');
        if (isTransient && retryAttempt < 1 && !activeReq.signal.aborted) {
          console.warn(`[Orchestrator] Transient error encountered (${event.error.code}), auto-retrying in 1200ms...`);
          await new Promise((r) => setTimeout(r, 1200));
          if (!activeReq.signal.aborted) {
            return triggerQuestionAnswer(sessionId, question, retryAttempt + 1);
          }
        }

        const errPayload = {
          requestId: activeReq.requestId,
          question,
          error: event.error
        };
        hudWin?.webContents.send('ghost:stream-error', errPayload);
        return;
      } else if (event.type === 'complete') {
        const endPayload = {
          requestId: activeReq.requestId,
          fullAnswer: accumulatedText
        };
        hudWin?.webContents.send('ghost:stream-end', endPayload);
        await sessionManager.appendTranscript(sessionId, {
          speaker: 'ASSISTANT',
          text: accumulatedText
        });
        return;
      }
    }
  } catch (err: unknown) {
    if (!activeReq.signal.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient =
        message.includes('429') ||
        message.includes('503') ||
        message.includes('fetch') ||
        message.includes('timeout') ||
        message.includes('ECONNRESET');
      if (isTransient && retryAttempt < 1) {
        console.warn(`[Orchestrator] Caught transient network error, auto-retrying in 1200ms...`);
        await new Promise((r) => setTimeout(r, 1200));
        if (!activeReq.signal.aborted) {
          return triggerQuestionAnswer(sessionId, question, retryAttempt + 1);
        }
      }

      const errPayload = {
        requestId: activeReq.requestId,
        question,
        error: { code: 'STREAM_FAILED', message }
      };
      hudWin?.webContents.send('ghost:stream-error', errPayload);
    }
  }
}

export async function handleIncomingTranscript(
  sessionId: string,
  speaker: 'USER' | 'REMOTE_SPEAKER',
  text: string,
  isFinal: boolean = true
): Promise<void> {
  hudWin?.webContents.send('transcript:event', {
    speaker,
    text,
    isFinal,
    timestamp: Date.now()
  });

  await sessionManager.appendTranscript(sessionId, { speaker, text });

  const decision = pipeline.processTranscriptChunk({
    speaker,
    text,
    isFinal,
    timestamp: Date.now()
  });

  if (decision.shouldTriggerAnswer && decision.question) {
    await triggerQuestionAnswer(sessionId, decision.question);
  }
}

export function applyOverlayMode(mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'): void {
  currentMode = mode;

  if (hudWin && !hudWin.isDestroyed()) {
    switch (mode) {
      case 'HIDDEN':
        hudWin.hide();
        break;
      case 'PASSIVE':
        hudWin.showInactive();
        hudWin.setIgnoreMouseEvents(true, { forward: true });
        hudWin.setFocusable(false);
        break;
      case 'INTERACTIVE':
        hudWin.show();
        hudWin.setIgnoreMouseEvents(false);
        hudWin.setFocusable(true);
        hudWin.focus();
        break;
    }
    hudWin.webContents.send('overlay:mode-changed', mode);
  }
}

let activeSessionId: string | null = null;

app.on('second-instance', () => {
  if (hudWin && !hudWin.isDestroyed()) {
    if (hudWin.isMinimized()) hudWin.restore();
    hudWin.focus();
  }
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(true);
  });

  const targetUrl = await resolveRendererUrl();
  hudWin = createHudWindow(targetUrl);

  const initialSession = await sessionManager.createSession({
    roleOrPersona: 'Senior Distributed Systems Architect',
    instructions: 'Deliver a spoken-ready conversational sentence opening with 5-7 concrete technical terms, followed by 2-3 key trade-off bullet points. Zero conversational filler.'
  });
  activeSessionId = initialSession.sessionId;

  // Global Hotkey 1: Privacy/Hide Toggle (Ctrl+Shift+H) - remembers previous mode
  let previousModeBeforeHide: 'PASSIVE' | 'INTERACTIVE' = 'INTERACTIVE';
  const toggleVisibility = () => {
    if (currentMode === 'HIDDEN') {
      applyOverlayMode(previousModeBeforeHide);
    } else {
      previousModeBeforeHide = currentMode === 'PASSIVE' ? 'PASSIVE' : 'INTERACTIVE';
      applyOverlayMode('HIDDEN');
    }
  };

  const privacyHotkey = process.env.HOTKEY_PRIVACY_TOGGLE || 'CommandOrControl+Shift+H';
  globalShortcut.register(privacyHotkey, toggleVisibility);

  // Global Hotkey 2: Passive / Interactive Mode Toggle (Ctrl+Shift+I)
  const interactiveHotkey = process.env.HOTKEY_INTERACTIVE_TOGGLE || 'CommandOrControl+Shift+I';
  globalShortcut.register(interactiveHotkey, () => {
    if (currentMode === 'HIDDEN') return;
    applyOverlayMode(currentMode === 'PASSIVE' ? 'INTERACTIVE' : 'PASSIVE');
  });

  // Global Hotkey 3: Opacity Decrease (Ctrl+Shift+[)
  globalShortcut.register('CommandOrControl+Shift+[', () => {
    hudWin?.webContents.send('hud:adjust-opacity', -0.05);
  });

  // Global Hotkey 4: Opacity Increase (Ctrl+Shift+])
  globalShortcut.register('CommandOrControl+Shift+]', () => {
    hudWin?.webContents.send('hud:adjust-opacity', +0.05);
  });

  // Global Hotkey 5: Demo Q&A Trigger (Ctrl+Shift+T)
  const demoHotkey = process.env.HOTKEY_DEMO_TRIGGER || 'CommandOrControl+Shift+T';
  globalShortcut.register(demoHotkey, () => {
    if (activeSessionId) {
      handleIncomingTranscript(
        activeSessionId,
        'REMOTE_SPEAKER',
        'How do you handle network partitions and split-brain scenarios in a distributed cluster?',
        true
      );
    }
  });

  // Application menu with Edit commands (enables native Ctrl+C / Ctrl+V / Ctrl+A in Windows frameless windows)
  const editMenuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(editMenuTemplate));

  // IPC Handlers
  ipcMain.handle('overlay:set-mode', (_, mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => applyOverlayMode(mode));
  ipcMain.handle('overlay:get-mode', () => currentMode);
  ipcMain.handle('overlay:toggle-visibility', () => toggleVisibility());
  ipcMain.handle('hud:set-opacity', (_, opacity: number) => {
    if (!hudWin || hudWin.isDestroyed()) return;
    const clamped = Math.max(0.70, Math.min(1.0, opacity));
    hudWin.setOpacity(clamped);
  });
  ipcMain.handle('question:retry', async (_, question?: string) => {
    if (activeSessionId) {
      const q = question || lastAttemptedQuestion;
      if (q) {
        await triggerQuestionAnswer(activeSessionId, q);
      }
    }
  });

  ipcMain.on('overlay:set-ignore-mouse-events', (event, ignore: boolean, options?: { forward: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, options);
    }
  });

  // Native Clipboard write handler (OS-level, unconstrained)
  ipcMain.handle('clipboard:write', (_, text: string) => {
    try {
      clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('clipboard.writeText failed in main:', err);
      return false;
    }
  });

  // Window position handlers for smooth dragging
  ipcMain.handle('window:set-position', (_, { x, y }: { x: number; y: number }) => {
    if (!hudWin || hudWin.isDestroyed()) return;
    hudWin.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.handle('window:get-position', () => {
    if (!hudWin || hudWin.isDestroyed()) return { x: 0, y: 0 };
    const [x, y] = hudWin.getPosition();
    return { x, y };
  });

  let hudOriginalY: number | null = null;

  ipcMain.handle('hud:set-size', (_, { width, height }: { width: number; height: number }) => {
    if (!hudWin || hudWin.isDestroyed()) return;
    const currentBounds = hudWin.getBounds();
    const targetW = Math.max(300, Math.round(width));
    const targetH = Math.max(60, Math.round(height));

    const currentDisplay = screen.getDisplayMatching(currentBounds);
    let newY = currentBounds.y;

    if (targetH > 200) {
      // Expanding for modal
      if (hudOriginalY === null) {
        hudOriginalY = currentBounds.y;
      }
      if (currentDisplay) {
        const maxY = currentDisplay.workArea.y + currentDisplay.workArea.height - targetH;
        if (newY > maxY) {
          newY = Math.max(currentDisplay.workArea.y, maxY);
        }
      }
    } else {
      // Collapsing back to compact HUD
      if (hudOriginalY !== null) {
        newY = hudOriginalY;
        hudOriginalY = null;
      }
      if (currentDisplay) {
        const maxY = currentDisplay.workArea.y + currentDisplay.workArea.height - targetH;
        if (newY > maxY) {
          newY = Math.max(currentDisplay.workArea.y, maxY);
        }
      }
    }

    hudWin.setBounds({
      x: currentBounds.x,
      y: newY,
      width: targetW,
      height: targetH
    });
  });

  ipcMain.handle('pipeline:cancel-active', () => {
    const activeId = pipeline.getActiveRequestId();
    if (activeId) {
      pipeline.cancelActive('user_requested');
      hudWin?.webContents.send('ghost:stream-cancel', { requestId: activeId });
    }
  });

  ipcMain.handle('provider:status', () => ({
    provider: chatProvider.id,
    model: chatProvider.model,
    isDemo: chatProvider.id === 'demo'
  }));

  ipcMain.handle('screen:capture-snapshot', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });

      if (!sources || sources.length === 0) {
        return { success: false, error: 'No display screens found' };
      }

      const primary = sources[0]!;
      const jpegBuffer = primary.thumbnail.toJPEG(80);
      const size = primary.thumbnail.getSize();

      const snapshot = {
        id: `snap_${Date.now()}`,
        timestamp: Date.now(),
        width: size.width,
        height: size.height,
        format: 'image/jpeg' as const,
        buffer: jpegBuffer,
        sourceTitle: primary.name
      };

      const validation = validateScreenSnapshot(snapshot);
      if (!validation.isValid) {
        return { success: false, error: validation.reason };
      }

      const dataUrl = createBase64DataUrl(snapshot);
      return { success: true, dataUrl, width: size.width, height: size.height };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('session:feed-transcript', async (_, { sessionId, speaker, text, isFinal }) => {
    const targetId = sessionId || activeSessionId;
    if (!targetId) return;
    return handleIncomingTranscript(targetId, speaker, text, isFinal ?? true);
  });

  ipcMain.handle('session:create', async (_, initialContext) => {
    const sess = await sessionManager.createSession(initialContext);
    activeSessionId = sess.sessionId;
    return sess;
  });

  ipcMain.handle('session:get', async (_, sessionId: string) => {
    return sessionManager.getSession(sessionId);
  });

  // Audio Stream & System Loopback IPC Handlers
  ipcMain.on('audio:feed-pcm', async (_, data: { source: 'MICROPHONE' | 'SYSTEM_LOOPBACK'; pcm: Float32Array | number[] }) => {
    try {
      const pcmArray = data.pcm instanceof Float32Array ? data.pcm : new Float32Array(data.pcm);
      audioManager.processRawPcmChunk(data.source, pcmArray, {
        onAudioLevels: (levels) => {
          if (hudWin && !hudWin.isDestroyed()) {
            hudWin.webContents.send('hud:audio-levels', levels);
          }
        },
        onSpeechSegment: async (segment) => {
          try {
            console.log(`[Audio] Detected speech segment from ${segment.source} (${segment.durationMs}ms), transcribing...`);
            const transcript = await sttService.transcribeWav(segment.wavBuffer, segment.source);
            if (transcript && transcript.text && transcript.text.trim().length > 0) {
              console.log(`[STT] ${transcript.speaker}: "${transcript.text}"`);
              if (activeSessionId) {
                await handleIncomingTranscript(activeSessionId, transcript.speaker, transcript.text, true);
              }
            }
          } catch (err) {
            console.error('[STT] Failed to transcribe speech segment:', err);
          }
        }
      });
    } catch (err) {
      console.error('[Audio] Error processing PCM chunk in main:', err);
    }
  });

  ipcMain.handle('audio:get-system-source-id', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return sources[0]?.id || null;
    } catch (err) {
      console.warn('[Audio] Failed to get system audio screen source:', err);
      return null;
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
