import { describe, it, expect } from 'vitest';
import { DemoAdapter, OpenAIAdapter, GeminiAdapter, AnthropicAdapter, createChatProvider } from '../src/providers/index';
import { AIStreamEvent } from '@repo/core';

describe('AI Provider Adapters', () => {
  it('emits explicit demo mode tags and structured tokens from DemoAdapter', async () => {
    const adapter = new DemoAdapter();
    const controller = new AbortController();
    const events: AIStreamEvent[] = [];

    for await (const ev of adapter.streamAnswer(
      { sessionId: 's1', initialContext: { roleOrPersona: 'Staff Engineer' }, recentTurns: [] },
      'What is Raft consensus?',
      { signal: controller.signal, requestId: 'req_test' }
    )) {
      events.push(ev);
    }

    expect(events[0].type).toBe('start');
    if (events[0].type === 'start') {
      expect(events[0].isDemo).toBe(true);
      expect(events[0].model).toBe('demo-copilot-engine');
    }

    const deltas = events.filter((e) => e.type === 'text-delta');
    expect(deltas.length).toBeGreaterThan(0);

    const complete = events[events.length - 1];
    expect(complete.type).toBe('complete');
  });

  it('aborts token generation cleanly when signal is cancelled', async () => {
    const adapter = new DemoAdapter();
    const controller = new AbortController();
    const generator = adapter.streamAnswer(
      { sessionId: 's1', initialContext: {}, recentTurns: [] },
      'Explain consensus',
      { signal: controller.signal, requestId: 'req_cancel' }
    );

    const first = await generator.next();
    expect(first.value?.type).toBe('start');

    // Abort signal
    controller.abort();

    const second = await generator.next();
    expect(second.value?.type).toBe('error');
    if (second.value?.type === 'error') {
      expect(second.value.error.code).toBe('ABORTED');
    }
  });

  it('reports explicit error when OpenAI API key is missing or local', async () => {
    const adapter = new OpenAIAdapter({ apiKey: 'local' });
    const controller = new AbortController();
    const events: AIStreamEvent[] = [];

    for await (const ev of adapter.streamAnswer(
      { sessionId: 's1', initialContext: {}, recentTurns: [] },
      'Question',
      { signal: controller.signal, requestId: 'req_err' }
    )) {
      events.push(ev);
    }

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].error.code).toBe('MISSING_API_KEY');
    }
  });

  it('reports explicit error when Gemini API key is missing or local', async () => {
    const adapter = new GeminiAdapter({ apiKey: '' });
    const controller = new AbortController();
    const events: AIStreamEvent[] = [];

    for await (const ev of adapter.streamAnswer(
      { sessionId: 's1', initialContext: {}, recentTurns: [] },
      'Question',
      { signal: controller.signal, requestId: 'req_gem_err' }
    )) {
      events.push(ev);
    }

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].error.code).toBe('MISSING_API_KEY');
    }
  });

  it('reports explicit error when Anthropic API key is missing or local', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'local' });
    const controller = new AbortController();
    const events: AIStreamEvent[] = [];

    for await (const ev of adapter.streamAnswer(
      { sessionId: 's1', initialContext: {}, recentTurns: [] },
      'Question',
      { signal: controller.signal, requestId: 'req_ant_err' }
    )) {
      events.push(ev);
    }

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') {
      expect(events[0].error.code).toBe('MISSING_API_KEY');
    }
  });

  it('createChatProvider instantiates the correct adapter based on config', () => {
    const demo = createChatProvider({
      capabilities: {
        chatStreaming: { provider: 'demo', model: 'any', apiKey: '' },
        vision: { provider: 'mock', model: 'any', apiKey: '' },
        stt: { provider: 'mock', model: 'any', apiKey: '' }
      }
    });
    expect(demo.id).toBe('demo');

    const openai = createChatProvider({
      capabilities: {
        chatStreaming: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-123' },
        vision: { provider: 'mock', model: 'any', apiKey: '' },
        stt: { provider: 'mock', model: 'any', apiKey: '' }
      }
    });
    expect(openai.id).toBe('openai');
    expect(openai.model).toBe('gpt-4o');

    const gemini = createChatProvider({
      capabilities: {
        chatStreaming: { provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'gm-123' },
        vision: { provider: 'mock', model: 'any', apiKey: '' },
        stt: { provider: 'mock', model: 'any', apiKey: '' }
      }
    });
    expect(gemini.id).toBe('gemini');

    const anthropic = createChatProvider({
      capabilities: {
        chatStreaming: { provider: 'anthropic', model: 'claude-3-7-sonnet', apiKey: 'ant-123' },
        vision: { provider: 'mock', model: 'any', apiKey: '' },
        stt: { provider: 'mock', model: 'any', apiKey: '' }
      }
    });
    expect(anthropic.id).toBe('anthropic');
  });
});
