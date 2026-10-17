export interface VadChunkerOptions {
  energyThreshold?: number;
  sampleRate?: number;
}

export class VadChunker {
  private energyThreshold: number;

  constructor(options: VadChunkerOptions = {}) {
    this.energyThreshold = options.energyThreshold ?? 0.02;
  }

  isSpeech(buffer: Float32Array): boolean {
    if (buffer.length === 0) return false;
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      const val = buffer[i] ?? 0;
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    return rms >= this.energyThreshold;
  }
}
