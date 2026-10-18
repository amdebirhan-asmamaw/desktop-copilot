import { ContextPayload, AIStreamEvent } from '@repo/core';
import { AIProviderAdapter, StreamOptions } from './types';

export class DemoAdapter implements AIProviderAdapter {
  readonly id = 'demo';
  readonly model = 'demo-copilot-engine';
  readonly supportsVision = true;

  async *streamAnswer(
    payload: ContextPayload,
    question: string,
    options: StreamOptions
  ): AsyncIterable<AIStreamEvent> {
    const { requestId, signal } = options;

    yield {
      type: 'start',
      requestId,
      model: this.model,
      isDemo: true
    };

    const role = payload.initialContext?.roleOrPersona || 'Senior Software Engineer';

    const tokens = [
      `### Key Points (${role})\n\n`,
      `• **Core Principle**: `,
      `Address the problem using `,
      `decoupled, asynchronous communication `,
      `to avoid cascading failures.\n`,
      `• **Architecture**: `,
      `Employ an idempotent state machine `,
      `with write-ahead logging and partitioned storage.\n`,
      `• **Trade-offs**: `,
      `Favors consistency and partition tolerance (CP) `,
      `over maximum availability during network split events.`
    ];

    for (const token of tokens) {
      if (signal.aborted) {
        yield {
          type: 'error',
          requestId,
          error: {
            code: 'ABORTED',
            message: 'Request was cancelled by user or preempted by a newer question'
          }
        };
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));

      if (signal.aborted) {
        yield {
          type: 'error',
          requestId,
          error: {
            code: 'ABORTED',
            message: 'Request was cancelled by user or preempted by a newer question'
          }
        };
        return;
      }

      yield {
        type: 'text-delta',
        requestId,
        text: token
      };
    }

    yield {
      type: 'complete',
      requestId,
      usage: {
        promptTokens: 140,
        completionTokens: 95
      }
    };
  }
}
