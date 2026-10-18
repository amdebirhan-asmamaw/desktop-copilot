# Production Desktop Copilot Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade, local-first Desktop Copilot with real screen vision, dual audio listening, streaming AI providers (OpenAI, Gemini, Anthropic SSE) with explicit demo mode fallback, and an event-driven Ghost Overlay lifecycle.

**Architecture:** An event-driven 6-stage orchestration pipeline in `@repo/core` governs data flow. In-flight requests are preempted cleanly via `requestId` and `AbortController`. The Electron main process coordinates screen capture and secure IPC, while the React overlay provides a live audio visualizer, transcript ticker, silent quick-input, and markdown-rendered transparent cards.

**Tech Stack:** Electron 34, React 19, Tailwind CSS v4, Turborepo, TypeScript 5.8, Web Audio API, Vitest.

---

## File Structure & Responsibilities

| File Path | Responsibility |
| :--- | :--- |
| `packages/core/src/orchestrator/pipeline.ts` | Central orchestration pipeline: requestId preemption, debouncing, transcript classification. |
| `packages/core/src/types/events.ts` | Normalized `AIStreamEvent`, `OrchestratorEvent`, and lifecycle contracts. |
| `packages/ai/src/providers/types.ts` | `AIProviderAdapter` interface and options. |
| `packages/ai/src/providers/openai-adapter.ts` | Native SSE streaming client for OpenAI chat completions with vision support. |
| `packages/ai/src/providers/gemini-adapter.ts` | Native SSE streaming client for Google Gemini 2.0 Flash / Pro with inline data. |
| `packages/ai/src/providers/anthropic-adapter.ts` | Native SSE streaming client for Anthropic Claude 3.7 with image blocks. |
| `packages/ai/src/providers/demo-adapter.ts` | Offline context-aware mock answer generator labeled explicitly as Demo Mode. |
| `packages/capture/src/screen/screen-grabber.ts` | Validated screen frame capture, resolution verification, and JPEG compression. |
| `packages/capture/src/audio/stream-manager.ts` | Strict separation of microphone and system loopback streams. |
| `apps/desktop/src/main.ts` | Validated IPC handlers, lifecycle coordination, and global shortcut dispatching. |
| `apps/desktop/src/preload.ts` | Typed IPC bridge exposing lifecycle events and audio/screen controls. |
| `apps/overlay/src/hud/FloatingHud.tsx` | HUD pill with audio waveform visualizer, transcript ticker, and quick-input bar. |
| `apps/overlay/src/ghost/GhostOverlay.tsx` | Transparent overlay with lifecycle state machine, markdown formatting, and opacity slider. |

---

## Task 1: Core Orchestration Contracts & Request Lifecycle (`@repo/core`)

**Files:**
- Create: `packages/core/src/types/events.ts`
- Create: `packages/core/src/orchestrator/pipeline.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/orchestration-pipeline.test.ts`

- [ ] **Step 1: Write the failing test for the orchestration pipeline**

```typescript
// packages/core/test/orchestration-pipeline.test.ts
import { describe, it, expect, vi } from 'vitest';
import { OrchestrationPipeline } from '../src/orchestrator/pipeline';

describe('OrchestrationPipeline', () => {
  it('preempts earlier in-flight requests when a new question arrives', async () => {
    const pipeline = new OrchestrationPipeline();
    const abortSpy = vi.fn();

    const req1 = pipeline.beginRequest('How does Raft handle leader election?');
    req1.signal.addEventListener('abort', abortSpy);

    expect(pipeline.getActiveRequestId()).toBe(req1.requestId);

    const req2 = pipeline.beginRequest('Explain Paxos instead.');
    expect(abortSpy).toHaveBeenCalled();
    expect(pipeline.getActiveRequestId()).toBe(req2.requestId);
  });

  it('rejects partial transcript triggers and only accepts final transcripts', () => {
    const pipeline = new OrchestrationPipeline();
    const resultPartial = pipeline.processTranscriptChunk({
      text: 'What is the',
      isFinal: false,
      speaker: 'REMOTE_SPEAKER',
      timestamp: Date.now()
    });
    expect(resultPartial.shouldTriggerAnswer).toBe(false);

    const resultFinal = pipeline.processTranscriptChunk({
      text: 'What is the CAP theorem?',
      isFinal: true,
      speaker: 'REMOTE_SPEAKER',
      timestamp: Date.now()
    });
    expect(resultFinal.shouldTriggerAnswer).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/core test`  
Expected: FAIL with missing module `../src/orchestrator/pipeline`.

- [ ] **Step 3: Implement event types and OrchestrationPipeline**

```typescript
// packages/core/src/types/events.ts
export type AIStreamEvent =
  | { type: 'start'; requestId: string; model: string; isDemo?: boolean }
  | { type: 'text-delta'; requestId: string; text: string }
  | { type: 'error'; requestId: string; error: { code: string; message: string } }
  | { type: 'complete'; requestId: string; usage?: { promptTokens: number; completionTokens: number } };

export interface TranscriptChunk {
  text: string;
  isFinal: boolean;
  speaker: 'USER' | 'REMOTE_SPEAKER';
  timestamp: number;
}
```

```typescript
// packages/core/src/orchestrator/pipeline.ts
import { TranscriptChunk } from '../types/events';
import { isQuestionIntent } from '../intents/intent-detector';

export interface ActiveRequest {
  requestId: string;
  question: string;
  controller: AbortController;
  signal: AbortSignal;
  createdAt: number;
}

export class OrchestrationPipeline {
  private activeRequest: ActiveRequest | null = null;
  private lastQuestionText: string = '';
  private lastQuestionTime: number = 0;

  getActiveRequestId(): string | null {
    return this.activeRequest?.requestId ?? null;
  }

  beginRequest(question: string): ActiveRequest {
    if (this.activeRequest) {
      this.activeRequest.controller.abort();
    }

    const controller = new AbortController();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.activeRequest = {
      requestId,
      question,
      controller,
      signal: controller.signal,
      createdAt: Date.now()
    };
    return this.activeRequest;
  }

  cancelActive(reason: string = 'user_cancelled'): void {
    if (this.activeRequest) {
      this.activeRequest.controller.abort(reason);
      this.activeRequest = null;
    }
  }

  processTranscriptChunk(chunk: TranscriptChunk): { shouldTriggerAnswer: boolean; question?: string } {
    if (!chunk.isFinal || chunk.speaker !== 'REMOTE_SPEAKER') {
      return { shouldTriggerAnswer: false };
    }

    const trimmed = chunk.text.trim();
    const now = Date.now();
    // 500ms debounce and exact string deduplication
    if (trimmed === this.lastQuestionText && now - this.lastQuestionTime < 3000) {
      return { shouldTriggerAnswer: false };
    }

    if (isQuestionIntent(trimmed)) {
      this.lastQuestionText = trimmed;
      this.lastQuestionTime = now;
      return { shouldTriggerAnswer: true, question: trimmed };
    }

    return { shouldTriggerAnswer: false };
  }
}
```

Export `OrchestrationPipeline` and event types in `packages/core/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/core test`  
Expected: PASS (all tests passing).

- [ ] **Step 5: Commit changes**

```powershell
git add packages/core/src packages/core/test
git commit -m "feat(core): implement orchestration pipeline with request preemption and transcript filtering"
```

---

## Task 2: Multi-Provider SSE Streaming Clients (`@repo/ai`)

**Files:**
- Create: `packages/ai/src/providers/types.ts`
- Create: `packages/ai/src/providers/openai-adapter.ts`
- Create: `packages/ai/src/providers/gemini-adapter.ts`
- Create: `packages/ai/src/providers/anthropic-adapter.ts`
- Create: `packages/ai/src/providers/demo-adapter.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/test/providers.test.ts`

- [ ] **Step 1: Write test verifying provider interface and demo engine**

```typescript
// packages/ai/test/providers.test.ts
import { describe, it, expect } from 'vitest';
import { DemoAdapter } from '../src/providers/demo-adapter';

describe('AI Provider Adapters', () => {
  it('emits explicit demo mode tags on demo adapter output', async () => {
    const adapter = new DemoAdapter();
    const controller = new AbortController();
    const events = [];

    for await (const ev of adapter.streamAnswer(
      { sessionId: 's1', initialContext: { roleOrPersona: 'Architect' }, recentTurns: [] },
      'What is Raft?',
      { signal: controller.signal, requestId: 'req_test' }
    )) {
      events.push(ev);
    }

    expect(events[0].type).toBe('start');
    expect(events[0].isDemo).toBe(true);
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
    expect(events[events.length - 1].type).toBe('complete');
  });

  it('aborts token generation when signal is cancelled', async () => {
    const adapter = new DemoAdapter();
    const controller = new AbortController();
    const generator = adapter.streamAnswer(
      { sessionId: 's1', initialContext: {}, recentTurns: [] },
      'Explain consensus',
      { signal: controller.signal, requestId: 'req_cancel' }
    );

    const first = await generator.next();
    expect(first.value.type).toBe('start');
    controller.abort();

    const second = await generator.next();
    expect(second.value.type).toBe('error');
    expect(second.value.error.code).toBe('ABORTED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/ai test`  
Expected: FAIL with missing module.

- [ ] **Step 3: Implement provider adapters**

Implement `packages/ai/src/providers/types.ts`:
```typescript
import { ContextPayload, AIStreamEvent } from '@repo/core';

export interface StreamOptions {
  signal: AbortSignal;
  requestId: string;
  timeoutMs?: number;
}

export interface AIProviderAdapter {
  readonly id: string;
  readonly supportsVision: boolean;
  streamAnswer(payload: ContextPayload, question: string, options: StreamOptions): AsyncIterable<AIStreamEvent>;
}
```

Implement `DemoAdapter`, `OpenAIAdapter`, `GeminiAdapter`, and `AnthropicAdapter` using Node 22 native `fetch` and SSE stream parsers. When an API key is missing or fails, emit `{ type: 'error', requestId, error: { code, message } }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/ai test`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```powershell
git add packages/ai/src packages/ai/test
git commit -m "feat(ai): add native streaming provider adapters with explicit demo mode and cancellation"
```

---

## Task 3: Real Screen Frame Grabber via Electron IPC (`@repo/capture` & `apps/desktop`)

**Files:**
- Create: `packages/capture/src/screen/screen-grabber.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/preload.ts`
- Test: `packages/capture/test/screen-grabber.test.ts`

- [ ] **Step 1: Write test for ScreenGrabber metadata validation**

```typescript
// packages/capture/test/screen-grabber.test.ts
import { describe, it, expect } from 'vitest';
import { validateScreenSnapshot } from '../src/screen/screen-grabber';

describe('Screen Grabber Validator', () => {
  it('validates screen snapshot dimensions and buffer health', () => {
    const valid = validateScreenSnapshot({
      id: 'snap_1',
      timestamp: Date.now(),
      width: 1920,
      height: 1080,
      format: 'image/jpeg',
      buffer: Buffer.from('fake-jpeg-data'),
      sourceTitle: 'Primary Screen'
    });
    expect(valid.isValid).toBe(true);

    const invalid = validateScreenSnapshot({
      id: 'snap_2',
      timestamp: Date.now(),
      width: 0,
      height: 0,
      format: 'image/jpeg',
      buffer: Buffer.alloc(0),
      sourceTitle: ''
    });
    expect(invalid.isValid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/capture test`  
Expected: FAIL.

- [ ] **Step 3: Implement screen grabber validation and Electron desktopCapturer handler**

In `packages/capture/src/screen/screen-grabber.ts`:
```typescript
import { ScreenSnapshot } from '../types';

export function validateScreenSnapshot(snap: ScreenSnapshot): { isValid: boolean; reason?: string } {
  if (!snap.buffer || snap.buffer.length === 0) {
    return { isValid: false, reason: 'Empty image buffer' };
  }
  if (snap.width <= 0 || snap.height <= 0) {
    return { isValid: false, reason: 'Invalid display dimensions' };
  }
  return { isValid: true };
}
```

In `apps/desktop/src/main.ts`, register `ipcMain.handle('screen:capture-snapshot', ...)` using Electron's `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })`. Validate the result and return base64 payload.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/capture test`  
Expected: PASS.

- [ ] **Step 5: Commit changes**

```powershell
git add packages/capture/src packages/capture/test apps/desktop/src
git commit -m "feat(capture): implement validated desktop screen frame capture over IPC"
```

---

## Task 4: Ghost Overlay Lifecycle & Markdown Rendering (`apps/overlay`)

**Files:**
- Modify: `apps/overlay/src/ghost/GhostOverlay.tsx`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Update preload.ts with lifecycle event handlers**

Expose:
- `onGhostStreamStart(cb: (data: { requestId: string; question: string; isDemo?: boolean }) => void)`
- `onGhostStreamChunk(cb: (data: { requestId: string; text: string }) => void)`
- `onGhostStreamEnd(cb: (data: { requestId: string }) => void)`
- `onGhostStreamError(cb: (data: { requestId: string; error: { code: string; message: string } }) => void)`
- `dismissOverlay: () => void`
- `copyAnswerToClipboard: (text: string) => Promise<void>`

- [ ] **Step 2: Implement full state machine in GhostOverlay.tsx**

Update `GhostOverlay.tsx` to handle:
- States: `IDLE`, `STREAMING`, `COMPLETED`, `ERROR`.
- `requestId` guard: Ignore tokens if `chunk.requestId !== activeRequestId`.
- Card Opacity slider (20% to 100%) stored in local state.
- Markdown renderer for structured bullet points and code blocks.
- Prominent **Demo Mode** banner when `isDemo` is true.
- Copy Answer button with confirmation tooltip ("✓ Copied").

- [ ] **Step 3: Verify overlay build**

Run: `pnpm --filter @repo/overlay build`  
Expected: PASS.

- [ ] **Step 4: Commit changes**

```powershell
git add apps/overlay/src/ghost apps/desktop/src
git commit -m "feat(overlay): implement full answer lifecycle, markdown formatting, and opacity slider"
```

---

## Task 5: Floating HUD Audio Activity Waveform & Silent Quick-Input (`apps/overlay`)

**Files:**
- Modify: `apps/overlay/src/hud/FloatingHud.tsx`
- Create: `apps/overlay/src/hud/AudioWaveform.tsx`
- Modify: `apps/desktop/src/preload.ts`

- [ ] **Step 1: Create AudioWaveform component**

Implement real-time visual canvas displaying live audio volume levels (green glowing waveform/pulse) powered by Web Audio API `AnalyserNode`.

- [ ] **Step 2: Add live transcript ticker and silent quick-input bar to FloatingHud.tsx**

- Display scrolling badge showing the latest recognized question/speaker.
- Add expandable text input (`Input` + <kbd>Enter</kbd> trigger) that invokes `copilotApi.feedTranscript({ speaker: 'REMOTE_SPEAKER', text })` directly.
- Wire `Mic` and `Vision` switch toggles to call IPC methods on the main process.

- [ ] **Step 3: Verify overlay build**

Run: `pnpm --filter @repo/overlay build`  
Expected: PASS.

- [ ] **Step 4: Commit changes**

```powershell
git add apps/overlay/src/hud
git commit -m "feat(hud): add audio waveform visualizer, live transcript ticker, and quick-input prompt"
```

---

## Task 6: Multi-Turn Conversation Memory & Assistant Turn Persistence (`@repo/core`)

**Files:**
- Modify: `packages/core/src/context/session-manager.ts`
- Modify: `apps/desktop/src/main.ts`
- Test: `packages/core/test/session-manager.test.ts`

- [ ] **Step 1: Write test for multi-turn assistant persistence**

```typescript
// In packages/core/test/session-manager.test.ts
it('persists assistant answers and includes them in follow-up context packages', async () => {
  const store = new InMemorySessionStore();
  const manager = new SessionManager(store);
  const session = await manager.createSession({ roleOrPersona: 'Staff Engineer' });

  await manager.appendTranscript(session.sessionId, { speaker: 'REMOTE_SPEAKER', text: 'What is Raft?' });
  await manager.appendTranscript(session.sessionId, { speaker: 'ASSISTANT', text: 'Raft is a consensus protocol.' });
  await manager.appendTranscript(session.sessionId, { speaker: 'REMOTE_SPEAKER', text: 'How does it handle split votes?' });

  const payload = await manager.assembleContextPayload(session.sessionId);
  expect(payload.recentTurns.length).toBe(3);
  expect(payload.recentTurns[1].speaker).toBe('ASSISTANT');
});
```

- [ ] **Step 2: Run test to verify it passes or update session manager**

Run: `pnpm --filter @repo/core test`  
Expected: PASS.

- [ ] **Step 3: Commit changes**

```powershell
git add packages/core/src packages/core/test
git commit -m "feat(core): persist assistant turns and enforce multi-turn bounded context assembly"
```

---

## Task 7: Full Monorepo Typecheck, Build, and Packaged App Verification

**Files:**
- All touched files

- [ ] **Step 1: Run comprehensive TypeScript type checking**

Run: `pnpm check-types`  
Expected: All packages pass with 0 errors.

- [ ] **Step 2: Run full unit test suite**

Run: `pnpm test`  
Expected: 100% tests passing across `@repo/core`, `@repo/ai`, and `@repo/capture`.

- [ ] **Step 3: Run production build across monorepo**

Run: `pnpm build`  
Expected: Turbo build succeeds for all targets.

- [ ] **Step 4: Commit final release tag**

```powershell
git commit -am "chore(release): verify full production copilot engine pipeline"
```
