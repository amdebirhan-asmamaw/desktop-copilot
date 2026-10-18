import { AudioChunk, ScreenSnapshot } from '@repo/capture';
import { ContextPayload } from '@repo/core';

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  speaker: 'USER' | 'REMOTE_SPEAKER';
  timestamp: number;
  audioStartMs?: number;
  audioEndMs?: number;
}

export interface STTService {
  transcribeChunk(chunk: AudioChunk): Promise<TranscriptEvent | null>;
}

export interface VisionService {
  analyzeScreen(snapshot: ScreenSnapshot, prompt?: string): Promise<string>;
}

export interface ChatStreamingService {
  streamAnswer(context: ContextPayload, question: string): AsyncIterable<string>;
}
