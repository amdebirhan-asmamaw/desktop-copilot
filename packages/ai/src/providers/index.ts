export * from './types';
export * from './demo-adapter';
export * from './openai-adapter';
export * from './gemini-adapter';
export * from './anthropic-adapter';

import { AIConfig } from '../config';
import { AIProviderAdapter } from './types';
import { DemoAdapter } from './demo-adapter';
import { OpenAIAdapter } from './openai-adapter';
import { GeminiAdapter } from './gemini-adapter';
import { AnthropicAdapter } from './anthropic-adapter';

export function createChatProvider(config: AIConfig): AIProviderAdapter {
  const chat = config.capabilities.chatStreaming;
  switch (chat.provider.toLowerCase()) {
    case 'openai':
      return new OpenAIAdapter({
        apiKey: chat.apiKey,
        model: chat.model,
        endpoint: chat.endpoint,
        temperature: chat.temperature
      });
    case 'gemini':
      return new GeminiAdapter({
        apiKey: chat.apiKey,
        model: chat.model,
        endpoint: chat.endpoint,
        temperature: chat.temperature
      });
    case 'anthropic':
      return new AnthropicAdapter({
        apiKey: chat.apiKey,
        model: chat.model,
        endpoint: chat.endpoint
      });
    case 'demo':
    case 'mock':
    default:
      return new DemoAdapter();
  }
}
