# 🚀 Desktop Copilot

> Local-first, low-latency AI desktop assistant with transparent ghost writing, real-time screen reasoning, and voice conversation listening.

Desktop Copilot runs silently in the background during interviews, meetings, or complex coding sessions. It captures conversation audio, reads your screen context, and streams structured answers directly onto a click-through transparent overlay on top of any active window.

---

## ⚡ Highlights

- 👻 **Full-Screen Transparent Ghost Overlay**: Streamed answers appear directly on your display with zero window frames and click-through transparency (`PASSIVE` mode).
- 🎛️ **Floating HUD Pill**: Draggable, always-on-top pill at the top of your screen with quick controls, state indicators, and context configuration.
- ⌨️ **System-Wide Global Shortcuts**: Instant privacy panic hide (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd>), interactive mode toggle (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>), and test demo question trigger (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>).
- 🎙️ **Dual-Stream Audio Capture**: Captures both microphone (`USER`) and system loopback speaker (`REMOTE_SPEAKER`) with energy-based VAD chunking.
- 👁️ **Windows DXGI Screen Capture**: Captures desktop displays with low latency and optimal frame encoding.
- 🧠 **Capability-Based AI Architecture**: Zero hardcoded model names. Switch freely between OpenAI, Google Gemini, Anthropic Claude, Deepgram, or offline mock mode.
- 📦 **Monorepo Architecture**: Clean Turborepo with pnpm workspaces, TypeScript strict typing, and shared design tokens.

---

## ⌨️ Global Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> | **Trigger Demo Q&A** | Streams a technical answer to test ghost overlay rendering and typewriter streaming. |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> | **Passive / Interactive Mode** | Toggles click-through mode off/on to select text, copy answers, or dismiss cards. |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd> | **Panic / Privacy Hide** | Instantly hides the overlay from screen and taskbar. Press again to restore. |
| <kbd>Esc</kbd> | **Exit Interactive Mode** | Returns the overlay to click-through passive mode. |

---

## 🏃 Quick Start

### 1. Prerequisites
- **Node.js**: `>= 22`
- **pnpm**: `10.12.1+`
- **Platform**: Windows 10/11

### 2. Environment Setup
```powershell
cp .env.example .env
```
*(By default, `.env` runs in offline **Mock Mode** requiring no API keys. Add your `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY` for live cloud models).*

### 3. Run the Application

```powershell
# Run with pre-built overlay bundle
pnpm --filter @repo/desktop start
```

### 4. Development Mode (with Live Vite HMR)
```powershell
# Terminal 1: Start React overlay server
pnpm --filter @repo/overlay dev

# Terminal 2: Start Electron
pnpm --filter @repo/desktop start
```

---

## 📂 Repository Structure

```
desktop-copilot/
├── apps/
│   ├── desktop/             # Electron main process (dual-window manager, IPC, global shortcuts)
│   ├── overlay/             # React 19 + Vite 6 + Tailwind CSS v4 HUD & Ghost Overlay
│   └── web/                 # Next.js web dashboard
├── packages/
│   ├── core/                # Session models, JSON storage, question intent detector
│   ├── capture/             # Windows DXGI screen capture & VAD dual-audio chunking
│   ├── ai/                  # Capability-based streaming chat, vision, STT, and env loader
│   ├── ui/                  # Shared accessible UI primitives (shadcn/ui style)
│   ├── typescript-config/   # Shared tsconfig bases
│   └── eslint-config/       # Shared lint configs
└── docs/
    ├── USER_GUIDE.md        # Complete user manual, workflows, and operations guide
    └── superpowers/         # Architecture specs and implementation plans
```

---

## 📖 Complete Documentation

For detailed architectural diagrams, session management workflows, capture adapter specs, and troubleshooting guides, see:

👉 [**docs/USER_GUIDE.md**](file:///d:/PROJECTS/__self/desktop-copilot/docs/USER_GUIDE.md)
