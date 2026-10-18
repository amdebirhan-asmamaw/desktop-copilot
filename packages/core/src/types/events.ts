export type AIStreamEvent =
  | { type: 'start'; requestId: string; model: string; isDemo?: boolean }
  | { type: 'text-delta'; requestId: string; text: string }
  | { type: 'error'; requestId: string; error: { code: string; message: string } }
  | { type: 'complete'; requestId: string; usage?: { promptTokens: number; completionTokens: number } };

export interface TranscriptChunk {
  text: string;
  isFinal: boolean;
  speaker: 'USER' | 'REMOTE_SPEAKER';
  timestamp: number;
}

export type OverlayLifecycleEvent =
  | { type: 'ghost:stream-start'; requestId: string; question: string; isDemo?: boolean }
  | { type: 'ghost:stream-chunk'; requestId: string; text: string }
  | { type: 'ghost:stream-end'; requestId: string; fullAnswer?: string }
  | { type: 'ghost:stream-error'; requestId: string; error: { code: string; message: string } }
  | { type: 'ghost:stream-cancel'; requestId: string };
