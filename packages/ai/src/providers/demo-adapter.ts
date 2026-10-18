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
      `The strategies for handling database sharding and cross-shard queries include `,
      `selecting a high-cardinality shard key to prevent hotspots, `,
      `employing consistent hashing with virtual nodes for balanced data distribution, `,
      `using distributed query routers to scatter-gather cross-shard operations, `,
      `and coordinating multi-shard transactions using the Saga pattern with idempotent compensating actions.\n\n`,
      `• **Architecture**: Route queries through a stateless proxy layer that caches cluster topology and executes parallel shard fan-outs.\n`,
      `• **Trade-offs**: Prioritizes horizontal write throughput and partition tolerance (CP) over low-latency cross-shard joins.`
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
