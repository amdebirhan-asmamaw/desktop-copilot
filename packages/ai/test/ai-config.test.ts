import { describe, it, expect } from 'vitest';
import { parseAIConfig, loadAIConfigFromEnv } from '../src/config';

describe('AI Config Validator', () => {
  it('loads arbitrary model strings from configuration without hardcoded restrictions', () => {
    const rawConfig = {
      capabilities: {
        stt: {
          provider: 'openai',
          model: 'whisper-custom-finetune-v2',
          apiKey: 'sk-test-key'
        },
        vision: {
          provider: 'anthropic',
          model: 'claude-next-gen-vision',
          apiKey: 'sk-ant-test'
        },
        chatStreaming: {
          provider: 'gemini',
          model: 'gemini-flash-experimental',
          apiKey: 'gm-test-key'
        }
      }
    };

    const parsed = parseAIConfig(rawConfig);
    expect(parsed.capabilities.stt.model).toBe('whisper-custom-finetune-v2');
    expect(parsed.capabilities.vision.model).toBe('claude-next-gen-vision');
    expect(parsed.capabilities.chatStreaming.model).toBe('gemini-flash-experimental');
  });

  it('loads AI config from environment variables and falls back to sensible defaults', () => {
    const mockEnv = {
      OPENAI_API_KEY: 'sk-test-openai-key',
      AI_CHAT_MODEL: 'gpt-4o-mini',
      DEEPGRAM_API_KEY: 'dg-test-key'
    };

    const config = loadAIConfigFromEnv(mockEnv);
    expect(config.capabilities.chatStreaming.provider).toBe('openai');
    expect(config.capabilities.chatStreaming.model).toBe('gpt-4o-mini');
    expect(config.capabilities.chatStreaming.apiKey).toBe('sk-test-openai-key');
    expect(config.capabilities.stt.provider).toBe('deepgram');
    expect(config.capabilities.stt.model).toBe('nova-2');
  });

  it('provides mock defaults when no environment variables are present', () => {
    const config = loadAIConfigFromEnv({});
    expect(config.capabilities.chatStreaming.provider).toBe('mock');
    expect(config.capabilities.chatStreaming.apiKey).toBe('local');
    expect(config.capabilities.vision.provider).toBe('mock');
    expect(config.capabilities.stt.provider).toBe('mock');
  });
});
