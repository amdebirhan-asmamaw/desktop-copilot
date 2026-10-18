import { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHudWindow } from './windows/hud-window.js';
import { createGhostOverlayWindow } from './windows/ghost-overlay-window.js';
import { SessionManager, JsonSessionStore, OrchestrationPipeline } from '@repo/core';
import { createChatProvider, loadAIConfigFromEnv } from '@repo/ai';
import { validateScreenSnapshot, createBase64DataUrl } from '@repo/capture';

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
let ghostWin: BrowserWindow | null = null;
let currentMode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN' = 'PASSIVE';

async function resolveRendererUrl(): Promise<string> {
  const configuredUrl = process.env.RENDERER_URL || 'http://localhost:5173';
  if (configuredUrl.startsWith('http://') || configuredUrl.startsWith('https://')) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      const res = await fetch(configuredUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok || res.status < 500) {
        return configuredUrl;
      }
    } catch {
      // Live server is not running; fall back to local dist if available
    }
  }

  const localDistIndex = [
    path.resolve(__dirname, '../../overlay/dist/index.html'),
    path.resolve(process.cwd(), 'apps/overlay/dist/index.html'),
    path.resolve(process.cwd(), '../overlay/dist/index.html')
  ].find((candidate) => fs.existsSync(candidate));

  return localDistIndex || configuredUrl;
}

const storagePath = path.join(app.getPath('userData'), 'copilot-sessions.json');
const sessionManager = new SessionManager(new JsonSessionStore(storagePath));

const aiConfig = loadAIConfigFromEnv();
const chatProvider = createChatProvider(aiConfig);
const pipeline = new OrchestrationPipeline();

export async function triggerQuestionAnswer(sessionId: string, question: string): Promise<void> {
  const activeReq = pipeline.beginRequest(question);
  const payload = await sessionManager.assembleContextPayload(sessionId);

  ghostWin?.webContents.send('ghost:stream-start', {
    requestId: activeReq.requestId,
    question,
    isDemo: chatProvider.id === 'demo'
  });

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
        ghostWin?.webContents.send('ghost:stream-chunk', {
          requestId: activeReq.requestId,
          text: event.text
        });
      } else if (event.type === 'error') {
        ghostWin?.webContents.send('ghost:stream-error', {
          requestId: activeReq.requestId,
          error: event.error
        });
        return;
      } else if (event.type === 'complete') {
        ghostWin?.webContents.send('ghost:stream-end', {
          requestId: activeReq.requestId,
          fullAnswer: accumulatedText
        });
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
      ghostWin?.webContents.send('ghost:stream-error', {
        requestId: activeReq.requestId,
        error: { code: 'STREAM_FAILED', message }
      });
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
  if (!ghostWin || ghostWin.isDestroyed()) return;
  currentMode = mode;

  switch (mode) {
    case 'HIDDEN':
      ghostWin.hide();
      break;
    case 'PASSIVE':
      ghostWin.showInactive();
      ghostWin.setIgnoreMouseEvents(true, { forward: true });
      ghostWin.setFocusable(false);
      break;
    case 'INTERACTIVE':
      ghostWin.show();
      ghostWin.setIgnoreMouseEvents(false);
      ghostWin.setFocusable(true);
      ghostWin.focus();
      break;
  }

  hudWin?.webContents.send('overlay:mode-changed', mode);
  ghostWin.webContents.send('overlay:mode-changed', mode);
}

let activeSessionId: string | null = null;

app.on('second-instance', () => {
  if (hudWin && !hudWin.isDestroyed()) {
    if (hudWin.isMinimized()) hudWin.restore();
    hudWin.focus();
  }
});

app.whenReady().then(async () => {
  const targetUrl = await resolveRendererUrl();
  ghostWin = createGhostOverlayWindow(targetUrl);
  hudWin = createHudWindow(targetUrl);

  const initialSession = await sessionManager.createSession({
    roleOrPersona: 'Senior Distributed Systems Architect',
    instructions: 'Keep responses concise with structured bullet points and high-level trade-offs'
  });
  activeSessionId = initialSession.sessionId;

  // Global Hotkey 1: Privacy/Panic Hide Toggle (Ctrl+Shift+H)
  const privacyHotkey = process.env.HOTKEY_PRIVACY_TOGGLE || 'CommandOrControl+Shift+H';
  globalShortcut.register(privacyHotkey, () => {
    applyOverlayMode(currentMode === 'HIDDEN' ? 'PASSIVE' : 'HIDDEN');
  });

  // Global Hotkey 2: Passive / Interactive Mode Toggle (Ctrl+Shift+I)
  const interactiveHotkey = process.env.HOTKEY_INTERACTIVE_TOGGLE || 'CommandOrControl+Shift+I';
  globalShortcut.register(interactiveHotkey, () => {
    if (currentMode === 'HIDDEN') return;
    applyOverlayMode(currentMode === 'PASSIVE' ? 'INTERACTIVE' : 'PASSIVE');
  });

  // Global Hotkey 3: Demo Q&A Trigger (Ctrl+Shift+T)
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

  // IPC Handlers
  ipcMain.handle('overlay:set-mode', (_, mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => applyOverlayMode(mode));
  ipcMain.handle('overlay:get-mode', () => currentMode);

  ipcMain.handle('hud:set-size', (_, { width, height }: { width: number; height: number }) => {
    if (!hudWin || hudWin.isDestroyed()) return;
    const currentBounds = hudWin.getBounds();
    const targetW = Math.max(300, Math.round(width));
    const targetH = Math.max(60, Math.round(height));

    const currentDisplay = screen.getDisplayMatching(currentBounds);
    let newY = currentBounds.y;
    if (currentDisplay) {
      const maxY = currentDisplay.workArea.y + currentDisplay.workArea.height - targetH;
      if (newY > maxY) {
        newY = Math.max(currentDisplay.workArea.y, maxY);
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
      ghostWin?.webContents.send('ghost:stream-cancel', { requestId: activeId });
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
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
