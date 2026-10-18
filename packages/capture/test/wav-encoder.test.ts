import { describe, it, expect } from 'vitest';
import { encodeWav } from '../src/audio/wav-encoder';

describe('encodeWav', () => {
  it('creates valid 44-byte RIFF WAV header for mono 16kHz audio', () => {
    const samples = new Float32Array(16000); // 1 second of silence
    const wav = encodeWav(samples, 16000);

    expect(wav.length).toBe(44 + 16000 * 2);
    // RIFF identifier
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    // WAVE identifier
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    // fmt subchunk
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    // data subchunk
    expect(wav.toString('ascii', 36, 40)).toBe('data');
  });

  it('clamps and converts float32 to int16 samples accurately', () => {
    const samples = new Float32Array([-1.5, 0.0, 1.5]);
    const wav = encodeWav(samples, 16000);

    expect(wav.readInt16LE(44)).toBe(-32768); // Clamped minimum
    expect(wav.readInt16LE(46)).toBe(0);      // Zero
    expect(wav.readInt16LE(48)).toBe(32767);  // Clamped maximum
  });
});
