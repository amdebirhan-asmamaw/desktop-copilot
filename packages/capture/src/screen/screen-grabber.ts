import { ScreenSnapshot } from '../types';

export interface ScreenValidationResult {
  isValid: boolean;
  reason?: string;
  normalizedDimensions?: { width: number; height: number };
}

export function validateScreenSnapshot(snap: Partial<ScreenSnapshot>): ScreenValidationResult {
  if (!snap.buffer || snap.buffer.length === 0) {
    return { isValid: false, reason: 'Empty or missing screen image buffer' };
  }
  if (!snap.width || snap.width <= 0 || !snap.height || snap.height <= 0) {
    return { isValid: false, reason: 'Invalid display dimensions (width and height must be > 0)' };
  }
  if (!snap.format || (snap.format !== 'image/jpeg' && snap.format !== 'image/png')) {
    return { isValid: false, reason: 'Unsupported image format; expected image/jpeg or image/png' };
  }

  return {
    isValid: true,
    normalizedDimensions: {
      width: snap.width,
      height: snap.height
    }
  };
}

export function createBase64DataUrl(snap: ScreenSnapshot): string {
  const base64 = snap.buffer.toString('base64');
  return `data:${snap.format};base64,${base64}`;
}
