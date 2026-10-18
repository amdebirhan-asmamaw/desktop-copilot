import { contextBridge, ipcRenderer, clipboard } from 'electron';

export interface GhostStreamStartPayload {
  requestId: string;
  question: string;
  isDemo?: boolean;
}

export interface GhostStreamChunkPayload {
  requestId: string;
  text: string;
}

export interface GhostStreamEndPayload {
  requestId: string;
  fullAnswer?: string;
}

export interface GhostStreamErrorPayload {
  requestId: string;
  error: { code: string; message: string };
}

export interface TranscriptEventPayload {
  text: string;
  isFinal: boolean;
  speaker: 'USER' | 'REMOTE_SPEAKER';
  timestamp: number;
}

export interface ElectronCopilotApi {
  setOverlayMode: (mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => Promise<void>;
  getOverlayMode: () => Promise<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>;
  onOverlayModeChanged: (callback: (mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void;
  onGhostStreamStart: (callback: (data: GhostStreamStartPayload) => void) => () => void;
  onGhostStreamChunk: (callback: (data: GhostStreamChunkPayload) => void) => () => void;
  onGhostStreamEnd: (callback: (data: GhostStreamEndPayload) => void) => () => void;
  onGhostStreamError: (callback: (data: GhostStreamErrorPayload) => void) => () => void;
  onTranscriptEvent: (callback: (data: TranscriptEventPayload) => void) => () => void;
  createSession: (initialContext: unknown) => Promise<unknown>;
  getSession: (sessionId: string) => Promise<unknown>;
  feedTranscript: (payload: {
    sessionId?: string;
    speaker: 'USER' | 'REMOTE_SPEAKER';
    text: string;
    isFinal?: boolean;
  }) => Promise<void>;
  captureScreenSnapshot: () => Promise<{
    success: boolean;
    dataUrl?: string;
    width?: number;
    height?: number;
    error?: string;
  }>;
  cancelActiveRequest: () => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  getProviderStatus: () => Promise<{ provider: string; model: string; isDemo: boolean }>;
  setHudSize: (size: { width: number; height: number }) => Promise<void>;
}

const api: ElectronCopilotApi = {
  setOverlayMode: (mode) => ipcRenderer.invoke('overlay:set-mode', mode),
  getOverlayMode: () => ipcRenderer.invoke('overlay:get-mode'),
  onOverlayModeChanged: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => callback(mode);
    ipcRenderer.on('overlay:mode-changed', handler);
    return () => ipcRenderer.removeListener('overlay:mode-changed', handler);
  },
  onGhostStreamStart: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, data: GhostStreamStartPayload) => callback(data);
    ipcRenderer.on('ghost:stream-start', handler);
    return () => ipcRenderer.removeListener('ghost:stream-start', handler);
  },
  onGhostStreamChunk: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, data: GhostStreamChunkPayload) => callback(data);
    ipcRenderer.on('ghost:stream-chunk', handler);
    return () => ipcRenderer.removeListener('ghost:stream-chunk', handler);
  },
  onGhostStreamEnd: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, data: GhostStreamEndPayload) => callback(data);
    ipcRenderer.on('ghost:stream-end', handler);
    return () => ipcRenderer.removeListener('ghost:stream-end', handler);
  },
  onGhostStreamError: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, data: GhostStreamErrorPayload) => callback(data);
    ipcRenderer.on('ghost:stream-error', handler);
    return () => ipcRenderer.removeListener('ghost:stream-error', handler);
  },
  onTranscriptEvent: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, data: TranscriptEventPayload) => callback(data);
    ipcRenderer.on('transcript:event', handler);
    return () => ipcRenderer.removeListener('transcript:event', handler);
  },
  createSession: (initialContext) => ipcRenderer.invoke('session:create', initialContext),
  getSession: (sessionId) => ipcRenderer.invoke('session:get', sessionId),
  feedTranscript: (payload) => ipcRenderer.invoke('session:feed-transcript', payload),
  captureScreenSnapshot: () => ipcRenderer.invoke('screen:capture-snapshot'),
  cancelActiveRequest: () => ipcRenderer.invoke('pipeline:cancel-active'),
  copyToClipboard: async (text: string) => {
    clipboard.writeText(text);
  },
  getProviderStatus: () => ipcRenderer.invoke('provider:status'),
  setHudSize: (size) => ipcRenderer.invoke('hud:set-size', size)
};

contextBridge.exposeInMainWorld('copilotApi', api);
