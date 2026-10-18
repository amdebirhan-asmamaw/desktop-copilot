# Universal Meeting Audio & Robust Speaker Differentiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Desktop Copilot into a robust, platform-independent meeting assistant for Google Meet, Zoom, Microsoft Teams, Slack Huddles, Webex, and browser calls. First verify real OS loopback capture with live audio diagnostics, decouple audio acquisition from speaker attribution, capture independent OS loopback and physical microphone streams, provide orthogonal capture vs speech health metrics in the HUD, connect real dual-channel STT, and eliminate acoustic speaker bleed via timeline-based transcript reconciliation rather than brittle volume-ducking heuristics.

**Architecture:** A decoupled 6-stage pipeline:
1. **Task 0: Capture Verification:** Real-time diagnostics proving non-zero loopback audio is captured from Google Meet / browser media at the OS level before modifying downstream logic.
2. **Orthogonal State Telemetry:** Separate indicators for Capture Health (`CONNECTED` / `NO_AUDIO_TRACK` / `STALLED`), Signal Level (live RMS + last signal timestamp), Speech VAD (`SPEAKING` / `IDLE`), and Transcription Status.
3. **Independent Dual Audio Acquisition:** Stream A (Remote Meeting Audio via OS loopback) and Stream B (Physical Microphone) captured concurrently and independently without destructive ducking or muting. Audio timestamps derived from PCM sample counts.
4. **Real Dual-Channel STT Service:** Both streams routed to real STT (Gemini Flash STT / Deepgram streaming) with zero mock transcripts, producing timestamped utterances with `audioStartMs` and `audioEndMs`.
5. **Timeline & Semantic Echo Reconciliation:** Compares speech timestamps and normalized text similarity within a rolling window to detect probable acoustic speaker echo on the microphone without silencing user speech.
6. **Question Orchestrator & HUD:** Verified remote questions trigger multimodal AI reasoning with display capture; live audio diagnostic pills in the HUD provide instant transparency into capture and speech states.

**Tech Stack:** Electron 33, Node.js 20+, Web Audio API, TypeScript 5.6, TailwindCSS, Vitest, Turborepo.

---

## 1. Architectural Invariants & Critical Fixes

### 1.1 Prove Audio Acquisition Before Modifying Attribution (Task 0)
- Stream manager refactoring assumes actual loopback PCM is reaching it. If the Electron capture mechanism (`desktopCapturer` -> `getUserMedia` with `chromeMediaSource: 'desktop'`) returns an absent track, stalled buffer, or silence, downstream fixes are useless.
- We must first prove and verify that real Google Meet audio and YouTube media produce non-zero PCM frames with measurable RMS on the loopback channel.

### 1.2 Separate Capture Health from Speech Activity
- A stream can be 100% healthy and connected while nobody is speaking for 30 seconds.
- Each channel reports 4 orthogonal dimensions:
  - **Capture Health:** `CONNECTED` | `NO_AUDIO_TRACK` | `STALLED` | `PERMISSION_DENIED`
  - **Signal:** Live RMS + `lastSignalTimestampMs` (timestamp of last non-silent PCM frame)
  - **Speech State:** `SPEAKING` | `IDLE` (VAD)
  - **Transcription State:** `IDLE` | `TRANSCRIBING` | `ERROR`

### 1.3 Audio-Derived Timestamps vs Processing Timestamps
- Using `Date.now()` when STT finishes is flawed: network and inference latency add 500ms–2500ms of variable delay.
- The VAD and chunker attach `audioStartMs` and `audioEndMs` based on the hardware audio clock / sample offset when the words were physically spoken into the sound card.

### 1.4 Timeline Transcript Reconciliation Over Brittle RMS Ducking
- Never mute or discard microphone audio based on loopback volume heuristics. RMS thresholds are heuristics that silently drop quiet user speech while letting loud echo through.
- When laptop speakers bleed into the room, both streams transcribe the audio.
- The `TranscriptReconciler` compares the actual speech timestamps (`audioStartMs`) and normalized text similarity. If a microphone transcript matches recent loopback speech within overlapping time windows, it is tagged as **Probable Acoustic Echo** and suppressed from session history without dropping user speech.

---

## 2. File Structure Map

| File Path | Purpose |
| :--- | :--- |
| `packages/capture/src/audio/diagnostics.ts` | Capture telemetry tracker: capture health, signal level, speech state, and frame statistics |
| `packages/capture/src/audio/stream-manager.ts` | Dual-channel stream manager with independent VAD, sample-derived timestamps, and zero destructive ducking |
| `packages/capture/src/audio/transcript-reconciler.ts` | Timeline and normalized text echo reconciler using audio-derived speech timestamps |
| `packages/capture/test/transcript-reconciler.test.ts` | Unit tests for transcript echo reconciliation, double-talk, and real user speech |
| `packages/capture/test/stream-manager.test.ts` | Unit tests verifying independent loopback and mic audio stream acquisition |
| `packages/ai/src/stt/stt-service.ts` | Multi-channel real STT coordinator with format conversion, retry, and zero mock audio |
| `apps/desktop/src/main.ts` | IPC handlers for dual-channel audio feeds, capture diagnostics, and screen context capture |
| `apps/desktop/src/preload.ts` | Typed IPC bridge for dual audio metering, diagnostics, and transcript events |
| `apps/overlay/src/hud/FloatingHud.tsx` | HUD integration with dual live diagnostic meters (Cyan for Remote, Green for Mic) and multi-turn history |
| `apps/overlay/src/hud/AudioDiagnosticPill.tsx` | Visual component displaying orthogonal capture health, signal RMS, and speech states |

---

## 3. Detailed Task Decomposition

### Task 0: Prove Real Google Meet & OS Loopback Audio Capture

**Files:**
- Create: `packages/capture/src/audio/diagnostics.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/overlay/src/hud/FloatingHud.tsx`

- [ ] **Step 1: Implement `AudioCaptureDiagnostics` tracker**
Create `packages/capture/src/audio/diagnostics.ts`:
Tracks for both `MICROPHONE` and `SYSTEM_LOOPBACK`:
```ts
export type CaptureHealth = 'CONNECTED' | 'NO_AUDIO_TRACK' | 'STALLED' | 'PERMISSION_DENIED';
export type SpeechState = 'SPEAKING' | 'IDLE';
export type TranscriptionState = 'IDLE' | 'TRANSCRIBING' | 'ERROR';

export interface ChannelTelemetry {
  source: 'MICROPHONE' | 'SYSTEM_LOOPBACK';
  health: CaptureHealth;
  currentRms: number;
  peakRms: number;
  totalFrames: number;
  nonZeroFrames: number;
  lastSignalTimestampMs: number;
  speechState: SpeechState;
  transcriptionState: TranscriptionState;
}
```

- [ ] **Step 2: Add loopback track validation in `FloatingHud.tsx`**
In `startSystemAudioCapture`:
1. Check `stream.getAudioTracks().length > 0`. If 0, report `health: 'NO_AUDIO_TRACK'`.
2. Inspect track settings: `track.getSettings()`, `track.readyState`, and attach `track.onended` / `track.onmute`.
3. In `scriptProcessor.onaudioprocess`:
   - Compute RMS of raw incoming chunk.
   - If RMS > 0.0001, increment `nonZeroFrames` and update `lastSignalTimestampMs`.
   - Log diagnostic breadcrumb every 100 frames:
     `[LoopbackDiagnostic] Track active: true, peak RMS: X, non-zero frames: N/Total`.

- [ ] **Step 3: Live Verification Test with Real Audio**
1. Launch Electron app with `pnpm --filter @repo/desktop start`.
2. Play YouTube video in browser; verify in console that `[LoopbackDiagnostic]` reports non-zero frames and peak RMS > 0.01.
3. Join a Google Meet call; verify remote participant speech produces non-zero PCM frames on `SYSTEM_LOOPBACK`.
4. **Acceptance Criterion:** Real remote audio demonstrably reaches the capture pipeline with non-zero audio frames before proceeding.

---

### Task 4: Independent Stream Manager (Pure Acquisition & Metering)

**Files:**
- Modify: `packages/capture/src/audio/stream-manager.ts`
- Modify: `packages/capture/test/stream-manager.test.ts`

- [ ] **Step 1: Remove all destructive volume ducking**
In `packages/capture/src/audio/stream-manager.ts`:
- Maintain two completely independent `IsolatedAudioChannel` instances for `SYSTEM_LOOPBACK` and `MICROPHONE`.
- `SYSTEM_LOOPBACK`: digital sensitivity `0.005`, `minSpeechSamples: 6000` (~375ms), `pauseSilenceStreak: 8` (~680ms).
- `MICROPHONE`: sensitivity `0.030`, `minSpeechSamples: 8000` (~500ms), `pauseSilenceStreak: 8` (~680ms).
- Remove destructive ducking (`return;` on mic when loopback is active). Microphone audio must NEVER be discarded during acquisition.
- Track audio-derived timestamps:
  ```ts
  // Calculate speech start/end from sample offsets
  const speechDurationMs = Math.round((floatData.length / 16000) * 1000);
  const audioEndMs = Date.now();
  const audioStartMs = audioEndMs - speechDurationMs;
  ```
- Emit segment with `{ source, wavBuffer, durationMs, audioStartMs, audioEndMs }`.

- [ ] **Step 2: Update unit tests in `packages/capture/test/stream-manager.test.ts`**
Verify:
1. `SYSTEM_LOOPBACK` speech emits segments with source `SYSTEM_LOOPBACK` and valid `audioStartMs`/`audioEndMs`.
2. `MICROPHONE` speech emits segments with source `MICROPHONE` and valid timestamps.
3. Simultaneous speech on both channels emits segments on both channels independently without dropping either.

- [ ] **Step 3: Run capture tests**
Command: `pnpm --filter @repo/capture test`
Expected: All tests pass.

---

### Task 2: Real Dual-Stream Transcription Service

**Files:**
- Modify: `packages/ai/src/stt/stt-service.ts`
- Modify: `packages/ai/src/stt/gemini-stt-provider.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Ensure real STT handling for both channels**
In `packages/ai/src/stt/stt-service.ts`:
- Confirm zero mock audio generation or fake question injection.
- Update `transcribeWav` signature to accept:
  ```ts
  transcribeWav(
    wavBuffer: Buffer,
    source: 'MICROPHONE' | 'SYSTEM_LOOPBACK',
    timing: { audioStartMs: number; audioEndMs: number }
  ): Promise<TranscriptEvent | null>
  ```
- Return `TranscriptEvent` with:
  ```ts
  {
    text: string,
    isFinal: true,
    speaker: source === 'MICROPHONE' ? 'USER' : 'REMOTE_SPEAKER',
    audioStartMs: timing.audioStartMs,
    audioEndMs: timing.audioEndMs,
    timestamp: Date.now()
  }
  ```

- [ ] **Step 2: Enhanced noise and symbol filtering**
In `gemini-stt-provider.ts`:
- Filter out hallucinated noise tokens (`[breath]`, `*sigh*`, `Quiet breath / sigh?`, `cough`).
- Reject non-alphanumeric noise strings (`/[a-zA-Z0-9]/g.length < 2`).

- [ ] **Step 3: Run AI package tests**
Command: `pnpm --filter @repo/ai test`
Expected: All tests pass.

---

### Task 3: Timeline & Semantic Transcript Echo Reconciler

**Files:**
- Create: `packages/capture/src/audio/transcript-reconciler.ts`
- Create: `packages/capture/test/transcript-reconciler.test.ts`

- [ ] **Step 1: Implement `TranscriptReconciler` using audio timestamps and normalized text**
Create `packages/capture/src/audio/transcript-reconciler.ts`:
```ts
export interface ReconciledTranscript {
  speaker: 'USER' | 'REMOTE_SPEAKER';
  text: string;
  isProbableEcho: boolean;
  audioStartMs: number;
  audioEndMs: number;
}

export class TranscriptReconciler {
  private recentRemoteEntries: Array<{ text: string; audioStartMs: number; audioEndMs: number }> = [];
  private readonly maxOverlapWindowMs = 3500; // 3.5 seconds

  processTranscript(
    speaker: 'USER' | 'REMOTE_SPEAKER',
    text: string,
    audioStartMs: number,
    audioEndMs: number
  ): ReconciledTranscript {
    const cleanText = text.trim();

    // 1. Prune remote entries older than the observation window relative to current speech time
    this.recentRemoteEntries = this.recentRemoteEntries.filter(
      (entry) => audioStartMs - entry.audioStartMs < this.maxOverlapWindowMs
    );

    if (speaker === 'REMOTE_SPEAKER') {
      this.recentRemoteEntries.push({
        text: this.normalizeText(cleanText),
        audioStartMs,
        audioEndMs
      });
      return { speaker, text: cleanText, isProbableEcho: false, audioStartMs, audioEndMs };
    }

    // 2. speaker === 'USER': Check if this overlaps in time AND text similarity
    const normalizedUser = this.normalizeText(cleanText);
    const isProbableEcho = this.recentRemoteEntries.some((remote) => {
      // Must overlap in time (within 3.5s of remote speech)
      const timeDiff = Math.abs(audioStartMs - remote.audioStartMs);
      if (timeDiff > this.maxOverlapWindowMs) return false;

      // Must have high text similarity (token overlap >= 0.70)
      const similarity = this.calculateSimilarity(normalizedUser, remote.text);
      return similarity >= 0.70;
    });

    return {
      speaker,
      text: cleanText,
      isProbableEcho,
      audioStartMs,
      audioEndMs
    };
  }

  normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;
    const words1 = str1.split(' ');
    const words2 = new Set(str2.split(' '));
    const matches = words1.filter((w) => words2.has(w)).length;
    return (2.0 * matches) / (words1.length + words2.size);
  }
}
```

- [ ] **Step 2: Add comprehensive unit tests in `packages/capture/test/transcript-reconciler.test.ts`**
Test cases:
1. Independent remote speech is tagged `REMOTE_SPEAKER` and `isProbableEcho: false`.
2. Independent user speech is tagged `USER` and `isProbableEcho: false`.
3. When remote says *"What is the difference between Postgres and MongoDB?"* and mic transcribes *"What's the difference between Postgres and MongoDB?"* 500ms later, mic transcript is correctly identified as `isProbableEcho: true`.
4. User speaking different text during remote speech (barge-in) is NOT marked as echo (`isProbableEcho: false`).
5. Window expiry: User asking the same question 15 seconds later is not treated as echo.

- [ ] **Step 3: Run unit tests**
Command: `pnpm --filter @repo/capture test`
Expected: 100% pass rate.

---

### Task 4: Audio Diagnostic Telemetry & Dual Live VU Meters in HUD

**Files:**
- Create: `apps/overlay/src/hud/AudioDiagnosticPill.tsx`
- Modify: `apps/overlay/src/hud/FloatingHud.tsx`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/preload.ts`

- [ ] **Step 1: Broadcast orthogonal telemetry via IPC**
In `apps/desktop/src/main.ts`, emit:
`hud:audio-telemetry`: `{ remote: ChannelTelemetry, mic: ChannelTelemetry }`.

- [ ] **Step 2: Expose IPC listener in `preload.ts`**
Add:
`onAudioTelemetry: (callback: (telemetry: { remote: ChannelTelemetry; mic: ChannelTelemetry }) => void) => () => void;`

- [ ] **Step 3: Build `AudioDiagnosticPill.tsx` in `apps/overlay/src/hud/`**
A compact status widget in the HUD header displaying:
- **Meeting Audio (Remote)**:
  - Capture Status: 🟢 Connected / 🔴 No Track / 🟡 Stalled
  - Live Cyan Signal Meter
  - VAD Indicator (Speaking / Silent)
- **Microphone (You)**:
  - Capture Status: 🟢 Connected / 🔴 Permission Error
  - Live Green Signal Meter
  - VAD Indicator (Speaking / Silent)
- Tooltip or popover showing exact RMS, frame counts, and last signal timestamp.

- [ ] **Step 4: Mount `AudioDiagnosticPill` in `FloatingHud.tsx` header**
Mount next to the Mode Badge.

---

### Task 5: Pipeline Integration & Question Routing

**Files:**
- Modify: `apps/desktop/src/main.ts`
- Modify: `packages/core/src/orchestrator/pipeline.ts`

- [ ] **Step 1: Connect `TranscriptReconciler` to `handleIncomingTranscript`**
In `apps/desktop/src/main.ts`:
- Pass every incoming STT transcript through `transcriptReconciler.processTranscript(speaker, text, audioStartMs, audioEndMs)`.
- If `result.isProbableEcho`:
  - Log: `[STT] Reconciled acoustic speaker echo on mic: "${text}" (discarded)`
  - Do NOT append to session conversation (prevents duplicate user turns).
  - Do NOT trigger question answer.
- If `!result.isProbableEcho`:
  - Append to session conversation.
  - If `result.speaker === 'REMOTE_SPEAKER'`, pass to `pipeline.processTranscriptChunk` to detect question intent and trigger Gemini multimodal reasoning.

- [ ] **Step 2: Verify `pipeline.ts` question deduplication**
Ensure 3000ms debounce protects against identical rapid triggers.

---

### Task 6: Full Monorepo Verification & Testing Protocol

- [ ] **Step 1: Type checking**
Command: `pnpm check-types`
Expected: 0 errors across all 7 packages.

- [ ] **Step 2: Monorepo test suite**
Command: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Monorepo build**
Command: `pnpm build`
Expected: Clean build across `@repo/capture`, `@repo/ai`, `@repo/core`, `@repo/overlay`, and `@repo/desktop`.

- [ ] **Step 4: Multi-Platform Verification Checklist**
1. **Google Meet (Browser):**
   - Telemetry shows `remote.health: 'CONNECTED'`, non-zero frames accumulating, cyan meter pulsing on remote voice.
   - Remote question logged as `[STT] REMOTE_SPEAKER: "..."` and triggers Copilot response card.
   - Room speaker bleed into mic is labeled `[STT] Reconciled acoustic speaker echo` and does not create a fake `USER` turn.
2. **Headphone Mode vs Speaker Mode:**
   - Headphone mode: 0 echo detected, both streams clean.
   - Speaker mode: Speaker bleed is gracefully reconciled without muting user speech.
3. **Double-Talk / Interruption:**
   - Speak while remote participant is talking; verify your speech is captured as `USER` and not dropped.

---
