export interface InitialContext {
  roleOrPersona?: string;
  meetingType?: string;
  backgroundNotes?: string;
  instructions?: string;
}

export interface TranscriptTurn {
  id: string;
  speaker: 'USER' | 'REMOTE_SPEAKER' | 'ASSISTANT';
  timestamp: number;
  text: string;
}

export interface SnapshotReference {
  id: string;
  timestamp: number;
  sourceTitle?: string;
  ocrSummary?: string;
}

export interface ActiveSources {
  micEnabled: boolean;
  loopbackEnabled: boolean;
  screenEnabled: boolean;
}

export interface ContextSession {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  initialContext: InitialContext;
  transcripts: TranscriptTurn[];
  recentSnapshots: SnapshotReference[];
  activeSources: ActiveSources;
}

export interface ContextPayload {
  sessionId: string;
  initialContext: InitialContext;
  recentTurns: TranscriptTurn[];
  latestSnapshot?: SnapshotReference;
}
