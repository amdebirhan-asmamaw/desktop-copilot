import { describe, it, expect } from 'vitest';
import { AudioCaptureDiagnostics } from '../src/audio/diagnostics';

describe('AudioCaptureDiagnostics', () => {
  it('tracks frames, non-zero counts, peak RMS, and orthogonal states', () => {
    const diag = new AudioCaptureDiagnostics();

    // 1. Initial state
    const initial = diag.getCombinedTelemetry();
    expect(initial.remote.health).toBe('CONNECTED');
    expect(initial.remote.totalFrames).toBe(0);
    expect(initial.mic.totalFrames).toBe(0);

    // 2. Record remote frames
    diag.recordFrame('SYSTEM_LOOPBACK', 0.0005);
    diag.recordFrame('SYSTEM_LOOPBACK', 0.015);
    diag.recordFrame('SYSTEM_LOOPBACK', 0.008);

    const afterRemote = diag.getTelemetry('SYSTEM_LOOPBACK');
    expect(afterRemote.totalFrames).toBe(3);
    expect(afterRemote.nonZeroFrames).toBe(2);
    expect(afterRemote.peakRms).toBe(0.015);
    expect(afterRemote.lastSignalTimestampMs).toBeGreaterThan(0);

    // 3. State transitions
    diag.setHealth('SYSTEM_LOOPBACK', 'NO_AUDIO_TRACK');
    diag.setSpeechState('SYSTEM_LOOPBACK', 'SPEAKING');
    diag.setTranscriptionState('SYSTEM_LOOPBACK', 'TRANSCRIBING');

    const updated = diag.getTelemetry('SYSTEM_LOOPBACK');
    expect(updated.health).toBe('NO_AUDIO_TRACK');
    expect(updated.speechState).toBe('SPEAKING');
    expect(updated.transcriptionState).toBe('TRANSCRIBING');

    // 4. Microphone state remains independent
    const mic = diag.getTelemetry('MICROPHONE');
    expect(mic.health).toBe('CONNECTED');
    expect(mic.speechState).toBe('IDLE');
  });
});
