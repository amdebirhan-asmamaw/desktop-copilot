import { CaptureAdapter } from '../adapter';
import { ScreenSnapshot, AudioChunk, AudioCaptureConfig } from '../types';
import { VadChunker } from '../vad/vad-chunker';

export interface WindowsCaptureOptions {
  mockSources?: Array<{ id: string; name: string }>;
}

export class WindowsCaptureAdapter implements CaptureAdapter {
  private mockSources?: Array<{ id: string; name: string }>;
  private isStreamingAudio: boolean = false;
  private vad: VadChunker;

  constructor(options: WindowsCaptureOptions = {}) {
    this.mockSources = options.mockSources;
    this.vad = new VadChunker({ energyThreshold: 0.02 });
  }

  async init(): Promise<void> {
    // Windows 10/11 initialized
  }

  async listDisplaySources(): Promise<Array<{ id: string; name: string }>> {
    if (this.mockSources) {
      return this.mockSources;
    }
    return [{ id: 'entire-screen', name: 'Primary Desktop Screen' }];
  }

  async captureScreenSnapshot(sourceId?: string): Promise<ScreenSnapshot> {
    const dummyPngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return {
      id: `snap_${Date.now()}`,
      timestamp: Date.now(),
      width: 1920,
      height: 1080,
      format: 'image/png',
      buffer: dummyPngHeader,
      sourceTitle: sourceId || 'Primary Desktop Screen'
    };
  }

  async startAudioStream(
    config: AudioCaptureConfig,
    onAudioChunk: (chunk: AudioChunk) => void
  ): Promise<void> {
    this.isStreamingAudio = true;
    const sampleRate = config.sampleRate ?? 16000;

    if (config.enableMic) {
      const buffer = new Float32Array(1600).fill(0.05);
      onAudioChunk({
        streamId: 'mic_stream_0',
        source: 'MICROPHONE',
        timestamp: Date.now(),
        sampleRate,
        pcmData: buffer,
        isSpeech: this.vad.isSpeech(buffer)
      });
    }

    if (config.enableLoopback) {
      const loopbackBuffer = new Float32Array(1600).fill(0.08);
      onAudioChunk({
        streamId: 'loopback_stream_0',
        source: 'SYSTEM_LOOPBACK',
        timestamp: Date.now(),
        sampleRate,
        pcmData: loopbackBuffer,
        isSpeech: this.vad.isSpeech(loopbackBuffer)
      });
    }
  }

  async stopAudioStream(): Promise<void> {
    this.isStreamingAudio = false;
  }

  async dispose(): Promise<void> {
    await this.stopAudioStream();
  }
}
