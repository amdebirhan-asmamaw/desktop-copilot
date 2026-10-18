export interface CapabilityModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  endpoint?: string;
  temperature?: number;
}

export interface AIConfig {
  capabilities: {
    stt: CapabilityModelConfig;
    vision: CapabilityModelConfig;
    chatStreaming: CapabilityModelConfig;
  };
}

export function parseAIConfig(input: unknown): AIConfig {
  const cfg = input as AIConfig;
  if (!cfg?.capabilities?.stt?.model) {
    throw new Error('Missing STT model configuration');
  }
  if (!cfg?.capabilities?.vision?.model) {
    throw new Error('Missing Vision model configuration');
  }
  if (!cfg?.capabilities?.chatStreaming?.model) {
    throw new Error('Missing ChatStreaming model configuration');
  }
  return cfg;
}

export function loadAIConfigFromEnv(env: Record<string, string | undefined> = process.env): AIConfig {
  const chatProvider = env.AI_CHAT_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : env.GEMINI_API_KEY ? 'gemini' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock');
  const chatModel = env.AI_CHAT_MODEL || (chatProvider === 'openai' ? 'gpt-4o' : chatProvider === 'gemini' ? 'gemini-2.0-flash' : chatProvider === 'anthropic' ? 'claude-3-7-sonnet' : 'custom-streaming-model');
  const chatApiKey = env.AI_CHAT_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY || 'local';

  const visionProvider = env.AI_VISION_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : env.GEMINI_API_KEY ? 'gemini' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock');
  const visionModel = env.AI_VISION_MODEL || (visionProvider === 'openai' ? 'gpt-4o' : visionProvider === 'gemini' ? 'gemini-2.0-flash' : visionProvider === 'anthropic' ? 'claude-3-7-sonnet' : 'custom-vision-model');
  const visionApiKey = env.AI_VISION_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY || 'local';

  const sttProvider = env.AI_STT_PROVIDER || (env.DEEPGRAM_API_KEY ? 'deepgram' : env.OPENAI_API_KEY ? 'openai' : 'mock');
  const sttModel = env.AI_STT_MODEL || (sttProvider === 'deepgram' ? 'nova-2' : sttProvider === 'openai' ? 'whisper-1' : 'custom-stt-model');
  const sttApiKey = env.AI_STT_API_KEY || env.DEEPGRAM_API_KEY || env.OPENAI_API_KEY || 'local';

  return {
    capabilities: {
      chatStreaming: {
        provider: chatProvider,
        model: chatModel,
        apiKey: chatApiKey,
        endpoint: env.AI_CHAT_ENDPOINT,
        temperature: env.AI_CHAT_TEMPERATURE ? parseFloat(env.AI_CHAT_TEMPERATURE) : 0.7
      },
      vision: {
        provider: visionProvider,
        model: visionModel,
        apiKey: visionApiKey,
        endpoint: env.AI_VISION_ENDPOINT
      },
      stt: {
        provider: sttProvider,
        model: sttModel,
        apiKey: sttApiKey,
        endpoint: env.AI_STT_ENDPOINT
      }
    }
  };
}
