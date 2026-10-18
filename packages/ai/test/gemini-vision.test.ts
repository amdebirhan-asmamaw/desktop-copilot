import { describe, it, expect, vi } from 'vitest';
import { GeminiAdapter } from '../src/providers/gemini-adapter';

describe('GeminiAdapter Multimodal Vision', () => {
  it('attaches base64 screen snapshot inlineData when present in ContextPayload', async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn().mockImplementation(async (_, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Answer"}]}}]}\n\n'));
            controller.close();
          }
        })
      };
    });

    const adapter = new GeminiAdapter({ apiKey: 'test-key', model: 'gemini-3.8-flash' });
    const payloadWithImage: any = {
      sessionId: 's1',
      recentTurns: [],
      latestSnapshot: {
        id: 'snap1',
        timestamp: Date.now(),
        base64Jpeg: 'fakeBase64ImageData=='
      }
    };

    const stream = adapter.streamAnswer(payloadWithImage, 'Solve this algorithm on screen', { requestId: 'req1' });
    for await (const _ of stream) {}

    const parts = capturedBody.contents[0].parts;
    const imagePart = parts.find((p: any) => p.inlineData);
    expect(imagePart).toBeDefined();
    expect(imagePart.inlineData.mimeType).toBe('image/jpeg');
    expect(imagePart.inlineData.data).toBe('fakeBase64ImageData==');
  });
});
