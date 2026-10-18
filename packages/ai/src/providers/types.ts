import { ContextPayload, AIStreamEvent } from '@repo/core';

export interface StreamOptions {
  signal: AbortSignal;
  requestId: string;
  timeoutMs?: number;
}

export interface AIProviderAdapter {
  readonly id: string;
  readonly model: string;
  readonly supportsVision: boolean;
  streamAnswer(
    payload: ContextPayload,
    question: string,
    options: StreamOptions
  ): AsyncIterable<AIStreamEvent>;
}
