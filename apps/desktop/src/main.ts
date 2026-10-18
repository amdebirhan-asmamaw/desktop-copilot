import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHudWindow } from './windows/hud-window.js';
import { createGhostOverlayWindow } from './windows/ghost-overlay-window.js';
import { SessionManager, JsonSessionStore, isQuestionIntent } from '@repo/core';
import { ConfigurableChatStreamingService, loadAIConfigFromEnv } from '@repo/ai';

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
const chatService = new ConfigurableChatStreamingService(aiConfig.capabilities.chatStreaming);

export async function handleIncomingTranscript(
  sessionId: string,
  speaker: 'USER' | 'REMOTE_SPEAKER',
  text: string
): Promise<void> {
  await sessionManager.appendTranscript(sessionId, { speaker, text });

  if (speaker === 'REMOTE_SPEAKER' && isQuestionIntent(text)) {
    const payload = await sessionManager.assembleContextPayload(sessionId);
    for await (const chunk of chatService.streamAnswer(payload, text)) {
      ghostWin?.webContents.send('ghost:stream-chunk', chunk);
    }
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
    instructions: 'Keep responses concise with structured bullet points'
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
        'How do you handle network partitions and split-brain scenarios in a distributed cluster?'
      );
    }
  });

  // IPC Handlers
  ipcMain.handle('overlay:set-mode', (_, mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => applyOverlayMode(mode));
  ipcMain.handle('overlay:get-mode', () => currentMode);

  ipcMain.on('ghost:stream-chunk', (_, text: string) => {
    ghostWin?.webContents.send('ghost:stream-chunk', text);
  });

  ipcMain.handle('session:feed-transcript', async (_, { sessionId, speaker, text }) => {
    const targetId = sessionId || activeSessionId;
    if (!targetId) return;
    return handleIncomingTranscript(targetId, speaker, text);
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
