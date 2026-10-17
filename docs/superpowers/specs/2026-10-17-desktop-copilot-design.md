# Desktop Copilot Architecture & Feature Specification

- **Date**: 2026-10-17
- **Target OS**: Windows 11 / 10 (with extensible cross-platform adapter stubs)
- **Monorepo Engine**: Turborepo (pnpm workspaces)
- **Application Shell**: Electron + Vite + React 19 + Tailwind CSS + shadcn/ui + TypeScript

---

## 1. Executive Summary & Goal

Desktop Copilot is an AI-powered desktop assistant (inspired by LockedAI / Copilot+ HUDs) designed for real-time conversation listening, desktop screen understanding, and contextual assistance during interviews, meetings, and complex desktop workflows.

The system features:
1. **Screen Reader & Desktop Understanding**: Captures on-demand or periodic active screen frames and analyzes visual context via multimodal models.
2. **Dual-Channel Voice Listener**: Captures both user microphone and system audio loopback (remote speakers) with local Voice Activity Detection (VAD).
3. **Tri-State Screen Ghost Overlay**: A frameless, transparent overlay that streams answers and cues directly onto the desktop, supporting **Passive** (click-through), **Interactive** (selectable/copyable), and **Hidden** (privacy/panic) modes.
4. **Context Engine from Sprint 1**: Incorporates initial user context (resume, job description, meeting notes) combined with rolling transcripts and active screen snapshots.
5. **Config-Driven AI Engine**: Model-agnostic architecture driven by capabilities (STT, Vision, Chat Streaming) with zero hardcoded model names.
6. **Local-First Architecture**: Embedded local storage (SQLite / structured JSON) with no mandatory cloud databases or external servers on Day 1.

---

## 2. Turborepo Monorepo Architecture

The monorepo is structured under Turborepo with strict package boundaries:

```
desktop-copilot/
├── apps/
│   ├── desktop/                 # Electron Main process, preload scripts, native windows, IPC
│   │   ├── src/
│   │   │   ├── main.ts          # Electron entry, app lifecycle, hotkey registration
│   │   │   ├── windows/         # Window managers (HUDWindow, GhostOverlayWindow)
│   │   │   ├── ipc/             # Typed IPC handlers (context, capture, ai, state)
│   │   │   └── preload.ts       # ContextBridge typed contracts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── overlay/                 # Vite + React 19 + Tailwind CSS + TypeScript renderer application
│       ├── src/
│       │   ├── hud/             # Floating Control HUD (draggable pill, settings, session config)
│       │   ├── ghost/           # Ghost Text Overlay (streamed text, subtitles, drawing)
│       │   └── shared/          # State hooks, themes, glassmorphism tokens
│       ├── package.json
│       ├── vite.config.ts
│       └── tsconfig.json
│
├── packages/
│   ├── core/                    # Domain models, context engine, session repository
│   │   ├── src/
│   │   │   ├── context/         # ContextSession, rolling window, prompt builder
│   │   │   ├── storage/         # Local SQLite / file store implementation
│   │   │   └── types/           # Canonical session, message, and state types
│   │   └── package.json
│   │
│   ├── capture/                 # Hardware & OS screen/audio capture adapters
│   │   ├── src/
│   │   │   ├── adapter.ts       # CaptureAdapter abstract interface
│   │   │   ├── windows/         # WindowsCaptureAdapter (DXGI/desktopCapturer, loopback audio)
│   │   │   ├── vad/             # Local voice activity detection chunker
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   ├── ai/                      # Pluggable AI capabilities engine
│   │   ├── src/
│   │   │   ├── stt/             # Streaming speech-to-text capability
│   │   │   ├── vision/          # Vision reasoning capability
│   │   │   ├── chat/            # Streaming conversation capability
│   │   │   └── provider.ts      # Config-driven capability factory
│   │   └── package.json
│   │
│   ├── ui/                      # Shared shadcn/ui components & design primitives (Tailwind CSS)
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   └── utils.ts     # shadcn cn() helper (clsx + tailwind-merge)
│   │   │   ├── components/
│   │   │   │   ├── button.tsx   # shadcn Button with CVA variants
│   │   │   │   ├── badge.tsx    # Mode indicator badges (PASSIVE, INTERACTIVE, HIDDEN)
│   │   │   │   ├── card.tsx     # Translucent glassmorphism card surfaces
│   │   │   │   ├── input.tsx    # Context role and prompt configuration input
│   │   │   │   ├── dialog.tsx   # Context setup modal dialog (strictly no Drawer/Sheet)
│   │   │   │   ├── tooltip.tsx  # Interactive HUD cues and shortcuts
│   │   │   │   └── switch.tsx   # Accessible toggle switch for audio/vision
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── eslint-config/
│   └── typescript-config/
│
├── turbo.json
└── package.json
```

---

## 3. Platform-Agnostic Capture Architecture (Windows-First)

To avoid assuming uniform cross-platform behavior for screen grabs and audio loopback, all capture mechanisms sit behind a formal contract:

```typescript
export interface ScreenSnapshot {
  id: string;
  timestamp: number;
  buffer: Buffer;
  width: number;
  height: number;
  format: 'image/png' | 'image/jpeg';
  sourceTitle?: string;
}

export interface AudioChunk {
  streamId: string;
  source: 'MICROPHONE' | 'SYSTEM_LOOPBACK';
  timestamp: number;
  sampleRate: number;
  channels: number;
  pcmData: Int16Array | Float32Array;
  isSpeech: boolean;
}

export interface CaptureAdapter {
  init(): Promise<void>;
  listDisplaySources(): Promise<Array<{ id: string; name: string }>>;
  captureScreenSnapshot(sourceId?: string): Promise<ScreenSnapshot>;
  startScreenStream(sourceId: string, onFrame: (frame: ScreenSnapshot) => void): Promise<void>;
  stopScreenStream(): Promise<void>;
  startAudioStream(
    config: { enableMic: boolean; enableLoopback: boolean; sampleRate?: number },
    onAudioChunk: (chunk: AudioChunk) => void
  ): Promise<void>;
  stopAudioStream(): Promise<void>;
  dispose(): Promise<void>;
}
```

### Windows Implementation (`WindowsCaptureAdapter`)
1. **Screen Capture**:
   - Uses Electron `desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1920, height: 1080 } })`.
   - On Windows, uses Chromium DXGI hardware desktop duplication where available.
2. **Audio Capture (Dual-Channel)**:
   - **Microphone**: Captured via WebRTC `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`.
   - **System Loopback**: Captured via Electron `desktopCapturer` loopback audio track associated with the primary screen source, routed to an audio worklet tagged as `SYSTEM_LOOPBACK`.
3. **Local VAD (Voice Activity Detection)**:
   - Employs an energy-threshold or lightweight Silero-VAD WebAssembly chunker to slice raw PCM audio into 200–300ms speech frames before dispatching to STT, eliminating transmission of dead silence.

---

## 4. Latency Budget: Time-to-First-Useful-Output (TTFT)

Rather than promising a full answer in <1.5s, the system targets **Time-to-First-Useful-Output (TTFT) in 1.2s – 1.8s (P90)**:

```
[Audio Input] ──► [VAD 200ms] ──► [STT Streaming API ~300ms] ──► [Context Assembly ~20ms]
                                                                        │
[Ghost Text Overlay (First Token)] ◄── [LLM Streaming ~500ms TTFT] ◄────┘
```

- **Audio Buffer Window**: 200–300ms silence detection.
- **STT Interim Latency**: 250–350ms streaming transit.
- **Context Injection**: <20ms in-memory cache assembly.
- **Model TTFT**: 400–700ms (provider-dependent).
- **Renderer Delivery**: Zero-blocking progressive token stream to ghost overlay.

---

## 5. Tri-State Ghost Overlay & Privacy Controls

The overlay is implemented as a dedicated Electron `BrowserWindow`:
- `transparent: true`
- `frame: false`
- `alwaysOnTop: true`
- `skipTaskbar: true`
- `hasShadow: false`

### State Machine

```
                   ┌───────────────────────────┐
                   │          HIDDEN           │
                   │   win.hide(), zero draw   │
                   └─────────────┬─────────────┘
          Hotkey: Ctrl+Shift+H   │   ▲  Hotkey: Ctrl+Shift+H (Panic)
                                 │   │
                                 ▼   │
                   ┌───────────────────────────┐
                   │          PASSIVE          │
                   │   setIgnoreMouseEvents    │
                   │  (true, {forward: true})  │
                   │   Click-through ghost     │
                   └─────────────┬─────────────┘
          Hotkey: Ctrl+Shift+I   │   ▲  Hotkey: Ctrl+Shift+I
                                 │   │
                                 ▼   │
                   ┌───────────────────────────┐
                   │        INTERACTIVE        │
                   │   setIgnoreMouseEvents    │
                   │          (false)          │
                   │   Select, copy, scroll    │
                   └───────────────────────────┘
```

### Controls & Behaviors
- **Passive Mode**: Mouse clicks pass straight through to IDE, browser, or terminal beneath. Text is rendered in anti-aliased high-contrast semi-transparent typography.
- **Interactive Mode**: Mouse input enabled. User can highlight text, click "Copy Answer", scroll through longer code explanations, or close an answer card.
- **Hidden Mode (Panic / Privacy)**: Instantly hides window without closing application state.
- **Floating HUD**: Operates in its own separate small window; independently interactive at all times.

---

## 6. Capability-Based AI Architecture (Zero Hardcoded Models)

Models are abstracted behind capabilities. The user or configuration file defines which models and providers satisfy each capability:

```typescript
export interface AIConfig {
  capabilities: {
    stt: {
      provider: string;        // e.g., 'openai', 'gemini', 'deepgram', 'custom'
      model: string;           // e.g., 'whisper-1' or config value
      apiKey: string;
      endpoint?: string;
    };
    vision: {
      provider: string;        // e.g., 'openai', 'gemini', 'anthropic', 'custom'
      model: string;           // e.g., user-configured VLM model
      apiKey: string;
      temperature: number;
    };
    chatStreaming: {
      provider: string;        // e.g., 'openai', 'gemini', 'anthropic', 'custom'
      model: string;           // e.g., user-configured LLM model
      apiKey: string;
      temperature: number;
    };
  };
}
```

Capabilities are invoked via provider adapters implementing:
- `SpeechToTextService.transcribeStream(audioChunks: AsyncIterable<AudioChunk>): AsyncIterable<TranscriptEvent>`
- `VisionReasoningService.analyzeImage(image: Buffer, prompt: string, context: ContextPayload): Promise<string>`
- `ChatStreamingService.streamCompletion(messages: Message[], context: ContextPayload): AsyncIterable<string>`

---

## 7. Context Awareness Engine (Sprint 1 Foundation)

Context is established in Sprint 1 because all subsequent features (screen Q&A, live answers, history) rely on it.

### Core Data Schema

```typescript
export interface ContextSession {
  sessionId: string;
  createdAt: number;
  updatedAt: number;

  // 1. Initial User Guidance & Constraints
  initialContext: {
    roleOrPersona?: string;           // "Senior Fullstack Engineer"
    meetingType?: string;             // "System Design Interview"
    backgroundNotes?: string;         // Resume summary, key bullet points
    instructions?: string;            // "Keep answers under 3 sentences unless asked for code"
  };

  // 2. Rolling Conversation Transcript
  transcripts: Array<{
    id: string;
    speaker: 'USER' | 'REMOTE_SPEAKER' | 'ASSISTANT';
    timestamp: number;
    text: string;
  }>;

  // 3. Screen Snapshot References
  recentSnapshots: Array<{
    id: string;
    timestamp: number;
    sourceTitle?: string;
    ocrSummary?: string;
    thumbnailPath?: string;
  }>;

  // 4. Source & Cancellation State
  activeSources: {
    micEnabled: boolean;
    loopbackEnabled: boolean;
    screenEnabled: boolean;
  };
  cancellationToken?: string;
}
```

### Context Builder
When formulating prompts for live answers or screen analysis, `ContextBuilder.buildPrompt()` combines:
1. `System Prompt`: Persona, response style, strictness rules.
2. `Initial Context`: User resume, background notes, project context.
3. `Screen Context`: Latest screen OCR / VLM description if visual awareness is active.
4. `Rolling Transcript History`: Last $N$ turns of dialogue tagged by speaker (`[Remote Interviewer]`, `[User]`, `[Assistant]`).
5. `Target Question`: The detected query to be answered.

---

## 8. Local-First Data Storage

- **Database**: Embedded SQLite (via `better-sqlite3`) or local JSON/file store initialized under Electron's `app.getPath('userData')/storage/`.
- **Zero Cloud Footprint**: All sessions, transcripts, and custom context profiles are stored on the local disk.
- **Repository Interface**:
  ```typescript
  export interface SessionRepository {
    createSession(initialContext?: InitialContext): Promise<ContextSession>;
    getSession(sessionId: string): Promise<ContextSession | null>;
    appendTranscript(sessionId: string, segment: TranscriptSegment): Promise<void>;
    addSnapshotReference(sessionId: string, snapshot: SnapshotRef): Promise<void>;
    listSessions(): Promise<Array<{ sessionId: string; createdAt: number; title: string }>>;
  }
  ```

---

## 9. Agile Implementation Roadmap (5 Sprints)

### Sprint 1: Monorepo Foundation, Dual-Window Shell & Core Context Engine
- Clean Turborepo structure: `apps/desktop`, `apps/overlay`, `packages/core`, `packages/capture`, `packages/ai`, `packages/ui`.
- Electron Main process with dual-window orchestration:
  - Floating Control HUD (draggable, interactive).
  - Tri-State Ghost Overlay (Passive, Interactive, Hidden) with hotkeys (`Ctrl+Shift+H`, `Ctrl+Shift+I`).
- Implementation of the `ContextSession` model and local-first session store (`better-sqlite3` or JSON store).
- Typed IPC contract connecting Vite renderer and Electron main process.

### Sprint 2: Windows-First Desktop & Audio Capture Adapters
- `CaptureAdapter` interface definition and `WindowsCaptureAdapter` implementation.
- Screen capture: Display listing, thumbnail generation, on-demand/interval frame capture.
- Dual-channel audio capture:
  - Microphone stream capture.
  - Windows loopback audio capture via `desktopCapturer` system audio track.
- Local Voice Activity Detection (VAD) audio chunking pipeline.

### Sprint 3: Pluggable AI Engine & Live Transcription Pipeline
- Abstract AI capability services (STT, Vision Reasoning, Chat Streaming) configured via settings (zero hardcoded models).
- Live audio chunk streaming into STT provider with speaker channel tagging (`USER` vs `REMOTE_SPEAKER`).
- `ContextBuilder` pipeline assembling initial user instructions, recent transcripts, and active screen state.

### Sprint 4: Real-time Q&A Answering & Screen Ghost Writing
- Conversational question detector (identifies questions addressed to the user).
- Streaming answer generation optimizing for Time-to-First-Useful-Output (TTFT).
- Ghost Text Renderer inside transparent overlay: smooth typography, streaming token animation, auto-scroll, opacity controls.
- Interactive mode toggle for selecting, copying, or dismissing answers.

### Sprint 5: Privacy Controls, Hardening & Desktop Packaging
- Overlay visibility and privacy controls (instant panic hide, selective window exclusion).
- Session export (markdown transcript, Q&A logs, notes).
- Build pipeline using `electron-builder` producing Windows portable `.exe` and NSIS installer.
- End-to-end integration tests on Windows.

---

## 10. Error Handling & Resilience
- **Audio Device Disconnection**: Automatic fallback to default audio device; notifies HUD via IPC without crashing.
- **AI Rate Limit / Network Hiccup**: Exponential backoff retry with visual warning indicator in HUD; previous context retained.
- **Window Occlusion / DPI Scaling**: Handles high-DPI scaling on multi-monitor setups using Electron `screen.getAllDisplays()`.
- **Cancellation**: Ability to interrupt streaming responses via Escape key or HUD cancel button using `AbortController`.
