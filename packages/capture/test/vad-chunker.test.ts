import { describe, it, expect } from 'vitest';
import { VadChunker } from '../src/vad/vad-chunker';

describe('VadChunker', () => {
  it('detects silence below energy threshold and passes speech above threshold', () => {
    const chunker = new VadChunker({ energyThreshold: 0.05, sampleRate: 16000 });

    // Silence buffer
    const silence = new Float32Array(1600).fill(0.001);
    expect(chunker.isSpeech(silence)).toBe(false);

    // Speech burst
    const speech = new Float32Array(1600).fill(0.2);
    expect(chunker.isSpeech(speech)).toBe(true);
  });
});
