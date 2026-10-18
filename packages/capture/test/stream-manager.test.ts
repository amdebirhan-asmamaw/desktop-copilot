import { describe, it, expect, vi } from 'vitest';
import { DualAudioStreamManager } from '../src/audio/stream-manager';

describe('DualAudioStreamManager', () => {
  it('correctly attributes SYSTEM_LOOPBACK speech to loopback and does not cross-contaminate with microphone', () => {
    const manager = new DualAudioStreamManager();
    const segmentSpy = vi.fn();

    // 1. Send speech on SYSTEM_LOOPBACK (e.g. 8 chunks of 1600 samples of voice, RMS ~0.15)
    const loopbackSpeech = new Float32Array(1600).fill(0.15);
    const micSilence = new Float32Array(1600).fill(0.005);

    // Alternate chunks between loopback and mic (mimicking real Electron IPC)
    for (let i = 0; i < 8; i++) {
      manager.processRawPcmChunk('SYSTEM_LOOPBACK', loopbackSpeech, { onSpeechSegment: segmentSpy });
      manager.processRawPcmChunk('MICROPHONE', micSilence, { onSpeechSegment: segmentSpy });
    }

    // Now silence pause on both for 8 frames
    const loopbackSilence = new Float32Array(1600).fill(0.001);
    for (let i = 0; i < 8; i++) {
      manager.processRawPcmChunk('MICROPHONE', micSilence, { onSpeechSegment: segmentSpy });
      manager.processRawPcmChunk('SYSTEM_LOOPBACK', loopbackSilence, { onSpeechSegment: segmentSpy });
    }

    // Must have emitted a speech segment from SYSTEM_LOOPBACK, NOT from MICROPHONE
    expect(segmentSpy).toHaveBeenCalled();
    const emittedSources = segmentSpy.mock.calls.map((c) => c[0].source);
    expect(emittedSources).toContain('SYSTEM_LOOPBACK');
    expect(emittedSources).not.toContain('MICROPHONE');
  });

  it('correctly attributes MICROPHONE speech to user when loopback is silent', () => {
    const manager = new DualAudioStreamManager();
    const segmentSpy = vi.fn();

    // Send speech on MICROPHONE (10 chunks of 1600 samples of voice, RMS ~0.18)
    const micSpeech = new Float32Array(1600).fill(0.18);
    const loopbackSilence = new Float32Array(1600).fill(0.001);

    for (let i = 0; i < 10; i++) {
      manager.processRawPcmChunk('SYSTEM_LOOPBACK', loopbackSilence, { onSpeechSegment: segmentSpy });
      manager.processRawPcmChunk('MICROPHONE', micSpeech, { onSpeechSegment: segmentSpy });
    }

    // Silence pause
    const micSilence = new Float32Array(1600).fill(0.005);
    for (let i = 0; i < 8; i++) {
      manager.processRawPcmChunk('MICROPHONE', micSilence, { onSpeechSegment: segmentSpy });
      manager.processRawPcmChunk('SYSTEM_LOOPBACK', loopbackSilence, { onSpeechSegment: segmentSpy });
    }

    expect(segmentSpy).toHaveBeenCalled();
    const emittedSources = segmentSpy.mock.calls.map((c) => c[0].source);
    expect(emittedSources).toContain('MICROPHONE');
    expect(emittedSources).not.toContain('SYSTEM_LOOPBACK');
  });

  it('preserves simultaneous speech on both loopback and microphone with accurate audio timestamps', () => {
    const manager = new DualAudioStreamManager();
    const segmentSpy = vi.fn();

    const loopbackSpeech = new Float32Array(1600).fill(0.20);
    const micSpeech = new Float32Array(1600).fill(0.15);

    for (let i = 0; i < 8; i++) {
      manager.processRawPcmChunk('SYSTEM_LOOPBACK', loopbackSpeech, { onSpeechSegment: segmentSpy });
      manager.processRawPcmChunk('MICROPHONE', micSpeech, { onSpeechSegment: segmentSpy });
    }

    // Silence pause
    const silence = new Float32Array(1600).fill(0.001);
    for (let i = 0; i < 8; i++) {
      manager.processRawPcmChunk('SYSTEM_LOOPBACK', silence, { onSpeechSegment: segmentSpy });
      manager.processRawPcmChunk('MICROPHONE', silence, { onSpeechSegment: segmentSpy });
    }

    // Both channels are independently acquired without destructive ducking
    expect(segmentSpy).toHaveBeenCalledTimes(2);
    const emittedSources = segmentSpy.mock.calls.map((c) => c[0].source);
    expect(emittedSources).toContain('SYSTEM_LOOPBACK');
    expect(emittedSources).toContain('MICROPHONE');

    // Both have valid speech duration and audio clock timestamps
    const loopbackCall = segmentSpy.mock.calls.find((c) => c[0].source === 'SYSTEM_LOOPBACK')![0];
    const micCall = segmentSpy.mock.calls.find((c) => c[0].source === 'MICROPHONE')![0];
    expect(loopbackCall.durationMs).toBeGreaterThan(0);
    expect(loopbackCall.audioEndMs).toBeGreaterThan(loopbackCall.audioStartMs);
    expect(micCall.durationMs).toBeGreaterThan(0);
    expect(micCall.audioEndMs).toBeGreaterThan(micCall.audioStartMs);
  });
});
