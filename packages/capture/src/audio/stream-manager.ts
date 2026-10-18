import { VadChunker } from '../vad/vad-chunker';
import { encodeWav } from './wav-encoder';

export interface AudioStreamEvents {
  onAudioLevels?: (levels: number[]) => void;
  onSpeechSegment?: (segment: { source: 'MICROPHONE' | 'SYSTEM_LOOPBACK'; wavBuffer: Buffer; durationMs: number }) => void;
}

class IsolatedAudioChannel {
  readonly source: 'MICROPHONE' | 'SYSTEM_LOOPBACK';
  readonly vad: VadChunker;
  readonly minSpeechSamples: number;
  readonly minSpeechStreak: number;
  readonly pauseSilenceStreak: number;

  buffer: number[] = [];
  speechStreak = 0;
  silenceStreak = 0;
  isSpeaking = false;
  speechFramesCount = 0;
  lastSpeechTimestamp = 0;
  recentRms = 0;

  constructor(
    source: 'MICROPHONE' | 'SYSTEM_LOOPBACK',
    energyThreshold: number,
    minSpeechSamples: number,
    minSpeechStreak: number,
    pauseSilenceStreak: number
  ) {
    this.source = source;
    this.vad = new VadChunker({ energyThreshold });
    this.minSpeechSamples = minSpeechSamples;
    this.minSpeechStreak = minSpeechStreak;
    this.pauseSilenceStreak = pauseSilenceStreak;
  }

  reset(): void {
    this.buffer = [];
    this.speechStreak = 0;
    this.silenceStreak = 0;
    this.isSpeaking = false;
    this.speechFramesCount = 0;
  }
}

export class DualAudioStreamManager {
  // Loopback (remote speaker): Clean digital audio from meetings/interviews.
  // Zero ambient room noise allows a low sensitivity threshold (0.005) so quiet speech
  // in Google Meet/Zoom is never missed or mistaken for silence.
  private loopbackChannel = new IsolatedAudioChannel(
    'SYSTEM_LOOPBACK',
    0.005, // High sensitivity for pure digital audio
    6000,  // ~375ms minimum speech
    2,     // 2 consecutive voice frames (~170ms) to trigger speaking state
    8      // 8 consecutive silence frames (~680ms) to avoid sentence fragmentation
  );

  // Microphone (user): Tuned to capture real user speech while rejecting breathing and background noise
  private micChannel = new IsolatedAudioChannel(
    'MICROPHONE',
    0.035, // Rejects soft breathing, sighing, and ambient room noise
    10000, // ~625ms minimum speech
    3,     // 3 consecutive voice frames to confirm speech
    8      // 8 consecutive silence frames (~680ms) for pause boundary
  );

  processRawPcmChunk(
    source: 'MICROPHONE' | 'SYSTEM_LOOPBACK',
    pcm: Float32Array,
    events: AudioStreamEvents
  ): void {
    if (pcm.length === 0) return;

    // 1. Calculate 6-band levels for waveform visualizer
    const levels = this.compute6BandLevels(pcm);
    events.onAudioLevels?.(levels);

    const channel = source === 'MICROPHONE' ? this.micChannel : this.loopbackChannel;
    channel.recentRms = this.computeRms(pcm);
    const isVoice = channel.vad.isSpeech(pcm);

    // 2. Acoustic Echo Suppression (Ducking)
    // When the remote speaker (loopback) is playing audio or recently spoke,
    // duck the microphone input to prevent computer speakers from echoing into the mic
    // and falsely tagging the other party's voice as USER.
    if (source === 'MICROPHONE') {
      const now = Date.now();
      const isLoopbackActive =
        this.loopbackChannel.isSpeaking ||
        this.loopbackChannel.recentRms > 0.004 ||
        (now - this.loopbackChannel.lastSpeechTimestamp < 1200 && this.loopbackChannel.lastSpeechTimestamp > 0);

      // Allow barge-in only if user speaks directly and significantly louder than speaker bleed
      const isBargeIn = channel.recentRms > 0.16 && channel.recentRms > this.loopbackChannel.recentRms * 2.5;

      if (isLoopbackActive && !isBargeIn) {
        // Duck the mic: discard speaker bleed audio
        channel.silenceStreak++;
        if (channel.speechStreak > 0) {
          channel.speechStreak = 0;
          channel.isSpeaking = false;
        }
        // Discard accumulated mic buffer so no speaker echo lingers
        if (channel.buffer.length > 8000) {
          channel.buffer.splice(0, channel.buffer.length - 4000);
        }
        return;
      }
    }

    // 3. Append audio to this channel's dedicated buffer
    for (let i = 0; i < pcm.length; i++) {
      channel.buffer.push(pcm[i] ?? 0);
    }

    // 4. Update channel-specific VAD state
    if (isVoice) {
      channel.speechStreak++;
      channel.speechFramesCount++;
      channel.silenceStreak = 0;
      channel.lastSpeechTimestamp = Date.now();
      if (channel.speechStreak >= channel.minSpeechStreak) {
        channel.isSpeaking = true;
      }
    } else {
      channel.silenceStreak++;
      if (channel.silenceStreak >= channel.pauseSilenceStreak) {
        channel.isSpeaking = false;
      }
    }

    // 5. Evaluate pause boundary or max duration for THIS channel independently
    const isPauseBoundary =
      channel.silenceStreak >= channel.pauseSilenceStreak &&
      channel.speechFramesCount >= channel.minSpeechStreak &&
      channel.buffer.length >= channel.minSpeechSamples;

    const isMaxDurationReached =
      channel.speechFramesCount >= channel.minSpeechStreak &&
      channel.buffer.length >= 16000 * 12;

    if (isPauseBoundary || isMaxDurationReached) {
      const floatData = new Float32Array(channel.buffer);
      const wav = encodeWav(floatData, 16000);
      events.onSpeechSegment?.({
        source: channel.source,
        wavBuffer: wav,
        durationMs: Math.round((floatData.length / 16000) * 1000)
      });
      channel.reset();
    } else if (channel.speechFramesCount === 0 && channel.buffer.length > 16000 * 1.5) {
      // Discard silence backlog beyond 1.5 seconds, keeping 0.5s pre-roll for onset consonants
      channel.buffer.splice(0, channel.buffer.length - 8000);
    }
  }

  computeRms(pcm: Float32Array): number {
    if (pcm.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      const val = pcm[i] ?? 0;
      sum += val * val;
    }
    return Math.sqrt(sum / pcm.length);
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
