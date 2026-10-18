import { describe, it, expect, vi } from 'vitest';
import { DeepgramStreamingSession } from '../src/stt/deepgram-streaming-session';

describe('DeepgramStreamingSession', () => {
  it('routes interim hypothesis only to onInterim and not onFinalUtterance', () => {
    const interims: string[] = [];
    const finals: any[] = [];

    const session = new DeepgramStreamingSession({
      apiKey: 'test-key',
      speaker: 'REMOTE_SPEAKER',
      onInterim: (text) => interims.push(text),
      onFinalUtterance: (evt) => finals.push(evt)
    });

    session.handleServerMessage(JSON.stringify({
      channel: {
        alternatives: [{ transcript: 'how do you handle' }]
      },
      is_final: false,
      speech_final: false
    }));

    expect(interims).toEqual(['how do you handle']);
    expect(finals.length).toBe(0);
  });

  it('accumulates is_final segments and only fires onFinalUtterance on speech_final', () => {
    const interims: string[] = [];
    const finals: any[] = [];

    const session = new DeepgramStreamingSession({
      apiKey: 'test-key',
      speaker: 'REMOTE_SPEAKER',
      onInterim: (text) => interims.push(text),
      onFinalUtterance: (evt) => finals.push(evt)
    });

    // Segment 1 (locked, but speaker still talking)
    session.handleServerMessage(JSON.stringify({
      channel: {
        alternatives: [{ transcript: 'Can you describe' }]
      },
      is_final: true,
      speech_final: false
    }));
    expect(finals.length).toBe(0);

    // Segment 2 (locked, and speech endpoint reached)
    session.handleServerMessage(JSON.stringify({
      channel: {
        alternatives: [{ transcript: 'the distributed consensus protocol?' }]
      },
      is_final: true,
      speech_final: true
    }));

    expect(finals.length).toBe(1);
    expect(finals[0].text).toBe('Can you describe the distributed consensus protocol?');
    expect(finals[0].speaker).toBe('REMOTE_SPEAKER');
    expect(finals[0].isFinal).toBe(true);
  });

  it('flushes accumulated segments on UtteranceEnd message', () => {
    const finals: any[] = [];

    const session = new DeepgramStreamingSession({
      apiKey: 'test-key',
      speaker: 'USER',
      onInterim: () => {},
      onFinalUtterance: (evt) => finals.push(evt)
    });

    session.handleServerMessage(JSON.stringify({
      channel: {
        alternatives: [{ transcript: 'I am explaining the database schema.' }]
      },
      is_final: true,
      speech_final: false
    }));

    expect(finals.length).toBe(0);

    // UtteranceEnd backup endpoint
    session.handleServerMessage(JSON.stringify({
      type: 'UtteranceEnd'
    }));

    expect(finals.length).toBe(1);
    expect(finals[0].text).toBe('I am explaining the database schema.');
    expect(finals[0].speaker).toBe('USER');
  });
});
