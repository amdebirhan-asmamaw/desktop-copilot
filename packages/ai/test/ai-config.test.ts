import { describe, it, expect } from 'vitest';
import { parseAIConfig } from '../src/config';

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
});
