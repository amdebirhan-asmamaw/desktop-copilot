import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronCopilotApi {
  setOverlayMode: (mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => Promise<void>;
  getOverlayMode: () => Promise<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>;
  onOverlayModeChanged: (callback: (mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void;
  sendGhostTextChunk: (text: string) => void;
  onGhostTextChunk: (callback: (text: string) => void) => () => void;
  createSession: (initialContext: unknown) => Promise<unknown>;
  getSession: (sessionId: string) => Promise<unknown>;
  feedTranscript: (payload: { sessionId?: string; speaker: 'USER' | 'REMOTE_SPEAKER'; text: string }) => Promise<void>;
}

const api: ElectronCopilotApi = {
  setOverlayMode: (mode) => ipcRenderer.invoke('overlay:set-mode', mode),
  getOverlayMode: () => ipcRenderer.invoke('overlay:get-mode'),
  onOverlayModeChanged: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => callback(mode);
    ipcRenderer.on('overlay:mode-changed', handler);
    return () => ipcRenderer.removeListener('overlay:mode-changed', handler);
  },
  sendGhostTextChunk: (text) => ipcRenderer.send('ghost:stream-chunk', text),
  onGhostTextChunk: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on('ghost:stream-chunk', handler);
    return () => ipcRenderer.removeListener('ghost:stream-chunk', handler);
  },
  createSession: (initialContext) => ipcRenderer.invoke('session:create', initialContext),
  getSession: (sessionId) => ipcRenderer.invoke('session:get', sessionId),
  feedTranscript: (payload) => ipcRenderer.invoke('session:feed-transcript', payload)
};

contextBridge.exposeInMainWorld('copilotApi', api);
