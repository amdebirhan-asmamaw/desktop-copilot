export type CaptureHealth = 'CONNECTED' | 'NO_AUDIO_TRACK' | 'STALLED' | 'PERMISSION_DENIED';
export type SpeechState = 'SPEAKING' | 'IDLE';
export type TranscriptionState = 'IDLE' | 'TRANSCRIBING' | 'ERROR';

export interface ChannelTelemetry {
  source: 'MICROPHONE' | 'SYSTEM_LOOPBACK';
  health: CaptureHealth;
  currentRms: number;
  peakRms: number;
  totalFrames: number;
  nonZeroFrames: number;
  lastSignalTimestampMs: number;
  speechState: SpeechState;
  transcriptionState: TranscriptionState;
}

export class AudioCaptureDiagnostics {
  private micTelemetry: ChannelTelemetry = {
    source: 'MICROPHONE',
    health: 'CONNECTED',
    currentRms: 0,
    peakRms: 0,
    totalFrames: 0,
    nonZeroFrames: 0,
    lastSignalTimestampMs: 0,
    speechState: 'IDLE',
    transcriptionState: 'IDLE'
  };

  private loopbackTelemetry: ChannelTelemetry = {
    source: 'SYSTEM_LOOPBACK',
    health: 'CONNECTED',
    currentRms: 0,
    peakRms: 0,
    totalFrames: 0,
    nonZeroFrames: 0,
    lastSignalTimestampMs: 0,
    speechState: 'IDLE',
    transcriptionState: 'IDLE'
  };

  recordFrame(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', rms: number): void {
    const t = source === 'MICROPHONE' ? this.micTelemetry : this.loopbackTelemetry;
    t.totalFrames++;
    t.currentRms = Math.round(rms * 1000) / 1000;
    if (rms > t.peakRms) {
      t.peakRms = Math.round(rms * 1000) / 1000;
    }
    if (rms > 0.001) {
      t.nonZeroFrames++;
      t.lastSignalTimestampMs = Date.now();
    }
  }

  setHealth(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', health: CaptureHealth): void {
    const t = source === 'MICROPHONE' ? this.micTelemetry : this.loopbackTelemetry;
    t.health = health;
  }

  setSpeechState(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', state: SpeechState): void {
    const t = source === 'MICROPHONE' ? this.micTelemetry : this.loopbackTelemetry;
    t.speechState = state;
  }

  setTranscriptionState(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', state: TranscriptionState): void {
    const t = source === 'MICROPHONE' ? this.micTelemetry : this.loopbackTelemetry;
    t.transcriptionState = state;
  }

  getTelemetry(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK'): ChannelTelemetry {
    const t = source === 'MICROPHONE' ? this.micTelemetry : this.loopbackTelemetry;
    return { ...t };
  }

  getCombinedTelemetry(): { remote: ChannelTelemetry; mic: ChannelTelemetry } {
    return {
      remote: { ...this.loopbackTelemetry },
      mic: { ...this.micTelemetry }
    };
  }
}
