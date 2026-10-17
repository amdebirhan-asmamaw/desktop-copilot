import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import * as path from 'path';
import { createHudWindow } from './windows/hud-window.js';
import { createGhostOverlayWindow } from './windows/ghost-overlay-window.js';
import { SessionManager, JsonSessionStore, isQuestionIntent } from '@repo/core';
import { ConfigurableChatStreamingService } from '@repo/ai';

let hudWin: BrowserWindow | null = null;
let ghostWin: BrowserWindow | null = null;
let currentMode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN' = 'PASSIVE';

const rendererUrl = process.env.RENDERER_URL || 'http://localhost:5173';

const storagePath = path.join(app.getPath('userData'), 'copilot-sessions.json');
const sessionManager = new SessionManager(new JsonSessionStore(storagePath));

const chatService = new ConfigurableChatStreamingService({
  provider: 'mock',
  model: 'custom-streaming-model',
  apiKey: 'local'
});

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

app.whenReady().then(() => {
  ghostWin = createGhostOverlayWindow(rendererUrl);
  hudWin = createHudWindow(rendererUrl);

  // Global Hotkey 1: Privacy/Panic Hide Toggle (Ctrl+Shift+H)
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    applyOverlayMode(currentMode === 'HIDDEN' ? 'PASSIVE' : 'HIDDEN');
  });

  // Global Hotkey 2: Passive / Interactive Mode Toggle (Ctrl+Shift+I)
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (currentMode === 'HIDDEN') return;
    applyOverlayMode(currentMode === 'PASSIVE' ? 'INTERACTIVE' : 'PASSIVE');
  });

  // IPC Handlers
  ipcMain.handle('overlay:set-mode', (_, mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => applyOverlayMode(mode));
  ipcMain.handle('overlay:get-mode', () => currentMode);

  ipcMain.on('ghost:stream-chunk', (_, text: string) => {
    ghostWin?.webContents.send('ghost:stream-chunk', text);
  });

  ipcMain.handle('session:feed-transcript', async (_, { sessionId, speaker, text }) => {
    return handleIncomingTranscript(sessionId, speaker, text);
  });

  ipcMain.handle('session:create', async (_, initialContext) => {
    return sessionManager.createSession(initialContext);
  });

  ipcMain.handle('session:get', async (_, sessionId: string) => {
    return sessionManager.getSession(sessionId);
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
