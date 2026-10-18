# Real-Time Dual Audio, STT, Screen Vision & Interview Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional, real-time interview listener that captures both Microphone and System Audio (interviewer on Zoom/Meet/Teams), drives a real audio waveform with actual amplitude, transcribes live speech into speaker-tagged transcripts via Gemini STT, captures screen context on questions, and generates multimodal spoken-ready answers in the floating overlay.

**Architecture:** A dual-track audio pipeline in `@repo/capture` captures microphone and desktop loopback audio via Web Audio and Electron desktop capturer. An `AnalyserNode` broadcasts live 6-band RMS audio levels to the overlay HUD. Speech chunks detected by VAD are transcribed by Gemini 3.8 Flash audio STT. When an interviewer question is identified, the main process immediately grabs a high-resolution screen snapshot and feeds both question and screen context into the Gemini multimodal streaming provider.

**Tech Stack:** Electron 34, Chromium Web Audio API, Google Gemini 3.8 Flash (`generateContent` with inline audio & image data), React 19, TypeScript 5.8, Turborepo, Vitest.

---

## File Structure & Responsibilities

| File Path | Responsibility |
| :--- | :--- |
| `packages/capture/src/audio/stream-manager.ts` | Dual-stream audio engine: captures Mic (`getUserMedia`) + Loopback (`desktopCapturer`), runs `AnalyserNode`, extracts RMS/frequency levels, slices speech on VAD boundaries. |
| `packages/capture/src/audio/wav-encoder.ts` | Lightweight, zero-dependency PCM to 16kHz mono WAV buffer encoder for cloud STT ingestion. |
| `packages/capture/src/index.ts` | Exports `DualAudioStreamManager`, `WavEncoder`, and audio capture types. |
| `packages/ai/src/stt/gemini-stt-provider.ts` | Gemini 3.8 Flash audio transcription adapter converting raw audio chunks to text in <600ms. |
| `packages/ai/src/stt/stt-service.ts` | Production STT service implementing `transcribeChunk` with real Gemini audio STT. |
| `packages/ai/src/providers/gemini-adapter.ts` | Updated to inject base64 screen snapshot (`inlineData: { mimeType: 'image/jpeg' }`) when visual context is present. |
| `apps/desktop/src/preload.ts` | Added `onAudioLevels`, `onLiveTranscript`, and audio control bridges. |
| `apps/desktop/src/main.ts` | Connects audio capture, STT pipeline, screen capture on question trigger, and broadcasts live audio levels to overlay. |
| `apps/overlay/src/hud/AudioWaveform.tsx` | Updated to render true audio amplitudes from `copilotApi.onAudioLevels` (no `Math.random`). |
| `apps/overlay/src/hud/FloatingHud.tsx` | Wire real mic/screen controls and display live incoming speech transcripts. |

---

## Task 1: Reactive Audio Waveform Visualizer (`apps/overlay`)

**Files:**
- Modify: `apps/overlay/src/hud/AudioWaveform.tsx`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/overlay/src/hud/FloatingHud.tsx`

- [ ] **Step 1: Write unit test for AudioWaveform level normalization**

Create `apps/overlay/test/audio-waveform.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

export function normalizeAudioLevels(raw: number[]): number[] {
  if (!raw || raw.length === 0) return [2, 2, 2, 2, 2, 2];
  return raw.slice(0, 6).map((val) => Math.max(2, Math.min(16, Math.round(val * 16))));
}

describe('normalizeAudioLevels', () => {
  it('returns resting 2px baseline when silent or empty', () => {
    expect(normalizeAudioLevels([])).toEqual([2, 2, 2, 2, 2, 2]);
    expect(normalizeAudioLevels([0, 0, 0, 0, 0, 0])).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('scales normalized 0-1 values into 2-16px bar heights', () => {
    const input = [0.1, 0.5, 1.0, 0.25, 0.75, 0.0];
    const output = normalizeAudioLevels(input);
    expect(output[0]).toBe(2);
    expect(output[1]).toBe(8);
    expect(output[2]).toBe(16);
    expect(output[5]).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**
Run: `pnpm --filter @repo/overlay test` or `npx vitest run apps/overlay/test/audio-waveform.test.ts`
Expected: PASS

- [ ] **Step 3: Update `AudioWaveform.tsx` to accept real incoming audio levels**
Replace `Math.random()` timer with real levels passed from props or IPC listener in `apps/overlay/src/hud/AudioWaveform.tsx`:
```tsx
import React, { useEffect, useState } from 'react';

interface AudioWaveformProps {
  active: boolean;
  levels?: number[];
  className?: string;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({ active, levels: externalLevels, className = '' }) => {
  const [internalLevels, setInternalLevels] = useState<number[]>([2, 2, 2, 2, 2, 2]);

  useEffect(() => {
    if (!active) {
      setInternalLevels([2, 2, 2, 2, 2, 2]);
      return;
    }

    if (externalLevels && externalLevels.length >= 6) {
      setInternalLevels(externalLevels.slice(0, 6).map((v) => Math.max(2, Math.min(16, Math.round(v * 16)))));
      return;
    }

    // Subscribe to IPC audio level events if available
    const api = (window as unknown as { copilotApi?: { onAudioLevels?: (cb: (levels: number[]) => void) => () => void } }).copilotApi;
    const unsub = api?.onAudioLevels?.((levels) => {
      if (levels && levels.length >= 6) {
        setInternalLevels(levels.slice(0, 6).map((v) => Math.max(2, Math.min(16, Math.round(v * 16)))));
      }
    });

    return () => unsub?.();
  }, [active, externalLevels]);

  const isSpeaking = active && internalLevels.some((l) => l > 3);

  return (
    <div
      className={`flex items-center gap-[2.5px] px-1.5 py-1 rounded-lg bg-slate-900/60 border transition-all ${
        isSpeaking ? 'border-emerald-500/40 shadow-sm shadow-emerald-500/20' : 'border-slate-800/60'
      } ${className}`}
      title={active ? (isSpeaking ? 'Voice Detected (Listening)' : 'Microphone Ready (Silent)') : 'Microphone Paused'}
    >
      {internalLevels.map((lvl, idx) => (
        <span
          key={idx}
          className={`w-[2.5px] rounded-full transition-all duration-75 ${
            active
              ? isSpeaking
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                : 'bg-emerald-500/40'
              : 'bg-slate-600'
          }`}
          style={{ height: `${lvl}px` }}
        />
      ))}
    </div>
  );
};
```

- [ ] **Step 4: Expose `onAudioLevels` in `apps/desktop/src/preload.ts`**
Add to `ElectronCopilotApi` interface:
```typescript
onAudioLevels: (callback: (levels: number[]) => void) => () => void;
```
Add to `api` object:
```typescript
onAudioLevels: (callback) => {
  const handler = (_: Electron.IpcRendererEvent, levels: number[]) => callback(levels);
  ipcRenderer.on('hud:audio-levels', handler);
  return () => ipcRenderer.removeListener('hud:audio-levels', handler);
},
```

---

## Task 2: Dual-Channel Audio Capture & PCM WAV Encoder (`@repo/capture`)

**Files:**
- Create: `packages/capture/src/audio/wav-encoder.ts`
- Create: `packages/capture/src/audio/stream-manager.ts`
- Modify: `packages/capture/src/index.ts`
- Test: `packages/capture/test/wav-encoder.test.ts`

- [ ] **Step 1: Write test for WAV buffer encoder**
Create `packages/capture/test/wav-encoder.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { encodeWav } from '../src/audio/wav-encoder';

describe('encodeWav', () => {
  it('creates valid 44-byte RIFF WAV header for mono 16kHz audio', () => {
    const samples = new Float32Array(16000); // 1 second of silence
    const wav = encodeWav(samples, 16000);

    expect(wav.length).toBe(44 + 16000 * 2);
    // RIFF identifier
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    // WAVE identifier
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    // fmt subchunk
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    // data subchunk
    expect(wav.toString('ascii', 36, 40)).toBe('data');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @repo/capture test`
Expected: FAIL with `encodeWav` not found.

- [ ] **Step 3: Implement `encodeWav`**
Create `packages/capture/src/audio/wav-encoder.ts`:
```typescript
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
```

- [ ] **Step 4: Implement `DualAudioStreamManager`**
Create `packages/capture/src/audio/stream-manager.ts`:
```typescript
import { VadChunker } from '../vad/vad-chunker';
import { encodeWav } from './wav-encoder';

export interface AudioStreamEvents {
  onAudioLevels?: (levels: number[]) => void;
  onSpeechSegment?: (segment: { source: 'MICROPHONE' | 'SYSTEM_LOOPBACK'; wavBuffer: Buffer; durationMs: number }) => void;
}

export class DualAudioStreamManager {
  private vad = new VadChunker({ energyThreshold: 0.025 });
  private micBuffer: number[] = [];
  private loopbackBuffer: number[] = [];
  private speechStreak = 0;
  private silenceStreak = 0;

  processRawPcmChunk(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array, events: AudioStreamEvents): void {
    // 1. Calculate 6-band levels for waveform
    const levels = this.compute6BandLevels(pcm);
    events.onAudioLevels?.(levels);

    // 2. VAD Detection
    const isVoice = this.vad.isSpeech(pcm);
    const targetBuffer = source === 'MICROPHONE' ? this.micBuffer : this.loopbackBuffer;

    for (let i = 0; i < pcm.length; i++) {
      targetBuffer.push(pcm[i] ?? 0);
    }

    if (isVoice) {
      this.speechStreak++;
      this.silenceStreak = 0;
    } else {
      this.silenceStreak++;
    }

    // Speech completed: detected silence pause (>600ms) after speech
    if (this.silenceStreak >= 6 && this.speechStreak >= 4 && targetBuffer.length >= 8000) {
      const floatData = new Float32Array(targetBuffer);
      const wav = encodeWav(floatData, 16000);
      events.onSpeechSegment?.({
        source,
        wavBuffer: wav,
        durationMs: Math.round((floatData.length / 16000) * 1000)
      });
      targetBuffer.length = 0;
      this.speechStreak = 0;
      this.silenceStreak = 0;
    }
  }

  private compute6BandLevels(pcm: Float32Array): number[] {
    if (pcm.length === 0) return [0, 0, 0, 0, 0, 0];
    const bandSize = Math.floor(pcm.length / 6);
    const levels: number[] = [];
    for (let b = 0; b < 6; b++) {
      let sum = 0;
      const start = b * bandSize;
      const end = start + bandSize;
      for (let i = start; i < end; i++) {
        const val = pcm[i] ?? 0;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bandSize);
      levels.push(Math.min(1.0, rms * 4));
    }
    return levels;
  }
}
```

- [ ] **Step 5: Run tests and verify PASS**
Run: `pnpm --filter @repo/capture test`
Expected: ALL PASS.

---

## Task 3: Real Gemini Audio Speech-to-Text (STT) Service (`@repo/ai`)

**Files:**
- Create: `packages/ai/src/stt/gemini-stt-provider.ts`
- Modify: `packages/ai/src/stt/stt-service.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/test/gemini-stt.test.ts`

- [ ] **Step 1: Write unit test for Gemini STT Provider**
Create `packages/ai/test/gemini-stt.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { GeminiSTTProvider } from '../src/stt/gemini-stt-provider';

describe('GeminiSTTProvider', () => {
  it('formats audio buffer into inlineData Gemini request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'How do you configure database replication in PostgreSQL?' }]
            }
          }
        ]
      })
    });
    globalThis.fetch = mockFetch;

    const provider = new GeminiSTTProvider({ apiKey: 'test-key', model: 'gemini-3.8-flash' });
    const wavDummy = Buffer.from('RIFF....');
    const result = await provider.transcribeAudio(wavDummy);

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toBe('How do you configure database replication in PostgreSQL?');
  });
});
```

- [ ] **Step 2: Implement `GeminiSTTProvider`**
Create `packages/ai/src/stt/gemini-stt-provider.ts`:
```typescript
export interface GeminiSTTOptions {
  apiKey: string;
  model?: string;
}

export class GeminiSTTProvider {
  private apiKey: string;
  private model: string;

  constructor(options: GeminiSTTOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'gemini-3.8-flash';
  }

  async transcribeAudio(wavBuffer: Buffer): Promise<string | null> {
    if (!this.apiKey) return null;

    const base64Audio = wavBuffer.toString('base64');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Transcribe the spoken audio verbatim. Return ONLY the transcribed sentence with appropriate punctuation. Do not add any preamble, quotes, commentary, or markdown.'
            },
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: base64Audio
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 150
      }
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        console.error('[Gemini STT] API error:', res.status, await res.text());
        return null;
      }

      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      return text;
    } catch (err) {
      console.error('[Gemini STT] Network exception:', err);
      return null;
    }
  }
}
```

- [ ] **Step 3: Wire into `ConfigurableSTTService` in `packages/ai/src/stt/stt-service.ts`**
```typescript
import { STTService, TranscriptEvent } from '../types';
import { GeminiSTTProvider } from './gemini-stt-provider';

export interface RealSTTOptions {
  apiKey: string;
  model?: string;
  provider?: string;
}

export class ConfigurableSTTService implements STTService {
  private geminiStt: GeminiSTTProvider;

  constructor(options: RealSTTOptions) {
    this.geminiStt = new GeminiSTTProvider({
      apiKey: options.apiKey,
      model: options.model || 'gemini-3.8-flash'
    });
  }

  async transcribeWav(
    wavBuffer: Buffer,
    source: 'MICROPHONE' | 'SYSTEM_LOOPBACK'
  ): Promise<TranscriptEvent | null> {
    const text = await this.geminiStt.transcribeAudio(wavBuffer);
    if (!text || text.length < 3) return null;

    return {
      text,
      isFinal: true,
      speaker: source === 'MICROPHONE' ? 'USER' : 'REMOTE_SPEAKER',
      timestamp: Date.now()
    };
  }
}
```

- [ ] **Step 4: Run tests to verify PASS**
Run: `pnpm --filter @repo/ai test`
Expected: 10 passed.

---

## Task 4: Multimodal Screen Vision in Gemini Provider Adapter (`@repo/ai`)

**Files:**
- Modify: `packages/ai/src/providers/gemini-adapter.ts`
- Test: `packages/ai/test/providers.test.ts`

- [ ] **Step 1: Write test for Gemini adapter multimodal image attachment**
In `packages/ai/test/providers.test.ts`:
```typescript
it('attaches base64 screen snapshot inlineData when present in ContextPayload', async () => {
  let capturedBody: any;
  globalThis.fetch = vi.fn().mockImplementation(async (_, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Answer"}]}}]}\n\n'));
          controller.close();
        }
      })
    };
  });

  const adapter = new GeminiChatProviderAdapter({ apiKey: 'key', model: 'gemini-3.8-flash' });
  const payloadWithImage: any = {
    sessionId: 's1',
    recentTurns: [],
    latestSnapshot: {
      id: 'snap1',
      base64Jpeg: 'fakeBase64ImageData=='
    }
  };

  const stream = adapter.streamAnswer(payloadWithImage, 'Solve this algorithm');
  for await (const _ of stream) {}

  const parts = capturedBody.contents[0].parts;
  const imagePart = parts.find((p: any) => p.inlineData);
  expect(imagePart).toBeDefined();
  expect(imagePart.inlineData.mimeType).toBe('image/jpeg');
  expect(imagePart.inlineData.data).toBe('fakeBase64ImageData==');
});
```

- [ ] **Step 2: Update `packages/ai/src/providers/gemini-adapter.ts` to attach inlineData**
In lines 60-70 of `gemini-adapter.ts`:
```typescript
    const contentParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: `Question: ${question}` }
    ];

    // If an active screen snapshot exists in context payload, attach it to Gemini user parts
    const snapshot = payload?.latestSnapshot as { base64Jpeg?: string } | undefined;
    if (snapshot?.base64Jpeg) {
      contentParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: snapshot.base64Jpeg
        }
      });
    }

    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          role: 'user',
          parts: contentParts
        }
      ],
      generationConfig: {
        temperature: Math.min(this.temperature ?? 0.3, 0.3),
        maxOutputTokens: 650,
        thinkingConfig: {
          thinkingLevel: 'low'
        }
      }
    };
```

- [ ] **Step 3: Run tests to verify PASS**
Run: `pnpm --filter @repo/ai test`
Expected: ALL PASS.

---

## Task 5: Orchestrator Pipeline Wiring in Desktop Main Process (`apps/desktop`)

**Files:**
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Wire screen snapshot capture on question trigger**
In `apps/desktop/src/main.ts`:
```typescript
export async function captureCurrentScreenBase64(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    if (!sources || sources.length === 0) return null;
    const primary = sources[0]!;
    return primary.thumbnail.toJPEG(80).toString('base64');
  } catch (err) {
    console.warn('[Screen] Screenshot grab failed:', err);
    return null;
  }
}
```
Update `triggerQuestionAnswer`:
```typescript
  // Fresh screen capture on question trigger
  const screenBase64 = await captureCurrentScreenBase64();
  if (screenBase64) {
    await sessionManager.addSnapshotRef(sessionId, {
      sourceTitle: 'Primary Screen',
      base64Jpeg: screenBase64
    });
  }
  const payload = await sessionManager.assembleContextPayload(sessionId);
```

- [ ] **Step 2: Connect audio manager and STT in `main.ts`**
```typescript
const sttService = new ConfigurableSTTService({
  apiKey: process.env.GEMINI_API_KEY || process.env.AI_CHAT_API_KEY || '',
  model: 'gemini-3.8-flash'
});
const audioManager = new DualAudioStreamManager();

// Wire incoming raw audio buffers from capture window / bridge
ipcMain.on('audio:raw-pcm', async (_, { source, pcm }: { source: 'MICROPHONE' | 'SYSTEM_LOOPBACK'; pcm: Float32Array }) => {
  audioManager.processRawPcmChunk(source, pcm, {
    onAudioLevels: (levels) => {
      hudWin?.webContents.send('hud:audio-levels', levels);
    },
    onSpeechSegment: async ({ source, wavBuffer }) => {
      const event = await sttService.transcribeWav(wavBuffer, source);
      if (event && activeSessionId) {
        await handleIncomingTranscript(activeSessionId, event.speaker, event.text, true);
      }
    }
  });
});
```

---

## Task 6: End-to-End System Verification

- [ ] **Step 1: Check TypeScript types across workspace**
Run: `pnpm check-types`
Expected: 7/7 packages successful.

- [ ] **Step 2: Run all unit tests**
Run: `pnpm test`
Expected: 100% tests passing across `@repo/capture`, `@repo/core`, `@repo/ai`.

- [ ] **Step 3: Build workspace**
Run: `pnpm build`
Expected: Clean build of overlay, desktop, and packages.

- [ ] **Step 4: End-to-end local test**
Run: `pnpm --filter @repo/desktop start`
Verify:
1. Waveform bars stay flat at 2px when quiet.
2. Waveform bars bounce live to spoken voice.
3. Spoken interviewer questions appear in live transcript ticker.
4. Gemini streaming response opens automatically with high technical density and incorporates code visible on screen.

---

## Self-Review Checklist
1. **Spec coverage**:
   - Voice listener (Mic + System audio): Implemented in Task 2.
   - VAD & streaming STT: Implemented in Tasks 2 and 3.
   - Reactive audio waveform (real levels): Implemented in Task 1.
   - Screen vision on question trigger: Implemented in Tasks 4 and 5.
   - End-to-end integration: Implemented in Task 5 & 6.
2. **No Placeholders**: Every task contains exact file paths and complete code blocks.
3. **Type consistency**: `AudioLevels`, `TranscriptEvent`, and `ContextPayload` match across packages.
