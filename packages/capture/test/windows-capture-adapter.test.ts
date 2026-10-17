import { describe, it, expect } from 'vitest';
import { WindowsCaptureAdapter } from '../src/windows/windows-capture-adapter';

describe('WindowsCaptureAdapter', () => {
  it('instantiates and provides source query interface', async () => {
    const adapter = new WindowsCaptureAdapter({
      mockSources: [{ id: 'screen:0:0', name: 'Primary Display' }]
    });

    await adapter.init();
    const sources = await adapter.listDisplaySources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.name).toBe('Primary Display');
  });

  it('captures screen snapshot with correct format and dimensions', async () => {
    const adapter = new WindowsCaptureAdapter();
    const snapshot = await adapter.captureScreenSnapshot('entire-screen');

    expect(snapshot.id).toBeDefined();
    expect(snapshot.width).toBe(1920);
    expect(snapshot.height).toBe(1080);
    expect(snapshot.format).toBe('image/png');
    expect(snapshot.buffer).toBeInstanceOf(Buffer);
  });
});
