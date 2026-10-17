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
