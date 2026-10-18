import { describe, it, expect } from 'vitest';

export function normalizeAudioLevels(raw: number[]): number[] {
  if (!raw || raw.length === 0) return [2, 2, 2, 2, 2, 2];
  return raw.slice(0, 6).map((val) => Math.max(2, Math.min(16, Math.round(val * 16))));
}

describe('normalizeAudioLevels', () => {
  it('returns resting 2px baseline when silent or empty', () => {
    expect(normalizeAudioLevels([])).toEqual([2, 2, 2, 2, 2, 2]);
    expect(normalizeAudioLevels([0, 0, 0, 0, 0, 0])).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('scales normalized 0-1 values into 2-16px bar heights', () => {
    const input = [0.1, 0.5, 1.0, 0.25, 0.75, 0.0];
    const output = normalizeAudioLevels(input);
    expect(output[0]).toBe(2);
    expect(output[1]).toBe(8);
    expect(output[2]).toBe(16);
    expect(output[5]).toBe(2);
  });
});
