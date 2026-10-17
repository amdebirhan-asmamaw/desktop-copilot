import { SessionRepository } from '../storage/session-repository';
import { ContextSession, InitialContext, TranscriptTurn, SnapshotReference, ContextPayload } from '../types/session';

export interface SessionManagerOptions {
  maxRecentTurns?: number;
}

export class SessionManager {
  private repository: SessionRepository;
  private maxRecentTurns: number;

  constructor(repository: SessionRepository, options: SessionManagerOptions = {}) {
    this.repository = repository;
    this.maxRecentTurns = options.maxRecentTurns ?? 10;
  }

  async createSession(initialContext: InitialContext = {}): Promise<ContextSession> {
    const session: ContextSession = {
      sessionId: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      initialContext,
      transcripts: [],
      recentSnapshots: [],
      activeSources: {
        micEnabled: true,
        loopbackEnabled: true,
        screenEnabled: true
      }
    };
    await this.repository.save(session);
    return session;
  }

  async getSession(sessionId: string): Promise<ContextSession | null> {
    return this.repository.getById(sessionId);
  }

  async appendTranscript(
    sessionId: string,
    turn: Omit<TranscriptTurn, 'id' | 'timestamp'>
  ): Promise<TranscriptTurn> {
    const session = await this.repository.getById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const newTurn: TranscriptTurn = {
      id: `turn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      speaker: turn.speaker,
      text: turn.text
    };

    session.transcripts.push(newTurn);
    session.updatedAt = Date.now();
    await this.repository.save(session);
    return newTurn;
  }

  async addSnapshotRef(
    sessionId: string,
    snapshot: Omit<SnapshotReference, 'id' | 'timestamp'>
  ): Promise<SnapshotReference> {
    const session = await this.repository.getById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const ref: SnapshotReference = {
      id: `snap_${Date.now()}`,
      timestamp: Date.now(),
      sourceTitle: snapshot.sourceTitle,
      ocrSummary: snapshot.ocrSummary
    };

    session.recentSnapshots.push(ref);
    session.updatedAt = Date.now();
    await this.repository.save(session);
    return ref;
  }

  async assembleContextPayload(sessionId: string): Promise<ContextPayload> {
    const session = await this.repository.getById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const recentTurns = session.transcripts.slice(-this.maxRecentTurns);
    const latestSnapshot = session.recentSnapshots[session.recentSnapshots.length - 1];

    return {
      sessionId: session.sessionId,
      initialContext: session.initialContext,
      recentTurns,
      latestSnapshot
    };
  }
}
