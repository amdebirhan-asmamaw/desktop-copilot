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

  it('ducks microphone input when loopback is actively speaking to prevent acoustic speaker bleed', () => {
    const manager = new DualAudioStreamManager();
    const segmentSpy = vi.fn();

    const loopbackSpeech = new Float32Array(1600).fill(0.20);
    // Bleed on microphone with lower energy (e.g. 0.05) from speakers
    const micBleed = new Float32Array(1600).fill(0.05);

    for (let i = 0; i < 8; i++) {
      manager.processRawPcmChunk('SYSTEM_LOOPBACK', loopbackSpeech, { onSpeechSegment: segmentSpy });
      manager.processRawPcmChunk('MICROPHONE', micBleed, { onSpeechSegment: segmentSpy });
    }

    // Silence pause
    const silence = new Float32Array(1600).fill(0.001);
    for (let i = 0; i < 8; i++) {
      manager.processRawPcmChunk('SYSTEM_LOOPBACK', silence, { onSpeechSegment: segmentSpy });
      manager.processRawPcmChunk('MICROPHONE', silence, { onSpeechSegment: segmentSpy });
    }

    // Only the true SYSTEM_LOOPBACK source should have emitted
    expect(segmentSpy).toHaveBeenCalledTimes(1);
    expect(segmentSpy.mock.calls[0]![0].source).toBe('SYSTEM_LOOPBACK');
  });
});
