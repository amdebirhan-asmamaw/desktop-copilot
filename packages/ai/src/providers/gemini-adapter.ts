import { ContextPayload, AIStreamEvent } from '@repo/core';
import { AIProviderAdapter, StreamOptions } from './types';
import { buildInterviewSystemPrompt } from '../prompts/interview-prompt';

export interface GeminiAdapterConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  temperature?: number;
}

export class GeminiAdapter implements AIProviderAdapter {
  readonly id = 'gemini';
  readonly model: string;
  readonly supportsVision = true;
  private apiKey: string;
  private endpoint?: string;
  private temperature: number;

  constructor(config: GeminiAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-3.8-flash';
    this.endpoint = config.endpoint;
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
          message: 'Gemini API key not configured. Set GEMINI_API_KEY in .env or select Demo Mode.'
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

    const targetUrl =
      this.endpoint ||
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const systemInstruction = buildInterviewSystemPrompt(payload);

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: `Question: ${question}` }]
        }
      ],
      generationConfig: {
        temperature: Math.min(this.temperature ?? 0.3, 0.3),
        maxOutputTokens: 650,
        thinkingConfig: {
          thinkingLevel: 'low'
        }
      }
    };

    try {
      let response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal
      });

      // Fallback: if thinkingConfig is rejected by a specific model endpoint, retry without thinkingConfig
      if (!response.ok && response.status === 400) {
        const fallbackBody = {
          ...requestBody,
          generationConfig: {
            temperature: Math.min(this.temperature ?? 0.3, 0.3),
            maxOutputTokens: 650
          }
        };
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackBody),
          signal
        });
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        yield {
          type: 'error',
          requestId,
          error: {
            code: `HTTP_${response.status}`,
            message: `Gemini error (${response.status}): ${errText || response.statusText}`
          }
        };
        return;
      }

      if (!response.body) {
        yield {
          type: 'error',
          requestId,
          error: { code: 'EMPTY_RESPONSE', message: 'Received empty response body from Gemini.' }
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
            const delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (delta) {
              yield {
                type: 'text-delta',
                requestId,
                text: delta
              };
            }
          } catch {
            // Ignore partial JSON chunks
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
