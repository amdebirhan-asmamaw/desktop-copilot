import { STTService, TranscriptEvent } from '../types';
import { AudioChunk } from '@repo/capture';
import { CapabilityModelConfig } from '../config';

export class ConfigurableSTTService implements STTService {
  private config: CapabilityModelConfig;

  constructor(config: CapabilityModelConfig) {
    this.config = config;
  }

  async transcribeChunk(chunk: AudioChunk): Promise<TranscriptEvent | null> {
    if (!chunk.isSpeech) return null;
    return {
      text: chunk.source === 'MICROPHONE' ? 'I am explaining the database schema.' : 'What is the recovery protocol?',
      isFinal: true,
      speaker: chunk.source === 'MICROPHONE' ? 'USER' : 'REMOTE_SPEAKER',
      timestamp: chunk.timestamp
    };
  }
}
