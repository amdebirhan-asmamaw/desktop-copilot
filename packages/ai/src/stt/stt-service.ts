import { STTService, TranscriptEvent } from '../types';
import { AudioChunk, encodeWav } from '@repo/capture';
import { CapabilityModelConfig } from '../config';
import { GeminiSTTProvider } from './gemini-stt-provider';

export class ConfigurableSTTService implements STTService {
  private config: CapabilityModelConfig;
  private geminiStt?: GeminiSTTProvider;

  constructor(config: CapabilityModelConfig) {
    this.config = config;
    if (config.apiKey && config.provider !== 'mock') {
      this.geminiStt = new GeminiSTTProvider({
        apiKey: config.apiKey,
        model: config.model || 'gemini-3.8-flash'
      });
    }
  }

  async transcribeChunk(chunk: AudioChunk): Promise<TranscriptEvent | null> {
    if (!chunk.isSpeech) return null;

    if (this.geminiStt) {
      const wav = encodeWav(chunk.pcmData, chunk.sampleRate);
      const text = await this.geminiStt.transcribeAudio(wav);
      if (text && text.trim().length > 0) {
        return {
          text: text.trim(),
          isFinal: true,
          speaker: chunk.source === 'MICROPHONE' ? 'USER' : 'REMOTE_SPEAKER',
          timestamp: chunk.timestamp
        };
      }
    }

    // Explicit Mock fallback when provider is mock
    if (this.config.provider === 'mock') {
      return {
        text: chunk.source === 'MICROPHONE' ? 'I am explaining the database schema.' : 'What is the recovery protocol?',
        isFinal: true,
        speaker: chunk.source === 'MICROPHONE' ? 'USER' : 'REMOTE_SPEAKER',
        timestamp: chunk.timestamp
      };
    }

    return null;
  }

  async transcribeWav(
    wavBuffer: Buffer,
    source: 'MICROPHONE' | 'SYSTEM_LOOPBACK'
  ): Promise<TranscriptEvent | null> {
    if (this.geminiStt) {
      const text = await this.geminiStt.transcribeAudio(wavBuffer);
      if (text && text.trim().length > 0) {
        return {
          text: text.trim(),
          isFinal: true,
          speaker: source === 'MICROPHONE' ? 'USER' : 'REMOTE_SPEAKER',
          timestamp: Date.now()
        };
      }
    }

    if (this.config.provider === 'mock') {
      return {
        text: source === 'MICROPHONE' ? 'I am explaining the database schema.' : 'What is the recovery protocol?',
        isFinal: true,
        speaker: source === 'MICROPHONE' ? 'USER' : 'REMOTE_SPEAKER',
        timestamp: Date.now()
      };
    }

    return null;
  }
}
