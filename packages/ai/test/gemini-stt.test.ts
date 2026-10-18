import { describe, it, expect, vi } from 'vitest';
import { GeminiSTTProvider } from '../src/stt/gemini-stt-provider';
import { ConfigurableSTTService } from '../src/stt/stt-service';

describe('GeminiSTTProvider', () => {
  it('formats audio buffer into inlineData Gemini request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'How do you configure database replication in PostgreSQL?' }]
            }
          }
        ]
      })
    });
    globalThis.fetch = mockFetch;

    const provider = new GeminiSTTProvider({ apiKey: 'test-key', model: 'gemini-3.8-flash' });
    const wavDummy = Buffer.from('RIFF....');
    const result = await provider.transcribeAudio(wavDummy);

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toBe('How do you configure database replication in PostgreSQL?');
  });

  it('transcribes via ConfigurableSTTService and tags speaker appropriately', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'Can you explain the consensus mechanism in Raft?' }]
            }
          }
        ]
      })
    });

    const service = new ConfigurableSTTService({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      apiKey: 'test-key'
    });

    const event = await service.transcribeWav(Buffer.from('RIFF....'), 'SYSTEM_LOOPBACK');
    expect(event).not.toBeNull();
    expect(event?.speaker).toBe('REMOTE_SPEAKER');
    expect(event?.text).toBe('Can you explain the consensus mechanism in Raft?');
    expect(event?.isFinal).toBe(true);
  });
});
