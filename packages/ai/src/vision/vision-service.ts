import { VisionService } from '../types';
import { ScreenSnapshot } from '@repo/capture';
import { CapabilityModelConfig } from '../config';

export class ConfigurableVisionService implements VisionService {
  private config: CapabilityModelConfig;

  constructor(config: CapabilityModelConfig) {
    this.config = config;
  }

  async analyzeScreen(snapshot: ScreenSnapshot, prompt?: string): Promise<string> {
    return `Screen Analysis (${snapshot.width}x${snapshot.height}): Identified active code editor discussing distributed consensus.`;
  }
}
