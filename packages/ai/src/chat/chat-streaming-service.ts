import { ChatStreamingService } from '../types';
import { ContextPayload } from '@repo/core';
import { CapabilityModelConfig } from '../config';

export class ConfigurableChatStreamingService implements ChatStreamingService {
  private config: CapabilityModelConfig;

  constructor(config: CapabilityModelConfig) {
    this.config = config;
  }

  async *streamAnswer(context: ContextPayload, question: string): AsyncIterable<string> {
    const role = context.initialContext.roleOrPersona ?? 'Copilot';
    yield `[Answering as ${role}]\n`;

    const tokens = [
      '• To optimize this system, ',
      'leverage an event-driven architecture ',
      'with idempotent event consumers.\n',
      '• Use distributed caching with write-through ',
      'to bound database load.'
    ];

    for (const token of tokens) {
      await new Promise((res) => setTimeout(res, 20));
      yield token;
    }
  }
}
