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

    const topic = question
      .replace(/^((can you|could you|please)\s+)?(explain|describe|tell me about|how (do|would|to)|what (is|are))\s+/i, '')
      .replace(/\?+$/, '')
      .trim() || 'this architecture';

    const tokens = [
      `Addressing ${topic} requires `,
      `implementing decoupled architectural components, `,
      `enforcing strict data consistency contracts, `,
      `optimizing high-throughput access paths, `,
      `and designing for resilient failure modes with automated recovery.\n\n`,
      `• **Core Architecture**: Establish an asynchronous, event-driven foundation with clear interface boundaries and state isolation.\n`,
      `• **Trade-offs**: Balances low-latency operational efficiency against horizontal scalability and partition tolerance under high concurrency.`
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
