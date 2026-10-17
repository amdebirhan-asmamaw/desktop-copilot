import { BrowserWindow } from 'electron';
import * as path from 'path';

export function createHudWindow(rendererUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadURL(`${rendererUrl}/hud`);
  return win;
}
