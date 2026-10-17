export interface ScreenSnapshot {
  id: string;
  timestamp: number;
  width: number;
  height: number;
  format: 'image/png' | 'image/jpeg';
  buffer: Buffer;
  sourceTitle?: string;
}

export interface AudioChunk {
  streamId: string;
  source: 'MICROPHONE' | 'SYSTEM_LOOPBACK';
  timestamp: number;
  sampleRate: number;
  pcmData: Float32Array;
  isSpeech: boolean;
}

export interface AudioCaptureConfig {
  enableMic: boolean;
  enableLoopback: boolean;
  sampleRate?: number;
}
