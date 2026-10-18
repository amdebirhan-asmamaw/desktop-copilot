import { TranscriptEvent } from '../types';
import { DeepgramStreamingSession } from './deepgram-streaming-session';

export interface StreamCoordinatorOptions {
  apiKey: string;
  model?: string;
  onInterim: (text: string, speaker: 'USER' | 'REMOTE_SPEAKER') => void;
  onFinalUtterance: (event: TranscriptEvent) => void;
  onError?: (err: Error) => void;
  onStatusChange?: (source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED') => void;
}

export class DeepgramStreamCoordinator {
  private micSession: DeepgramStreamingSession;
  private loopbackSession: DeepgramStreamingSession;

  constructor(options: StreamCoordinatorOptions) {
    this.micSession = new DeepgramStreamingSession({
      apiKey: options.apiKey,
      speaker: 'USER',
      model: options.model,
      onInterim: (text) => options.onInterim(text, 'USER'),
      onFinalUtterance: options.onFinalUtterance,
      onError: options.onError,
      onStatusChange: (status) => options.onStatusChange?.('MICROPHONE', status)
    });

    this.loopbackSession = new DeepgramStreamingSession({
      apiKey: options.apiKey,
      speaker: 'REMOTE_SPEAKER',
      model: options.model,
      onInterim: (text) => options.onInterim(text, 'REMOTE_SPEAKER'),
      onFinalUtterance: options.onFinalUtterance,
      onError: options.onError,
      onStatusChange: (status) => options.onStatusChange?.('SYSTEM_LOOPBACK', status)
    });
  }

  connect(): void {
    this.micSession.connect();
    this.loopbackSession.connect();
  }

  feedPcm(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcmFloat32: Float32Array): void {
    if (pcmFloat32.length === 0) return;
    const int16 = new Int16Array(pcmFloat32.length);
    for (let i = 0; i < pcmFloat32.length; i++) {
      const s = Math.max(-1, Math.min(1, pcmFloat32[i] ?? 0));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const buffer = Buffer.from(int16.buffer);

    if (source === 'MICROPHONE') {
      this.micSession.sendAudio(buffer);
    } else {
      this.loopbackSession.sendAudio(buffer);
    }
  }

  close(): void {
    this.micSession.close();
    this.loopbackSession.close();
  }
}
