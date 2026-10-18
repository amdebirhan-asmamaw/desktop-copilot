import { ContextPayload, AIStreamEvent } from '@repo/core';
import { AIProviderAdapter, StreamOptions } from './types';
import { buildInterviewSystemPrompt } from '../prompts/interview-prompt';

export interface AnthropicAdapterConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  maxTokens?: number;
}

export class AnthropicAdapter implements AIProviderAdapter {
  readonly id = 'anthropic';
  readonly model: string;
  readonly supportsVision = true;
  private apiKey: string;
  private endpoint: string;
  private maxTokens: number;

  constructor(config: AnthropicAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'claude-3-7-sonnet';
    this.endpoint = config.endpoint || 'https://api.anthropic.com/v1/messages';
    this.maxTokens = config.maxTokens ?? 1500;
  }

  async *streamAnswer(
    payload: ContextPayload,
    question: string,
    options: StreamOptions
  ): AsyncIterable<AIStreamEvent> {
    const { requestId, signal } = options;

    if (!this.apiKey || this.apiKey === 'local') {
      yield {
        type: 'error',
        requestId,
        error: {
          code: 'MISSING_API_KEY',
          message: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY in .env or select Demo Mode.'
        }
      };
      return;
    }

    yield {
      type: 'start',
      requestId,
      model: this.model,
      isDemo: false
    };

    const systemPrompt = buildInterviewSystemPrompt(payload);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: question }]
        }),
        signal
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        yield {
          type: 'error',
          requestId,
          error: {
            code: `HTTP_${response.status}`,
            message: `Anthropic error (${response.status}): ${errText || response.statusText}`
          }
        };
        return;
      }

      if (!response.body) {
        yield {
          type: 'error',
          requestId,
          error: { code: 'EMPTY_RESPONSE', message: 'Received empty response body from Anthropic.' }
        };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.replace(/^data:\s*/, '');

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield {
                type: 'text-delta',
                requestId,
                text: parsed.delta.text
              };
            }
          } catch {
            // Ignore partial SSE lines
          }
        }
      }

      yield {
        type: 'complete',
        requestId
      };
    } catch (err: unknown) {
      if (signal.aborted) {
        yield {
          type: 'error',
          requestId,
          error: { code: 'ABORTED', message: 'Request aborted by user or new query preemption.' }
        };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        yield {
          type: 'error',
          requestId,
          error: { code: 'FETCH_ERROR', message }
        };
      }
    }
  }
}
