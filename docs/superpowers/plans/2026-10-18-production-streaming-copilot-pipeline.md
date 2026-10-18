# Production Streaming Copilot Architecture & Scalability Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Desktop Copilot into an ultra-low latency, professional-grade meeting assistant with sub-250ms streaming STT (Deepgram Nova-2 with real WebSocket lifecycle + Gemini Flash fallback), zero mock speech generation, live interim HUD feedback, isolated per-source audio sessions, and complete window management (minimize/tray/quit).

**Architecture:** A resilient hybrid pipeline separating interim visual feedback from finalized question reasoning. Low-level 16kHz PCM streams from candidate mic and Windows loopback are fed to two dedicated, permanently bound `DeepgramStreamingSession` instances over persistent WebSockets. Interim hypotheses (`is_final: false`) update the HUD subtitle ticker in real time without touching the database or triggering the LLM. Complete utterances (`speech_final: true` or `UtteranceEnd`) are committed to session history and evaluated by the intent detector; if a question is identified, the active display is captured and fed alongside the question to Gemini 3.8 Flash. Mock audio generation is completely eliminated.

**Tech Stack:** Node.js, Electron, TypeScript, Web Audio API, WebSocket (`ws`), Deepgram Nova-2, Gemini 3.8 Flash Multimodal API, Turborepo, Vitest.

---

## Critical Invariants & Rules

1. **Zero Mock Transcripts in Runtime:** Never synthesize or fake conversational questions (`"What is the recovery protocol?"`). If no API key is set or services fail, transition to an explicit `STT_UNAVAILABLE` or `NO_API_KEY` status displayed in the HUD pill.
2. **Interim vs. Final Boundary Separation:**
   - `is_final: false`: Goes to HUD ticker ONLY. Never saved to history, never triggers question detector.
   - `is_final: true`: Appended to current utterance accumulator buffer.
   - `speech_final: true` or `UtteranceEnd`: Emits the fully accumulated sentence. Only this event reaches `sessionManager.appendTranscript()` and `pipeline.processTranscriptChunk()`.
3. **Dedicated Per-Source Sessions:** Microphone and system loopback run on two independent streaming WebSocket sessions permanently bound to `'USER'` and `'REMOTE_SPEAKER'`. Audio frames never interleave.
4. **Hard Cancellation on Stop:** Clicking Stop immediately aborts active AbortControllers, clears pending retry timers, and drops any queued inferences.

---

## File Structure Map

| File Path | Purpose |
| :--- | :--- |
| `packages/ai/src/stt/deepgram-streaming-session.ts` | Complete WebSocket streaming client (`ws`) with `connect()`, `sendAudio()`, keep-alive, auto-reconnect, and speaker binding |
| `packages/ai/src/stt/deepgram-stream-coordinator.ts` | Manages dual sessions (`USER` vs `REMOTE_SPEAKER`), connection state machine, and fallback to Gemini |
| `packages/ai/src/stt/stt-service.ts` | Multi-engine STT interface with zero mock audio generation |
| `packages/ai/test/deepgram-streaming.test.ts` | Unit tests verifying full WebSocket connection lifecycle, message handling, and reconnection backoff |
| `packages/core/src/pipeline/orchestration-pipeline.ts` | Explicit separation of interim transcript routing vs finalized question detection |
| `apps/desktop/src/main.ts` | Dual-session audio routing, active display screen targeting, and window controls (`app:quit`, `app:minimize`) |
| `apps/desktop/src/preload.ts` | Bridge methods for audio streaming, interim transcript events, and window management |
| `apps/overlay/src/hud/FloatingHud.tsx` | Real-time interim transcript subtitle ticker below waveform, status badges, and window controls |

---

## Detailed Task Decomposition

### Task 1: Complete Elimination of Mock Transcripts & Status Transparency

**Files:**
- Modify: `packages/ai/src/stt/stt-service.ts`
- Modify: `packages/ai/src/config.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Verify `packages/ai/src/stt/stt-service.ts` returns `null` when unconfigured**
Ensure all mock question strings (`"What is the recovery protocol?"` and `"I am explaining the database schema."`) are completely deleted. When no API key is provided or transcription is empty, return `null`.

- [ ] **Step 2: Add status reflection in `main.ts`**
In `apps/desktop/src/main.ts`, if `aiConfig.capabilities.stt.apiKey` is missing or unconfigured, emit an explicit `stt:status` event with `{ status: 'UNCONFIGURED' }` to the overlay so the user sees "STT: Needs API Key" in the HUD rather than silence or fake text.

- [ ] **Step 3: Verify with unit tests**
Run: `pnpm --filter @repo/ai test`
Expected: All tests pass with zero mock speech injection.

---

### Task 2: Real Deepgram WebSocket Streaming Session (`@repo/ai`)

**Files:**
- Create: `packages/ai/src/stt/deepgram-streaming-session.ts`
- Create: `packages/ai/test/deepgram-streaming.test.ts`

- [ ] **Step 1: Write comprehensive unit test for Deepgram WebSocket lifecycle**
Create `packages/ai/test/deepgram-streaming.test.ts` testing:
1. `connect()` opens WebSocket with correct auth headers and query parameters (`interim_results=true&smart_format=true&endpointing=300&utterance_end_ms=1000`).
2. `sendAudio()` transmits binary Int16 PCM chunks when connected, or buffers during connection.
3. `is_final: false` emits interim event with `isFinal: false`.
4. `is_final: true` accumulates text segments.
5. `speech_final: true` or `UtteranceEnd` flushes the full accumulated utterance with `isFinal: true`.
6. Network close triggers auto-reconnect with exponential backoff (up to 3 attempts).

- [ ] **Step 2: Implement `DeepgramStreamingSession`**
Create `packages/ai/src/stt/deepgram-streaming-session.ts`:
```typescript
import WebSocket from 'ws';
import { TranscriptEvent } from '../types';

export interface DeepgramSessionConfig {
  apiKey: string;
  speaker: 'USER' | 'REMOTE_SPEAKER';
  model?: string;
  sampleRate?: number;
  onInterim: (text: string, speaker: 'USER' | 'REMOTE_SPEAKER') => void;
  onFinalUtterance: (event: TranscriptEvent) => void;
  onError?: (err: Error) => void;
  onStatusChange?: (status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED') => void;
}

export class DeepgramStreamingSession {
  private ws: WebSocket | null = null;
  private currentUtteranceSegments: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private isExplicitlyClosed = false;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor(private config: DeepgramSessionConfig) {}

  connect(): void {
    if (this.isExplicitlyClosed) return;
    this.config.onStatusChange?.('CONNECTING');

    const params = new URLSearchParams({
      model: this.config.model || 'nova-2',
      encoding: 'linear16',
      sample_rate: String(this.config.sampleRate || 16000),
      channels: '1',
      punctuate: 'true',
      interim_results: 'true',
      smart_format: 'true',
      endpointing: '300',
      utterance_end_ms: '1000'
    });

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.config.apiKey}` }
    });

    this.ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.config.onStatusChange?.('CONNECTED');
      this.startKeepAlive();
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.handleServerMessage(data.toString());
    });

    this.ws.on('close', () => {
      this.stopKeepAlive();
      this.config.onStatusChange?.('DISCONNECTED');
      if (!this.isExplicitlyClosed) {
        this.attemptReconnect();
      }
    });

    this.ws.on('error', (err) => {
      this.config.onError?.(err);
    });
  }

  sendAudio(pcmChunk: Buffer | Int16Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pcmChunk);
    }
  }

  private handleServerMessage(jsonStr: string): void {
    try {
      const msg = JSON.parse(jsonStr);

      if (msg.type === 'UtteranceEnd') {
        this.flushUtterance();
        return;
      }

      const alt = msg.channel?.alternatives?.[0];
      const text = alt?.transcript?.trim();
      if (!text) return;

      if (!msg.is_final) {
        // Interim guess -> send to HUD ticker only
        this.config.onInterim(text, this.config.speaker);
      } else {
        // Segment locked -> accumulate
        this.currentUtteranceSegments.push(text);
        if (msg.speech_final) {
          this.flushUtterance();
        }
      }
    } catch (err) {
      this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private flushUtterance(): void {
    if (this.currentUtteranceSegments.length === 0) return;
    const fullText = this.currentUtteranceSegments.join(' ').trim();
    this.currentUtteranceSegments = [];
    if (fullText.length > 0) {
      this.config.onFinalUtterance({
        text: fullText,
        speaker: this.config.speaker,
        isFinal: true,
        timestamp: Date.now()
      });
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.config.onStatusChange?.('FAILED');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.pow(2, this.reconnectAttempts) * 500;
    setTimeout(() => this.connect(), delay);
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, 8000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  close(): void {
    this.isExplicitlyClosed = true;
    this.stopKeepAlive();
    this.ws?.close();
    this.ws = null;
  }
}
```

- [ ] **Step 3: Run unit tests**
Run: `pnpm --filter @repo/ai test test/deepgram-streaming.test.ts`
Expected: PASS (all tests pass)

---

### Task 3: Dual-Source Streaming Coordinator (`@repo/ai`)

**Files:**
- Create: `packages/ai/src/stt/deepgram-stream-coordinator.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Implement `DeepgramStreamCoordinator`**
Manages two independent `DeepgramStreamingSession` instances:
- `micSession`: Bound to `'USER'`
- `loopbackSession`: Bound to `'REMOTE_SPEAKER'`
Multiplexes incoming PCM chunks by source:
`feedPcm(source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcmFloat32: Float32Array): void`
Converts `Float32Array` to `linear16` Buffer and routes to the matching session.

- [ ] **Step 2: Add fallback to Gemini Flash STT**
If Deepgram status reaches `'FAILED'` or no Deepgram key is present, fallback seamlessly to `GeminiSTTProvider` (batch WAV slicing via VAD) while notifying the HUD of `'DEGRADED'` STT mode.

---

### Task 4: Pipeline Routing: Interim vs Finalized Transcript Separation (`@repo/core`)

**Files:**
- Modify: `packages/core/src/pipeline/orchestration-pipeline.ts`
- Modify: `packages/core/test/orchestration-pipeline.test.ts`

- [ ] **Step 1: Update `OrchestrationPipeline` tests**
Verify that interim transcript chunks (`isFinal: false`) return `{ shouldTriggerAnswer: false }` and do not alter internal conversation turn state.

- [ ] **Step 2: Enforce separation in pipeline logic**
```typescript
processTranscriptChunk(chunk: TranscriptTurn): IntentDecision {
  if (!chunk.isFinal) {
    return { shouldTriggerAnswer: false, reason: 'interim_hypothesis' };
  }
  // Only evaluate questions on finalized utterances:
  return this.intentDetector.evaluate(chunk.text);
}
```

---

### Task 5: Live Interim Subtitle Ticker on HUD (`apps/overlay`)

**Files:**
- Modify: `apps/overlay/src/hud/FloatingHud.tsx`
- Modify: `apps/desktop/src/preload.ts`

- [ ] **Step 1: Expose `onInterimTranscript` in `preload.ts`**
```typescript
onInterimTranscript: (callback: (data: { speaker: string; text: string }) => void) => () => void;
```

- [ ] **Step 2: Render animated interim subtitle ticker in `FloatingHud.tsx`**
Add a live subtitle bar under the waveform that renders streaming interim text with:
- Green indicator for `You`
- Sky-blue indicator for `Interviewer`
- Fades out after 2.5 seconds of silence.

---

### Task 6: Active Screen Targeting & Multi-Display Resolution (`apps/desktop`)

**Files:**
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Target display containing foreground window or cursor**
In `apps/desktop/src/main.ts`:
```typescript
const cursorPos = screen.getCursorScreenPoint();
const activeDisplay = screen.getDisplayNearestPoint(cursorPos);
const sources = await desktopCapturer.getSources({
  types: ['screen'],
  thumbnailSize: { width: 1280, height: 720 }
});
// Match display id or fallback to primary
const targetSource = sources.find((s) => s.display_id === String(activeDisplay.id)) || sources[0];
```

---

### Task 7: Full Workspace Verification & Quality Gate

- [ ] **Step 1: Verify TypeScript across all 7 packages**
Run: `pnpm check-types`
Expected: `7 successful, 7 total`

- [ ] **Step 2: Run all unit test suites**
Run: `pnpm test`
Expected: All suites pass across `@repo/capture`, `@repo/core`, and `@repo/ai`.

- [ ] **Step 3: Build production bundles**
Run: `pnpm --filter @repo/overlay build; pnpm --filter @repo/desktop build`
Expected: Clean build with exit code 0.

- [ ] **Step 4: Check git status and leave uncommitted**
Confirm changes remain uncommitted in git for user review.
