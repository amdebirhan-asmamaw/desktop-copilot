import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/context/session-manager';
import { JsonSessionStore } from '../src/storage/json-session-store';
import * as fs from 'fs';
import * as path from 'path';

describe('SessionManager & Context Engine', () => {
  const testStorePath = path.join(__dirname, 'test-sessions.json');

  beforeEach(() => {
    if (fs.existsSync(testStorePath)) {
      fs.unlinkSync(testStorePath);
    }
  });

  it('creates a session with initial context and updates rolling transcript', async () => {
    const store = new JsonSessionStore(testStorePath);
    const manager = new SessionManager(store);

    const session = await manager.createSession({
      roleOrPersona: 'Senior Distributed Systems Architect',
      meetingType: 'System Design Interview',
      backgroundNotes: 'Specializes in high-throughput message brokers and Raft consensus',
      instructions: 'Keep responses concise with bullet points'
    });

    expect(session.sessionId).toBeDefined();
    expect(session.initialContext.roleOrPersona).toBe('Senior Distributed Systems Architect');
    expect(session.transcripts).toHaveLength(0);

    // Append transcript turns
    await manager.appendTranscript(session.sessionId, {
      speaker: 'REMOTE_SPEAKER',
      text: 'How do you handle split-brain in Raft cluster?'
    });

    const updated = await manager.getSession(session.sessionId);
    expect(updated?.transcripts).toHaveLength(1);
    expect(updated?.transcripts[0]?.speaker).toBe('REMOTE_SPEAKER');
    expect(updated?.transcripts[0]?.text).toContain('split-brain');
  });

  it('enforces rolling context window limit of last N turns', async () => {
    const store = new JsonSessionStore(testStorePath);
    const manager = new SessionManager(store, { maxRecentTurns: 3 });

    const session = await manager.createSession();

    for (let i = 1; i <= 5; i++) {
      await manager.appendTranscript(session.sessionId, {
        speaker: 'USER',
        text: `Turn ${i}`
      });
    }

    const contextPayload = await manager.assembleContextPayload(session.sessionId);
    expect(contextPayload.recentTurns).toHaveLength(3);
    expect(contextPayload.recentTurns[0]?.text).toBe('Turn 3');
    expect(contextPayload.recentTurns[2]?.text).toBe('Turn 5');
  });

  it('persists assistant turns and includes them in follow-up context packages', async () => {
    const store = new JsonSessionStore(testStorePath);
    const manager = new SessionManager(store);

    const session = await manager.createSession({ roleOrPersona: 'Staff Engineer' });

    await manager.appendTranscript(session.sessionId, { speaker: 'REMOTE_SPEAKER', text: 'What is Raft?' });
    await manager.appendTranscript(session.sessionId, { speaker: 'ASSISTANT', text: 'Raft is a leader-based consensus algorithm.' });
    await manager.appendTranscript(session.sessionId, { speaker: 'REMOTE_SPEAKER', text: 'How does it handle split votes?' });

    const payload = await manager.assembleContextPayload(session.sessionId);
    expect(payload.recentTurns).toHaveLength(3);
    expect(payload.recentTurns[0]?.speaker).toBe('REMOTE_SPEAKER');
    expect(payload.recentTurns[1]?.speaker).toBe('ASSISTANT');
    expect(payload.recentTurns[1]?.text).toContain('Raft is a leader-based consensus');
    expect(payload.recentTurns[2]?.speaker).toBe('REMOTE_SPEAKER');
  });
});
