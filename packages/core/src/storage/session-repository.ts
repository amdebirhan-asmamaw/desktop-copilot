import { ContextSession } from '../types/session';

export interface SessionRepository {
  save(session: ContextSession): Promise<void>;
  getById(sessionId: string): Promise<ContextSession | null>;
  listAll(): Promise<ContextSession[]>;
}
