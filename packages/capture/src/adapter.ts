import { ScreenSnapshot, AudioChunk, AudioCaptureConfig } from './types';

export interface CaptureAdapter {
  init(): Promise<void>;
  listDisplaySources(): Promise<Array<{ id: string; name: string }>>;
  captureScreenSnapshot(sourceId?: string): Promise<ScreenSnapshot>;
  startAudioStream(
    config: AudioCaptureConfig,
    onAudioChunk: (chunk: AudioChunk) => void
  ): Promise<void>;
  stopAudioStream(): Promise<void>;
  dispose(): Promise<void>;
}
