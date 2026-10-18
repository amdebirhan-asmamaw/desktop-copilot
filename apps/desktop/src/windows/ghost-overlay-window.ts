import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

export function createGhostOverlayWindow(rendererUrl: string): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Start in PASSIVE click-through mode
  win.setIgnoreMouseEvents(true, { forward: true });
  if (rendererUrl.startsWith('http://') || rendererUrl.startsWith('https://')) {
    win.loadURL(`${rendererUrl}/ghost`);
  } else {
    win.loadFile(rendererUrl, { hash: 'ghost' });
  }
  return win;
}
