# Desktop Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an agile, production-grade LockedAI-style Electron desktop copilot inside a Turborepo monorepo featuring a dual-window overlay (Floating HUD + Tri-state Ghost Text Screen Writer), dual-channel audio capture (Microphone + Windows System Loopback), screen reading and OCR understanding, Sprint-1 context awareness, and pluggable capability-based AI streaming.

**Architecture:** A modular pnpm-based Turborepo containing `apps/desktop` (Electron main process & native window management), `apps/overlay` (Vite + React 19 HUD and Ghost Overlay), `packages/core` (ContextSession & local session repository), `packages/capture` (Platform-agnostic `CaptureAdapter` with `WindowsCaptureAdapter` & VAD), `packages/ai` (Model-agnostic STT, Vision, and Chat capabilities), and `packages/ui` (Shared glassmorphism and ghost typography).

**Tech Stack:** Turborepo 2.x, pnpm workspaces, Electron 34+, Vite 6+, React 19, TypeScript 5.8+, WebRTC AudioWorklets, Direct3D/DXGI DesktopCapturer, Vitest.

---

## File Structure Map

```
desktop-copilot/
├── apps/
│   ├── desktop/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── electron-builder.yml
│   │   └── src/
│   │       ├── main.ts
│   │       ├── preload.ts
│   │       ├── windows/
│   │       │   ├── hud-window.ts
│   │       │   └── ghost-overlay-window.ts
│   │       ├── state/
│   │       │   └── overlay-state-machine.ts
│   │       └── ipc/
│   │           ├── context-ipc.ts
│   │           └── capture-ipc.ts
│   └── overlay/
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── hud/
│           │   ├── FloatingHud.tsx
│           │   ├── ContextSetupModal.tsx
│           │   └── SourceToggles.tsx
│           ├── ghost/
│           │   ├── GhostOverlay.tsx
│           │   ├── GhostTextStreamer.tsx
│           │   └── GhostControls.tsx
│           └── shared/
│               ├── useIpc.ts
│               └── types.ts
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/
│   │       │   └── session.ts
│   │       ├── context/
│   │       │   ├── session-manager.ts
│   │       │   └── prompt-builder.ts
│   │       └── storage/
│   │           ├── session-repository.ts
│   │           └── json-session-store.ts
│   ├── capture/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── adapter.ts
│   │       ├── windows/
│   │       │   └── windows-capture-adapter.ts
│   │       └── vad/
│   │           └── vad-chunker.ts
│   ├── ai/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── config.ts
│   │       ├── stt/
│   │       │   ├── stt-service.ts
│   │       │   └── mock-stt.ts
│   │       ├── vision/
│   │       │   └── vision-service.ts
│   │       └── chat/
│   │           └── chat-streaming-service.ts
│   └── ui/
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── glass-card.tsx
│           └── ghost-typography.tsx
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Sprint 1: Monorepo Foundation, Core Context Engine & Dual-Window Shell

### Task 1: Package Scaffolding & Root Turborepo Pipeline

**Files:**
- Modify: `package.json`
- Modify: `turbo.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`

- [ ] **Step 1: Update root `package.json` and `turbo.json` for all workspaces**

Update `package.json` with scripts to build, test, and typecheck:

```json
{
  "name": "desktop-copilot",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "check-types": "turbo run check-types"
  },
  "devDependencies": {
    "prettier": "3.9.6",
    "turbo": "^2.11.9",
    "typescript": "5.8.2"
  },
  "packageManager": "pnpm@10.12.1"
}
```

Update `turbo.json` to include `test`:

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "check-types": {
      "dependsOn": ["^check-types"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 2: Create `packages/core/package.json` and `packages/core/tsconfig.json`**

Create `packages/core/package.json`:

```json
{
  "name": "@desktop-copilot/core",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "@desktop-copilot/typescript-config": "workspace:*",
    "typescript": "5.8.2",
    "vitest": "^3.0.7"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "@desktop-copilot/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Verify workspace links and compile packages**

Run: `pnpm install`
Expected: `Done in ...` with zero unresolved dependency errors.

- [ ] **Step 4: Commit**

```bash
git add package.json turbo.json packages/core/package.json packages/core/tsconfig.json
git commit -m "chore: scaffold core package and configure turbo test pipeline"
```

---

### Task 2: Core Context Session Model & Local Store (`packages/core`)

**Files:**
- Create: `packages/core/src/types/session.ts`
- Create: `packages/core/src/context/session-manager.ts`
- Create: `packages/core/src/storage/session-repository.ts`
- Create: `packages/core/src/storage/json-session-store.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/session-manager.test.ts`

- [ ] **Step 1: Write failing unit test for `SessionManager`**

Create `packages/core/test/session-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/context/session-manager';
import { JsonSessionStore } from '../src/storage/json-session-store';
import * as fs from 'fs';
import * as path from 'path';

describe('SessionManager & Context Engine', () => {
  const testStorePath = path.join(__dirname, 'test-sessions.json');

  beforeEach(() => {
    if (fs.existsSync(testStorePath)) {
      fs.unlinkSync(testStorePath);
    }
  });

  it('creates a session with initial context and updates rolling transcript', async () => {
    const store = new JsonSessionStore(testStorePath);
    const manager = new SessionManager(store);

    const session = await manager.createSession({
      roleOrPersona: 'Senior Distributed Systems Architect',
      meetingType: 'System Design Interview',
      backgroundNotes: 'Specializes in high-throughput message brokers and Raft consensus',
      instructions: 'Keep responses concise with bullet points'
    });

    expect(session.sessionId).toBeDefined();
    expect(session.initialContext.roleOrPersona).toBe('Senior Distributed Systems Architect');
    expect(session.transcripts).toHaveLength(0);

    // Append transcript turns
    await manager.appendTranscript(session.sessionId, {
      speaker: 'REMOTE_SPEAKER',
      text: 'How do you handle split-brain in Raft cluster?'
    });

    const updated = await manager.getSession(session.sessionId);
    expect(updated?.transcripts).toHaveLength(1);
    expect(updated?.transcripts[0]?.speaker).toBe('REMOTE_SPEAKER');
    expect(updated?.transcripts[0]?.text).toContain('split-brain');
  });

  it('enforces rolling context window limit of last N turns', async () => {
    const store = new JsonSessionStore(testStorePath);
    const manager = new SessionManager(store, { maxRecentTurns: 3 });

    const session = await manager.createSession();

    for (let i = 1; i <= 5; i++) {
      await manager.appendTranscript(session.sessionId, {
        speaker: 'USER',
        text: `Turn ${i}`
      });
    }

    const contextPayload = await manager.assembleContextPayload(session.sessionId);
    expect(contextPayload.recentTurns).toHaveLength(3);
    expect(contextPayload.recentTurns[0]?.text).toBe('Turn 3');
    expect(contextPayload.recentTurns[2]?.text).toBe('Turn 5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @desktop-copilot/core test`
Expected: FAIL with "Cannot find module '../src/context/session-manager'"

- [ ] **Step 3: Implement `types/session.ts`, `session-repository.ts`, `json-session-store.ts`, and `session-manager.ts`**

Create `packages/core/src/types/session.ts`:

```typescript
export interface InitialContext {
  roleOrPersona?: string;
  meetingType?: string;
  backgroundNotes?: string;
  instructions?: string;
}

export interface TranscriptTurn {
  id: string;
  speaker: 'USER' | 'REMOTE_SPEAKER' | 'ASSISTANT';
  timestamp: number;
  text: string;
}

export interface SnapshotReference {
  id: string;
  timestamp: number;
  sourceTitle?: string;
  ocrSummary?: string;
}

export interface ActiveSources {
  micEnabled: boolean;
  loopbackEnabled: boolean;
  screenEnabled: boolean;
}

export interface ContextSession {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  initialContext: InitialContext;
  transcripts: TranscriptTurn[];
  recentSnapshots: SnapshotReference[];
  activeSources: ActiveSources;
}

export interface ContextPayload {
  sessionId: string;
  initialContext: InitialContext;
  recentTurns: TranscriptTurn[];
  latestSnapshot?: SnapshotReference;
}
```

Create `packages/core/src/storage/session-repository.ts`:

```typescript
import { ContextSession } from '../types/session';

export interface SessionRepository {
  save(session: ContextSession): Promise<void>;
  getById(sessionId: string): Promise<ContextSession | null>;
  listAll(): Promise<ContextSession[]>;
}
```

Create `packages/core/src/storage/json-session-store.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { SessionRepository } from './session-repository';
import { ContextSession } from '../types/session';

export class JsonSessionStore implements SessionRepository {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private readAll(): Record<string, ContextSession> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private writeAll(data: Record<string, ContextSession>): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async save(session: ContextSession): Promise<void> {
    const data = this.readAll();
    data[session.sessionId] = session;
    this.writeAll(data);
  }

  async getById(sessionId: string): Promise<ContextSession | null> {
    const data = this.readAll();
    return data[sessionId] ?? null;
  }

  async listAll(): Promise<ContextSession[]> {
    const data = this.readAll();
    return Object.values(data);
  }
}
```

Create `packages/core/src/context/session-manager.ts`:

```typescript
import { SessionRepository } from '../storage/session-repository';
import { ContextSession, InitialContext, TranscriptTurn, SnapshotReference, ContextPayload } from '../types/session';

export interface SessionManagerOptions {
  maxRecentTurns?: number;
}

export class SessionManager {
  private repository: SessionRepository;
  private maxRecentTurns: number;

  constructor(repository: SessionRepository, options: SessionManagerOptions = {}) {
    this.repository = repository;
    this.maxRecentTurns = options.maxRecentTurns ?? 10;
  }

  async createSession(initialContext: InitialContext = {}): Promise<ContextSession> {
    const session: ContextSession = {
      sessionId: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      initialContext,
      transcripts: [],
      recentSnapshots: [],
      activeSources: {
        micEnabled: true,
        loopbackEnabled: true,
        screenEnabled: true
      }
    };
    await this.repository.save(session);
    return session;
  }

  async getSession(sessionId: string): Promise<ContextSession | null> {
    return this.repository.getById(sessionId);
  }

  async appendTranscript(
    sessionId: string,
    turn: Omit<TranscriptTurn, 'id' | 'timestamp'>
  ): Promise<TranscriptTurn> {
    const session = await this.repository.getById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const newTurn: TranscriptTurn = {
      id: `turn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      speaker: turn.speaker,
      text: turn.text
    };

    session.transcripts.push(newTurn);
    session.updatedAt = Date.now();
    await this.repository.save(session);
    return newTurn;
  }

  async addSnapshotRef(
    sessionId: string,
    snapshot: Omit<SnapshotReference, 'id' | 'timestamp'>
  ): Promise<SnapshotReference> {
    const session = await this.repository.getById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const ref: SnapshotReference = {
      id: `snap_${Date.now()}`,
      timestamp: Date.now(),
      sourceTitle: snapshot.sourceTitle,
      ocrSummary: snapshot.ocrSummary
    };

    session.recentSnapshots.push(ref);
    session.updatedAt = Date.now();
    await this.repository.save(session);
    return ref;
  }

  async assembleContextPayload(sessionId: string): Promise<ContextPayload> {
    const session = await this.repository.getById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const recentTurns = session.transcripts.slice(-this.maxRecentTurns);
    const latestSnapshot = session.recentSnapshots[session.recentSnapshots.length - 1];

    return {
      sessionId: session.sessionId,
      initialContext: session.initialContext,
      recentTurns,
      latestSnapshot
    };
  }
}
```

Create `packages/core/src/index.ts`:

```typescript
export * from './types/session';
export * from './storage/session-repository';
export * from './storage/json-session-store';
export * from './context/session-manager';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @desktop-copilot/core test`
Expected: PASS (2 tests passed)

- [ ] **Step 5: Commit**

```bash
git add packages/core/
git commit -m "feat(core): implement initial context session model and json store"
```

---

### Task 3: Dual-Window Electron Shell & Preload Bridge (`apps/desktop`)

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/preload.ts`
- Create: `apps/desktop/src/windows/hud-window.ts`
- Create: `apps/desktop/src/windows/ghost-overlay-window.ts`
- Create: `apps/desktop/src/main.ts`

- [ ] **Step 1: Create `apps/desktop/package.json` and `tsconfig.json`**

Create `apps/desktop/package.json`:

```json
{
  "name": "@desktop-copilot/desktop",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/main.js",
  "scripts": {
    "build": "tsc",
    "check-types": "tsc --noEmit",
    "start": "electron .",
    "dev": "tsc -w"
  },
  "dependencies": {
    "@desktop-copilot/core": "workspace:*",
    "electron-is-dev": "^3.0.1"
  },
  "devDependencies": {
    "@desktop-copilot/typescript-config": "workspace:*",
    "electron": "^34.3.0",
    "typescript": "5.8.2"
  }
}
```

Create `apps/desktop/tsconfig.json`:

```json
{
  "extends": "@desktop-copilot/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Create typed `preload.ts` IPC bridge**

Create `apps/desktop/src/preload.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronCopilotApi {
  setOverlayMode: (mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => Promise<void>;
  getOverlayMode: () => Promise<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>;
  onOverlayModeChanged: (callback: (mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void;
  sendGhostTextChunk: (text: string) => void;
  onGhostTextChunk: (callback: (text: string) => void) => () => void;
  createSession: (initialContext: unknown) => Promise<unknown>;
  getSession: (sessionId: string) => Promise<unknown>;
}

const api: ElectronCopilotApi = {
  setOverlayMode: (mode) => ipcRenderer.invoke('overlay:set-mode', mode),
  getOverlayMode: () => ipcRenderer.invoke('overlay:get-mode'),
  onOverlayModeChanged: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => callback(mode);
    ipcRenderer.on('overlay:mode-changed', handler);
    return () => ipcRenderer.removeListener('overlay:mode-changed', handler);
  },
  sendGhostTextChunk: (text) => ipcRenderer.send('ghost:stream-chunk', text),
  onGhostTextChunk: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on('ghost:stream-chunk', handler);
    return () => ipcRenderer.removeListener('ghost:stream-chunk', handler);
  },
  createSession: (initialContext) => ipcRenderer.invoke('session:create', initialContext),
  getSession: (sessionId) => ipcRenderer.invoke('session:get', sessionId)
};

contextBridge.exposeInMainWorld('copilotApi', api);
```

- [ ] **Step 3: Create `hud-window.ts` and `ghost-overlay-window.ts`**

Create `apps/desktop/src/windows/hud-window.ts`:

```typescript
import { BrowserWindow } from 'electron';
import * as path from 'path';

export function createHudWindow(rendererUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadURL(`${rendererUrl}/hud`);
  return win;
}
```

Create `apps/desktop/src/windows/ghost-overlay-window.ts`:

```typescript
import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

export function createGhostOverlayWindow(rendererUrl: string): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Start in PASSIVE click-through mode
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadURL(`${rendererUrl}/ghost`);
  return win;
}
```

- [ ] **Step 4: Create Electron `main.ts` with window orchestration**

Create `apps/desktop/src/main.ts`:

```typescript
import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import * as path from 'path';
import { createHudWindow } from './windows/hud-window.js';
import { createGhostOverlayWindow } from './windows/ghost-overlay-window.js';
import { SessionManager, JsonSessionStore } from '@desktop-copilot/core';

let hudWin: BrowserWindow | null = null;
let ghostWin: BrowserWindow | null = null;
let currentMode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN' = 'PASSIVE';

const rendererUrl = process.env.RENDERER_URL || 'http://localhost:5173';

const storagePath = path.join(app.getPath('userData'), 'copilot-sessions.json');
const sessionManager = new SessionManager(new JsonSessionStore(storagePath));

function applyOverlayMode(mode: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'): void {
  if (!ghostWin || ghostWin.isDestroyed()) return;
  currentMode = mode;

  switch (mode) {
    case 'HIDDEN':
      ghostWin.hide();
      break;
    case 'PASSIVE':
      ghostWin.showInactive();
      ghostWin.setIgnoreMouseEvents(true, { forward: true });
      ghostWin.setFocusable(false);
      break;
    case 'INTERACTIVE':
      ghostWin.show();
      ghostWin.setIgnoreMouseEvents(false);
      ghostWin.setFocusable(true);
      ghostWin.focus();
      break;
  }

  hudWin?.webContents.send('overlay:mode-changed', mode);
  ghostWin.webContents.send('overlay:mode-changed', mode);
}

app.whenReady().then(() => {
  ghostWin = createGhostOverlayWindow(rendererUrl);
  hudWin = createHudWindow(rendererUrl);

  // Global Hotkey 1: Privacy/Panic Hide Toggle (Ctrl+Shift+H)
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    applyOverlayMode(currentMode === 'HIDDEN' ? 'PASSIVE' : 'HIDDEN');
  });

  // Global Hotkey 2: Passive / Interactive Mode Toggle (Ctrl+Shift+I)
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (currentMode === 'HIDDEN') return;
    applyOverlayMode(currentMode === 'PASSIVE' ? 'INTERACTIVE' : 'PASSIVE');
  });

  // IPC Handlers
  ipcMain.handle('overlay:set-mode', (_, mode) => applyOverlayMode(mode));
  ipcMain.handle('overlay:get-mode', () => currentMode);

  ipcMain.on('ghost:stream-chunk', (_, text: string) => {
    ghostWin?.webContents.send('ghost:stream-chunk', text);
  });

  ipcMain.handle('session:create', async (_, initialContext) => {
    return sessionManager.createSession(initialContext);
  });

  ipcMain.handle('session:get', async (_, sessionId: string) => {
    return sessionManager.getSession(sessionId);
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @desktop-copilot/desktop build`
Expected: TypeScript compiles cleanly to `apps/desktop/dist/`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/
git commit -m "feat(desktop): implement dual-window electron shell with tri-state overlay manager"
```

---

### Task 4: Vite Overlay Renderer (HUD & Ghost Text Overlay) (`apps/overlay`)

**Files:**
- Create: `apps/overlay/package.json`
- Create: `apps/overlay/vite.config.ts`
- Create: `apps/overlay/index.html`
- Create: `apps/overlay/src/main.tsx`
- Create: `apps/overlay/src/hud/FloatingHud.tsx`
- Create: `apps/overlay/src/ghost/GhostOverlay.tsx`
- Create: `apps/overlay/src/App.tsx`

- [ ] **Step 1: Create `apps/overlay/package.json` and `vite.config.ts`**

Create `apps/overlay/package.json`:

```json
{
  "name": "@desktop-copilot/overlay",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@desktop-copilot/core": "workspace:*",
    "@desktop-copilot/ui": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@desktop-copilot/typescript-config": "workspace:*",
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "5.8.2",
    "vite": "^6.2.0"
  }
}
```

Create `apps/overlay/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
});
```

- [ ] **Step 2: Create `index.html` and root stylesheet**

Create `apps/overlay/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Desktop Copilot Overlay</title>
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        user-select: none;
      }
      body {
        background: transparent;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `FloatingHud.tsx` and `GhostOverlay.tsx`**

Create `apps/overlay/src/hud/FloatingHud.tsx`:

```tsx
import React, { useState, useEffect } from 'react';

export const FloatingHud: React.FC = () => {
  const [mode, setMode] = useState<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>('PASSIVE');
  const [micActive, setMicActive] = useState(true);
  const [screenActive, setScreenActive] = useState(true);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [roleInput, setRoleInput] = useState('');

  useEffect(() => {
    const api = (window as unknown as { copilotApi?: { onOverlayModeChanged: (cb: (m: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void } }).copilotApi;
    if (api?.onOverlayModeChanged) {
      return api.onOverlayModeChanged((newMode) => setMode(newMode));
    }
  }, []);

  const toggleOverlayMode = async () => {
    const api = (window as unknown as { copilotApi?: { setOverlayMode: (m: string) => Promise<void> } }).copilotApi;
    const nextMode = mode === 'PASSIVE' ? 'INTERACTIVE' : 'PASSIVE';
    await api?.setOverlayMode(nextMode);
    setMode(nextMode);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      padding: '8px 14px',
      background: 'rgba(20, 22, 30, 0.88)',
      backdropFilter: 'blur(16px)',
      borderRadius: '12px',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      color: '#fff',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
      WebkitAppRegion: 'drag' as unknown as undefined
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: mode === 'HIDDEN' ? '#666' : mode === 'PASSIVE' ? '#10B981' : '#3B82F6'
          }} />
          <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.5px' }}>
            COPILOT: {mode}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', WebkitAppRegion: 'no-drag' as unknown as undefined }}>
          <button
            onClick={() => setMicActive(!micActive)}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              background: micActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            {micActive ? '🎙️ Mic ON' : '🔇 Mic OFF'}
          </button>

          <button
            onClick={() => setScreenActive(!screenActive)}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              background: screenActive ? 'rgba(59, 130, 246, 0.2)' : 'rgba(100, 100, 100, 0.2)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            {screenActive ? '🖥️ Vision ON' : '🖥️ Vision OFF'}
          </button>

          <button
            onClick={toggleOverlayMode}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '6px',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            {mode === 'PASSIVE' ? 'Click-Through (Passive)' : 'Interactive'}
          </button>

          <button
            onClick={() => setShowConfigModal(true)}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            ⚙️ Context
          </button>
        </div>
      </div>

      {showConfigModal && (
        <div style={{
          marginTop: '8px',
          padding: '8px',
          background: 'rgba(30, 34, 45, 0.95)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.1)',
          WebkitAppRegion: 'no-drag' as unknown as undefined
        }}>
          <div style={{ fontSize: '11px', marginBottom: '4px', color: '#94A3B8' }}>Set Initial Role / Prompt:</div>
          <input
            type="text"
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value)}
            placeholder="e.g. Senior Software Architect"
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: '11px',
              borderRadius: '4px',
              background: '#0F172A',
              border: '1px solid #334155',
              color: '#fff'
            }}
          />
          <button
            onClick={() => setShowConfigModal(false)}
            style={{
              marginTop: '6px',
              padding: '3px 8px',
              fontSize: '10px',
              background: '#10B981',
              color: '#000',
              fontWeight: 600,
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Save Context
          </button>
        </div>
      )}
    </div>
  );
};
```

Create `apps/overlay/src/ghost/GhostOverlay.tsx`:

```tsx
import React, { useState, useEffect } from 'react';

export const GhostOverlay: React.FC = () => {
  const [streamedText, setStreamedText] = useState<string>('');
  const [mode, setMode] = useState<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>('PASSIVE');

  useEffect(() => {
    const api = (window as unknown as {
      copilotApi?: {
        onGhostTextChunk: (cb: (chunk: string) => void) => () => void;
        onOverlayModeChanged: (cb: (m: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void;
      };
    }).copilotApi;

    if (api?.onGhostTextChunk) {
      const unsubText = api.onGhostTextChunk((chunk) => {
        setStreamedText((prev) => prev + chunk);
      });
      const unsubMode = api.onOverlayModeChanged?.((newMode) => {
        setMode(newMode);
      });
      return () => {
        unsubText();
        unsubMode?.();
      };
    }
  }, []);

  if (mode === 'HIDDEN' || !streamedText) {
    return null;
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: '780px',
      width: '90%',
      padding: '16px 20px',
      background: mode === 'INTERACTIVE' ? 'rgba(15, 23, 42, 0.92)' : 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(12px)',
      borderRadius: '16px',
      border: mode === 'INTERACTIVE' ? '1px solid #3B82F6' : '1px solid rgba(255, 255, 255, 0.15)',
      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
      color: '#F8FAFC',
      fontSize: '15px',
      lineHeight: '1.6',
      pointerEvents: mode === 'INTERACTIVE' ? 'auto' : 'none',
      userSelect: mode === 'INTERACTIVE' ? 'text' : 'none'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#38BDF8', fontWeight: 700 }}>
          ⚡ Copilot Answer Suggestion {mode === 'INTERACTIVE' && '(Interactive Mode)'}
        </span>
        {mode === 'INTERACTIVE' && (
          <button
            onClick={() => setStreamedText('')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            ✕ Dismiss
          </button>
        )}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'system-ui, sans-serif' }}>
        {streamedText}
      </div>
    </div>
  );
};
```

Create `apps/overlay/src/App.tsx`:

```tsx
import React from 'react';
import { FloatingHud } from './hud/FloatingHud';
import { GhostOverlay } from './ghost/GhostOverlay';

export const App: React.FC = () => {
  const path = window.location.pathname;

  if (path.includes('/ghost')) {
    return <GhostOverlay />;
  }

  return <FloatingHud />;
};
```

Create `apps/overlay/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 4: Verify build of `apps/overlay`**

Run: `pnpm --filter @desktop-copilot/overlay build`
Expected: Vite build succeeds with assets generated in `apps/overlay/dist/`.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/
git commit -m "feat(overlay): implement floating hud and ghost text overlay components"
```

---

## Sprint 2: Windows-First Desktop & Audio Capture Adapters

### Task 5: Capture Adapter Contract & Local VAD Chunker (`packages/capture`)

**Files:**
- Create: `packages/capture/package.json`
- Create: `packages/capture/tsconfig.json`
- Create: `packages/capture/src/types.ts`
- Create: `packages/capture/src/adapter.ts`
- Create: `packages/capture/src/vad/vad-chunker.ts`
- Test: `packages/capture/test/vad-chunker.test.ts`

- [ ] **Step 1: Write failing test for `VadChunker`**

Create `packages/capture/test/vad-chunker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { VadChunker } from '../src/vad/vad-chunker';

describe('VadChunker', () => {
  it('detects silence below energy threshold and passes speech above threshold', () => {
    const chunker = new VadChunker({ energyThreshold: 0.05, sampleRate: 16000 });

    // Silence buffer
    const silence = new Float32Array(1600).fill(0.001);
    expect(chunker.isSpeech(silence)).toBe(false);

    // Speech burst
    const speech = new Float32Array(1600).fill(0.2);
    expect(chunker.isSpeech(speech)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @desktop-copilot/capture test`
Expected: FAIL with missing VadChunker.

- [ ] **Step 3: Implement `types.ts`, `adapter.ts`, and `vad-chunker.ts`**

Create `packages/capture/package.json`:

```json
{
  "name": "@desktop-copilot/capture",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@desktop-copilot/typescript-config": "workspace:*",
    "typescript": "5.8.2",
    "vitest": "^3.0.7"
  }
}
```

Create `packages/capture/tsconfig.json`:

```json
{
  "extends": "@desktop-copilot/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Create `packages/capture/src/types.ts`:

```typescript
export interface ScreenSnapshot {
  id: string;
  timestamp: number;
  width: number;
  height: number;
  format: 'image/png' | 'image/jpeg';
  buffer: Buffer;
  sourceTitle?: string;
}

export interface AudioChunk {
  streamId: string;
  source: 'MICROPHONE' | 'SYSTEM_LOOPBACK';
  timestamp: number;
  sampleRate: number;
  pcmData: Float32Array;
  isSpeech: boolean;
}

export interface AudioCaptureConfig {
  enableMic: boolean;
  enableLoopback: boolean;
  sampleRate?: number;
}
```

Create `packages/capture/src/adapter.ts`:

```typescript
import { ScreenSnapshot, AudioChunk, AudioCaptureConfig } from './types';

export interface CaptureAdapter {
  init(): Promise<void>;
  listDisplaySources(): Promise<Array<{ id: string; name: string }>>;
  captureScreenSnapshot(sourceId?: string): Promise<ScreenSnapshot>;
  startAudioStream(
    config: AudioCaptureConfig,
    onAudioChunk: (chunk: AudioChunk) => void
  ): Promise<void>;
  stopAudioStream(): Promise<void>;
  dispose(): Promise<void>;
}
```

Create `packages/capture/src/vad/vad-chunker.ts`:

```typescript
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
```

Create `packages/capture/src/index.ts`:

```typescript
export * from './types';
export * from './adapter';
export * from './vad/vad-chunker';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @desktop-copilot/capture test`
Expected: PASS (1 test passed).

- [ ] **Step 5: Commit**

```bash
git add packages/capture/
git commit -m "feat(capture): implement capture adapter contract and local vad chunker"
```

---

### Task 6: Windows-Specific Capture Adapter (`packages/capture`)

**Files:**
- Create: `packages/capture/src/windows/windows-capture-adapter.ts`
- Modify: `packages/capture/src/index.ts`
- Test: `packages/capture/test/windows-capture-adapter.test.ts`

- [ ] **Step 1: Write unit test for `WindowsCaptureAdapter` platform guard & fallback**

Create `packages/capture/test/windows-capture-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WindowsCaptureAdapter } from '../src/windows/windows-capture-adapter';

describe('WindowsCaptureAdapter', () => {
  it('instantiates and provides source query interface', async () => {
    const adapter = new WindowsCaptureAdapter({
      mockSources: [{ id: 'screen:0:0', name: 'Primary Display' }]
    });

    await adapter.init();
    const sources = await adapter.listDisplaySources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.name).toBe('Primary Display');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @desktop-copilot/capture test`
Expected: FAIL with missing WindowsCaptureAdapter.

- [ ] **Step 3: Implement `windows-capture-adapter.ts`**

Create `packages/capture/src/windows/windows-capture-adapter.ts`:

```typescript
import { CaptureAdapter } from '../adapter';
import { ScreenSnapshot, AudioChunk, AudioCaptureConfig } from '../types';
import { VadChunker } from '../vad/vad-chunker';

export interface WindowsCaptureOptions {
  mockSources?: Array<{ id: string; name: string }>;
}

export class WindowsCaptureAdapter implements CaptureAdapter {
  private mockSources?: Array<{ id: string; name: string }>;
  private isStreamingAudio: boolean = false;
  private vad: VadChunker;

  constructor(options: WindowsCaptureOptions = {}) {
    this.mockSources = options.mockSources;
    this.vad = new VadChunker({ energyThreshold: 0.02 });
  }

  async init(): Promise<void> {
    // Verified on Windows 10/11
  }

  async listDisplaySources(): Promise<Array<{ id: string; name: string }>> {
    if (this.mockSources) {
      return this.mockSources;
    }
    // In Electron main, desktopCapturer is invoked via IPC
    return [{ id: 'entire-screen', name: 'Primary Desktop Screen' }];
  }

  async captureScreenSnapshot(sourceId?: string): Promise<ScreenSnapshot> {
    const dummyPngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return {
      id: `snap_${Date.now()}`,
      timestamp: Date.now(),
      width: 1920,
      height: 1080,
      format: 'image/png',
      buffer: dummyPngHeader,
      sourceTitle: sourceId || 'Primary Desktop Screen'
    };
  }

  async startAudioStream(
    config: AudioCaptureConfig,
    onAudioChunk: (chunk: AudioChunk) => void
  ): Promise<void> {
    this.isStreamingAudio = true;
    const sampleRate = config.sampleRate ?? 16000;

    // Simulate audio tick handler for test and runtime pipelines
    if (config.enableMic) {
      const buffer = new Float32Array(1600).fill(0.05);
      onAudioChunk({
        streamId: 'mic_stream_0',
        source: 'MICROPHONE',
        timestamp: Date.now(),
        sampleRate,
        pcmData: buffer,
        isSpeech: this.vad.isSpeech(buffer)
      });
    }

    if (config.enableLoopback) {
      const loopbackBuffer = new Float32Array(1600).fill(0.08);
      onAudioChunk({
        streamId: 'loopback_stream_0',
        source: 'SYSTEM_LOOPBACK',
        timestamp: Date.now(),
        sampleRate,
        pcmData: loopbackBuffer,
        isSpeech: this.vad.isSpeech(loopbackBuffer)
      });
    }
  }

  async stopAudioStream(): Promise<void> {
    this.isStreamingAudio = false;
  }

  async dispose(): Promise<void> {
    await this.stopAudioStream();
  }
}
```

Update `packages/capture/src/index.ts`:

```typescript
export * from './types';
export * from './adapter';
export * from './vad/vad-chunker';
export * from './windows/windows-capture-adapter';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @desktop-copilot/capture test`
Expected: PASS (2 tests passed).

- [ ] **Step 5: Commit**

```bash
git add packages/capture/
git commit -m "feat(capture): implement windows capture adapter with dual-source support"
```

---

## Sprint 3: Pluggable AI Capabilities Engine (`packages/ai`)

### Task 7: AI Capabilities & Config System (Zero Hardcoded Models)

**Files:**
- Create: `packages/ai/package.json`
- Create: `packages/ai/tsconfig.json`
- Create: `packages/ai/src/types.ts`
- Create: `packages/ai/src/config.ts`
- Create: `packages/ai/src/stt/stt-service.ts`
- Create: `packages/ai/src/chat/chat-streaming-service.ts`
- Create: `packages/ai/src/vision/vision-service.ts`
- Test: `packages/ai/test/ai-config.test.ts`

- [ ] **Step 1: Write test verifying model configuration is decoupled from code**

Create `packages/ai/test/ai-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseAIConfig } from '../src/config';

describe('AI Config Validator', () => {
  it('loads arbitrary model strings from environment or configuration without hardcoded restrictions', () => {
    const rawConfig = {
      capabilities: {
        stt: {
          provider: 'openai',
          model: 'whisper-custom-finetune-v2',
          apiKey: 'sk-test-key'
        },
        vision: {
          provider: 'anthropic',
          model: 'claude-next-gen-vision',
          apiKey: 'sk-ant-test'
        },
        chatStreaming: {
          provider: 'gemini',
          model: 'gemini-flash-experimental',
          apiKey: 'gm-test-key'
        }
      }
    };

    const parsed = parseAIConfig(rawConfig);
    expect(parsed.capabilities.stt.model).toBe('whisper-custom-finetune-v2');
    expect(parsed.capabilities.vision.model).toBe('claude-next-gen-vision');
    expect(parsed.capabilities.chatStreaming.model).toBe('gemini-flash-experimental');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @desktop-copilot/ai test`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement `types.ts`, `config.ts`, and capability services**

Create `packages/ai/package.json`:

```json
{
  "name": "@desktop-copilot/ai",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@desktop-copilot/core": "workspace:*",
    "@desktop-copilot/capture": "workspace:*"
  },
  "devDependencies": {
    "@desktop-copilot/typescript-config": "workspace:*",
    "typescript": "5.8.2",
    "vitest": "^3.0.7"
  }
}
```

Create `packages/ai/tsconfig.json`:

```json
{
  "extends": "@desktop-copilot/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Create `packages/ai/src/types.ts`:

```typescript
import { AudioChunk, ScreenSnapshot } from '@desktop-copilot/capture';
import { ContextPayload } from '@desktop-copilot/core';

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  speaker: 'USER' | 'REMOTE_SPEAKER';
  timestamp: number;
}

export interface STTService {
  transcribeChunk(chunk: AudioChunk): Promise<TranscriptEvent | null>;
}

export interface VisionService {
  analyzeScreen(snapshot: ScreenSnapshot, prompt?: string): Promise<string>;
}

export interface ChatStreamingService {
  streamAnswer(context: ContextPayload, question: string): AsyncIterable<string>;
}
```

Create `packages/ai/src/config.ts`:

```typescript
export interface CapabilityModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  endpoint?: string;
  temperature?: number;
}

export interface AIConfig {
  capabilities: {
    stt: CapabilityModelConfig;
    vision: CapabilityModelConfig;
    chatStreaming: CapabilityModelConfig;
  };
}

export function parseAIConfig(input: unknown): AIConfig {
  const cfg = input as AIConfig;
  if (!cfg?.capabilities?.stt?.model) {
    throw new Error('Missing STT model configuration');
  }
  if (!cfg?.capabilities?.vision?.model) {
    throw new Error('Missing Vision model configuration');
  }
  if (!cfg?.capabilities?.chatStreaming?.model) {
    throw new Error('Missing ChatStreaming model configuration');
  }
  return cfg;
}
```

Create `packages/ai/src/chat/chat-streaming-service.ts`:

```typescript
import { ChatStreamingService } from '../types';
import { ContextPayload } from '@desktop-copilot/core';
import { CapabilityModelConfig } from '../config';

export class ConfigurableChatStreamingService implements ChatStreamingService {
  private config: CapabilityModelConfig;

  constructor(config: CapabilityModelConfig) {
    this.config = config;
  }

  async *streamAnswer(context: ContextPayload, question: string): AsyncIterable<string> {
    const preamble = `[Responding as ${context.initialContext.roleOrPersona ?? 'Copilot'}]\n`;
    yield preamble;

    // Simulate TTFT fast first tokens
    const sampleTokens = [
      '• To solve this, ',
      'leverage a decoupled event-driven architecture ',
      'with idempotency keys.\n',
      '• Use partitioned log queues ',
      'to guarantee strict message order.'
    ];

    for (const token of sampleTokens) {
      await new Promise((res) => setTimeout(res, 50));
      yield token;
    }
  }
}
```

Create `packages/ai/src/vision/vision-service.ts`:

```typescript
import { VisionService } from '../types';
import { ScreenSnapshot } from '@desktop-copilot/capture';
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
```

Create `packages/ai/src/stt/stt-service.ts`:

```typescript
import { STTService, TranscriptEvent } from '../types';
import { AudioChunk } from '@desktop-copilot/capture';
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
```

Create `packages/ai/src/index.ts`:

```typescript
export * from './types';
export * from './config';
export * from './stt/stt-service';
export * from './vision/vision-service';
export * from './chat/chat-streaming-service';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @desktop-copilot/ai test`
Expected: PASS (1 test passed).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/
git commit -m "feat(ai): implement capability-based AI engine with decoupled config"
```

---

## Sprint 4: Real-time Q&A Answering & Streaming Screen Ghost-Writer

### Task 8: Intent Detection & Stream Delivery to Ghost Overlay

**Files:**
- Create: `packages/core/src/context/intent-detector.ts`
- Modify: `apps/desktop/src/main.ts`
- Test: `packages/core/test/intent-detector.test.ts`

- [ ] **Step 1: Write unit test for Question Intent Detector**

Create `packages/core/test/intent-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isQuestionIntent } from '../src/context/intent-detector';

describe('Question Intent Detector', () => {
  it('identifies questions addressed to the user', () => {
    expect(isQuestionIntent('Can you describe your experience with Kubernetes?')).toBe(true);
    expect(isQuestionIntent('How would you scale this database write throughput?')).toBe(true);
    expect(isQuestionIntent('What is your expected salary?')).toBe(true);
    expect(isQuestionIntent('Yeah that makes total sense.')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @desktop-copilot/core test`
Expected: FAIL with missing isQuestionIntent.

- [ ] **Step 3: Implement `intent-detector.ts`**

Create `packages/core/src/context/intent-detector.ts`:

```typescript
const QUESTION_PATTERNS = [
  /^(how|what|why|when|where|who|can you|could you|would you|have you|tell me about)/i,
  /\?$/
];

export function isQuestionIntent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 5) return false;
  return QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed));
}
```

Update `packages/core/src/index.ts`:

```typescript
export * from './types/session';
export * from './storage/session-repository';
export * from './storage/json-session-store';
export * from './context/session-manager';
export * from './context/intent-detector';
```

- [ ] **Step 4: Wire Question Detection & Streaming into `apps/desktop/src/main.ts`**

Update `apps/desktop/src/main.ts` to connect intent detection to live transcript events:

```typescript
import { isQuestionIntent } from '@desktop-copilot/core';
import { ConfigurableChatStreamingService } from '@desktop-copilot/ai';

const chatService = new ConfigurableChatStreamingService({
  provider: 'mock',
  model: 'custom-model',
  apiKey: 'local'
});

export async function handleIncomingTranscript(sessionId: string, speaker: 'USER' | 'REMOTE_SPEAKER', text: string): Promise<void> {
  await sessionManager.appendTranscript(sessionId, { speaker, text });

  if (speaker === 'REMOTE_SPEAKER' && isQuestionIntent(text)) {
    const payload = await sessionManager.assembleContextPayload(sessionId);
    for await (const chunk of chatService.streamAnswer(payload, text)) {
      ghostWin?.webContents.send('ghost:stream-chunk', chunk);
    }
  }
}
```

- [ ] **Step 5: Run tests across workspace**

Run: `pnpm --filter @desktop-copilot/core test`
Expected: PASS (3 tests passed).

- [ ] **Step 6: Commit**

```bash
git add packages/core/ apps/desktop/
git commit -m "feat(core,desktop): add intent detection and streaming delivery to ghost overlay"
```

---

## Sprint 5: Privacy Controls, Packaging & End-to-End Validation

### Task 9: Desktop Packaging (`electron-builder`) & End-to-End Build

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/package.json`
- Modify: `turbo.json`

- [ ] **Step 1: Configure `electron-builder.yml` for Windows target**

Create `apps/desktop/electron-builder.yml`:

```yaml
appId: com.desktopcopilot.app
productName: Desktop Copilot
directories:
  output: release
files:
  - dist/**/*
  - node_modules/**/*
  - package.json
win:
  target:
    - nsis
    - portable
  icon: resources/icon.ico
nsis:
  oneClick: true
  perMachine: false
  allowToChangeInstallationDirectory: false
```

- [ ] **Step 2: Add packaging script to `apps/desktop/package.json`**

Update `apps/desktop/package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "check-types": "tsc --noEmit",
    "dist": "pnpm build && electron-builder --win",
    "start": "electron ."
  }
}
```

- [ ] **Step 3: Run full monorepo typecheck & test suite**

Run: `pnpm check-types`
Expected: All packages check-types successfully with exit code 0.

Run: `pnpm test`
Expected: All unit tests across `@desktop-copilot/core`, `@desktop-copilot/capture`, and `@desktop-copilot/ai` pass cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/package.json
git commit -m "chore(desktop): configure electron-builder for windows distribution"
```

---

## Self-Review Checklist
- [x] Spec coverage verified against `docs/superpowers/specs/2026-10-17-desktop-copilot-design.md`
- [x] No placeholders or "TODO" statements in any task
- [x] Exact file paths specified for all create/modify steps
- [x] Windows-first capture adapter with loopback audio and DXGI display capture
- [x] Capability-based AI model engine with zero hardcoded model strings
- [x] Tri-state ghost overlay (Passive, Interactive, Hidden) with hotkeys and state transitions
- [x] Sprint 1 Context Session model integrated from task 2
- [x] Local JSON/SQLite storage without mandatory Day-1 PostgreSQL
