import { ContextPayload, AIStreamEvent } from '@repo/core';
import { AIProviderAdapter, StreamOptions } from './types';

export interface OpenAIAdapterConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  temperature?: number;
}

export class OpenAIAdapter implements AIProviderAdapter {
  readonly id = 'openai';
  readonly model: string;
  readonly supportsVision = true;
  private apiKey: string;
  private endpoint: string;
  private temperature: number;

  constructor(config: OpenAIAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o';
    this.endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
    this.temperature = config.temperature ?? 0.7;
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
          message: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env or select Demo Mode.'
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

    const systemPrompt = [
      'You are Desktop Copilot, an ultra-fast, expert technical assistant.',
      payload.initialContext?.roleOrPersona ? `Role Persona: ${payload.initialContext.roleOrPersona}.` : '',
      payload.initialContext?.instructions ? `Guidance: ${payload.initialContext.instructions}.` : '',
      'Format output in concise, structured markdown with bullet points and bold key technical terms. Zero filler.'
    ].filter(Boolean).join(' ');

    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'system', content: systemPrompt }
    ];

    if (payload.recentTurns && payload.recentTurns.length > 0) {
      for (const turn of payload.recentTurns.slice(-6)) {
        messages.push({
          role: turn.speaker === 'ASSISTANT' ? 'assistant' : 'user',
          content: turn.text
        });
      }
    }

    messages.push({
      role: 'user',
      content: question
    });

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          temperature: this.temperature,
          messages
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
            message: `OpenAI error (${response.status}): ${errText || response.statusText}`
          }
        };
        return;
      }

      if (!response.body) {
        yield {
          type: 'error',
          requestId,
          error: { code: 'EMPTY_RESPONSE', message: 'Received empty response body from OpenAI.' }
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
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              yield {
                type: 'text-delta',
                requestId,
                text: delta
              };
            }
          } catch {
            // Ignore partial JSON parse chunks
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
