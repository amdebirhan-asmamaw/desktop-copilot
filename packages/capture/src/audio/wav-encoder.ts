export function encodeWav(samples: Float32Array, sampleRate: number = 16000): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8);

  // "fmt " sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // audioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22);  // numChannels (1 mono)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byteRate (sampleRate * numChannels * bitsPerSample/8)
  buffer.writeUInt16LE(2, 32);  // blockAlign
  buffer.writeUInt16LE(16, 34); // bitsPerSample (16-bit)

  // "data" sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);

  // Write 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(Math.round(val), offset);
    offset += 2;
  }

  return buffer;
}
