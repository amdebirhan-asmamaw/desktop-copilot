import { VadChunker } from '../vad/vad-chunker';
import { encodeWav } from './wav-encoder';

export interface AudioStreamEvents {
  onAudioLevels?: (levels: number[]) => void;
  onSpeechSegment?: (segment: { source: 'MICROPHONE' | 'SYSTEM_LOOPBACK'; wavBuffer: Buffer; durationMs: number }) => void;
}

export class DualAudioStreamManager {
  private vad = new VadChunker({ energyThreshold: 0.025 });
  private micBuffer: number[] = [];
  private loopbackBuffer: number[] = [];
  private speechStreak = 0;
  private silenceStreak = 0;

  processRawPcmChunk(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array, events: AudioStreamEvents): void {
    // 1. Calculate 6-band levels for waveform
    const levels = this.compute6BandLevels(pcm);
    events.onAudioLevels?.(levels);

    // 2. VAD Detection
    const isVoice = this.vad.isSpeech(pcm);
    const targetBuffer = source === 'MICROPHONE' ? this.micBuffer : this.loopbackBuffer;

    for (let i = 0; i < pcm.length; i++) {
      targetBuffer.push(pcm[i] ?? 0);
    }

    if (isVoice) {
      this.speechStreak++;
      this.silenceStreak = 0;
    } else {
      this.silenceStreak++;
    }

    // Speech completed: detected silence pause (>600ms) after speech or reached maximum segment length (12s)
    const isPauseBoundary = this.silenceStreak >= 6 && this.speechStreak >= 4 && targetBuffer.length >= 8000;
    const isMaxDurationReached = this.speechStreak >= 4 && targetBuffer.length >= 16000 * 12;

    if (isPauseBoundary || isMaxDurationReached) {
      const floatData = new Float32Array(targetBuffer);
      const wav = encodeWav(floatData, 16000);
      events.onSpeechSegment?.({
        source,
        wavBuffer: wav,
        durationMs: Math.round((floatData.length / 16000) * 1000)
      });
      targetBuffer.length = 0;
      this.speechStreak = 0;
      this.silenceStreak = 0;
    } else if (this.speechStreak === 0 && targetBuffer.length > 16000 * 2) {
      // Discard pure silence backlog beyond 2 seconds
      targetBuffer.splice(0, targetBuffer.length - 16000);
    }
  }

  compute6BandLevels(pcm: Float32Array): number[] {
    if (pcm.length === 0) return [0, 0, 0, 0, 0, 0];
    const bandSize = Math.floor(pcm.length / 6);
    if (bandSize === 0) return [0, 0, 0, 0, 0, 0];
    const levels: number[] = [];
    for (let b = 0; b < 6; b++) {
      let sum = 0;
      const start = b * bandSize;
      const end = start + bandSize;
      for (let i = start; i < end; i++) {
        const val = pcm[i] ?? 0;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bandSize);
      levels.push(Math.min(1.0, rms * 4));
    }
    return levels;
  }
}
