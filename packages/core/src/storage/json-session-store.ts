import * as fs from 'fs';
import * as path from 'path';
import { SessionRepository } from './session-repository';
import { ContextSession } from '../types/session';

export class JsonSessionStore implements SessionRepository {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private readAll(): Record<string, ContextSession> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private writeAll(data: Record<string, ContextSession>): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async save(session: ContextSession): Promise<void> {
    const data = this.readAll();
    data[session.sessionId] = session;
    this.writeAll(data);
  }

  async getById(sessionId: string): Promise<ContextSession | null> {
    const data = this.readAll();
    return data[sessionId] ?? null;
  }

  async listAll(): Promise<ContextSession[]> {
    const data = this.readAll();
    return Object.values(data);
  }
}
