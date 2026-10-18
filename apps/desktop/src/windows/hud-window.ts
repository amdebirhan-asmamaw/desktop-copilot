import { BrowserWindow } from 'electron';
import * as path from 'path';

export function createHudWindow(rendererUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 640,
    height: 95,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    icon: [
      path.resolve(__dirname, '../resources/icon.ico'),
      path.resolve(__dirname, '../../resources/icon.ico')
    ].find((p) => require('fs').existsSync(p)),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (rendererUrl.startsWith('http://') || rendererUrl.startsWith('https://')) {
    win.loadURL(`${rendererUrl}/hud`);
  } else {
    win.loadFile(rendererUrl, { hash: 'hud' });
  }
  return win;
}
