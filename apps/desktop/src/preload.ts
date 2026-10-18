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
  copyToClipboard: (text: string) => Promise<boolean>;
  getProviderStatus: () => Promise<{ provider: string; model: string; isDemo: boolean }>;
  setHudSize: (size: { width: number; height: number }) => Promise<void>;
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
  setWindowPosition: (x: number, y: number) => Promise<void>;
  getWindowPosition: () => Promise<{ x: number; y: number }>;
  onAdjustOpacity: (callback: (delta: number) => void) => () => void;
  setWindowOpacity: (opacity: number) => Promise<void>;
  toggleVisibility: () => Promise<void>;
  retryQuestion: (question?: string) => Promise<void>;
  onAudioLevels: (callback: (levels: number[]) => void) => () => void;
  feedAudioPcm: (source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void;
  getSystemAudioSourceId: () => Promise<string | null>;
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
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  getProviderStatus: () => ipcRenderer.invoke('provider:status'),
  setHudSize: (size) => ipcRenderer.invoke('hud:set-size', size),
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('overlay:set-ignore-mouse-events', ignore, options);
  },
  setWindowPosition: (x, y) => ipcRenderer.invoke('window:set-position', { x, y }),
  getWindowPosition: () => ipcRenderer.invoke('window:get-position'),
  onAdjustOpacity: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, delta: number) => callback(delta);
    ipcRenderer.on('hud:adjust-opacity', handler);
    return () => ipcRenderer.removeListener('hud:adjust-opacity', handler);
  },
  setWindowOpacity: (opacity) => ipcRenderer.invoke('hud:set-opacity', opacity),
  toggleVisibility: () => ipcRenderer.invoke('overlay:toggle-visibility'),
  retryQuestion: (question) => ipcRenderer.invoke('question:retry', question),
  onAudioLevels: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, levels: number[]) => callback(levels);
    ipcRenderer.on('hud:audio-levels', handler);
    return () => ipcRenderer.removeListener('hud:audio-levels', handler);
  },
  feedAudioPcm: (source, pcm) => ipcRenderer.send('audio:feed-pcm', { source, pcm }),
  getSystemAudioSourceId: () => ipcRenderer.invoke('audio:get-system-source-id')
};

contextBridge.exposeInMainWorld('copilotApi', api);
