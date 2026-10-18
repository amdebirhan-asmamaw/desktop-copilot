import { describe, it, expect } from 'vitest';
import { validateScreenSnapshot, createBase64DataUrl } from '../src/screen/screen-grabber';
import { ScreenSnapshot } from '../src/types';

describe('Screen Grabber Validator', () => {
  it('validates a complete and healthy screen snapshot', () => {
    const snap: ScreenSnapshot = {
      id: 'snap_1',
      timestamp: Date.now(),
      width: 1920,
      height: 1080,
      format: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      sourceTitle: 'Primary Display'
    };

    const result = validateScreenSnapshot(snap);
    expect(result.isValid).toBe(true);
    expect(result.normalizedDimensions).toEqual({ width: 1920, height: 1080 });

    const dataUrl = createBase64DataUrl(snap);
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('rejects snapshots with zero or negative dimensions', () => {
    const result = validateScreenSnapshot({
      id: 'snap_invalid',
      timestamp: Date.now(),
      width: 0,
      height: 1080,
      format: 'image/jpeg',
      buffer: Buffer.from([1, 2, 3])
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Invalid display dimensions');
  });

  it('rejects snapshots with empty buffers', () => {
    const result = validateScreenSnapshot({
      id: 'snap_empty',
      timestamp: Date.now(),
      width: 1920,
      height: 1080,
      format: 'image/png',
      buffer: Buffer.alloc(0)
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Empty or missing');
  });

  it('rejects unsupported image formats', () => {
    const result = validateScreenSnapshot({
      id: 'snap_unsupported',
      timestamp: Date.now(),
      width: 800,
      height: 600,
      format: 'image/webp' as 'image/jpeg',
      buffer: Buffer.from([1, 2, 3])
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Unsupported image format');
  });
});
