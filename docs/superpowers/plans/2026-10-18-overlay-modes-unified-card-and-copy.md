# Overlay Selective Interaction, Unified Q&A Card, and Independent Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement selective click-through for INTERACTIVE mode (where only the card captures clicks while outside clicks pass through), display the <kbd>Ctrl+Shift+I</kbd> hotkey clearly, unify question and answer into a single vertically scrollable card, and provide independent copy buttons and text selection for both question and answer.

**Architecture:** Electron's `setIgnoreMouseEvents` bridge is upgraded to support dynamic mouse forwarding. In the renderer, a window-level mouse tracker checks bounding box containment against `#ghost-card` in INTERACTIVE mode: when the cursor is over the card, mouse events are captured (`ignore: false`); when outside, mouse events pass through to underlying OS windows (`ignore: true, forward: true`). In PASSIVE mode, mouse events pass through unconditionally. The overlay card UI is refactored into a single card with a pinned header, a unified scrollable body (`max-h-[62vh] overflow-y-auto custom-scrollbar`) housing both the question and answer blocks, and separate copy handlers for Question, Answer, and Full Q&A.

**Tech Stack:** Electron 34, React 19, TypeScript, TailwindCSS v4, Vitest.

---

### File Structure & Responsibility

- `apps/desktop/src/preload.ts`: Expose `setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean })` on `window.copilotApi`.
- `apps/desktop/src/main.ts`: Handle `overlay:set-ignore-mouse-events` IPC and configure default `forward: true` on `ghostWin` during INTERACTIVE mode.
- `apps/overlay/src/index.css`: Provide `.custom-scrollbar` utility classes for smooth translucent scrolling.
- `apps/overlay/src/hud/FloatingHud.tsx`: Display `<kbd>Ctrl+Shift+I</kbd>` shortcut on the mode toggle button and declare `setIgnoreMouseEvents` in the bridge interface.
- `apps/overlay/src/ghost/GhostOverlay.tsx`: 
  - Mouse-tracking effect to toggle `setIgnoreMouseEvents` selectively inside/outside the card in INTERACTIVE mode.
  - Unified single card with pinned controls header.
  - Scrollable Q&A container (`max-h-[62vh] overflow-y-auto`).
  - Independent `Copy Question` and `Copy Answer` buttons with copied feedback states.
  - Visible shortcut badge (`Ctrl+Shift+I`) and status indicators.

---

### Tasks

- [ ] **Task 1: Preload & Main Process IPC Bridge for Selective Click-Through**
  - **Files:** `apps/desktop/src/preload.ts`, `apps/desktop/src/main.ts`
  - **Action:**
    1. In `preload.ts`, declare `setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void` in `ElectronCopilotApi` and implement it via `ipcRenderer.send('overlay:set-ignore-mouse-events', ignore, options)`.
    2. In `main.ts`, register `ipcMain.on('overlay:set-ignore-mouse-events', (event, ignore, options) => { ... })`.
    3. In `applyOverlayMode`, ensure `INTERACTIVE` mode initializes `ghostWin.setIgnoreMouseEvents(true, { forward: true })` so outside clicks pass through by default.
  - **Verification:** `pnpm --filter @repo/desktop check-types`

- [ ] **Task 2: Custom Scrollbar Styles**
  - **Files:** `apps/overlay/src/index.css`
  - **Action:**
    1. Add `.custom-scrollbar` WebKit scrollbar rules with a transparent track and translucent thumb (`rgba(255, 255, 255, 0.2)` hovering to `0.4`).
  - **Verification:** Inspect `apps/overlay/src/index.css`

- [ ] **Task 3: HUD Mode Toggle Shortcut Visibility**
  - **Files:** `apps/overlay/src/hud/FloatingHud.tsx`
  - **Action:**
    1. Add `setIgnoreMouseEvents` to `CopilotApiBridge` interface.
    2. Update the `Interact` / `Passive` mode button in the HUD to display an inline shortcut badge `<kbd className="...">Ctrl+Shift+I</kbd>`.
    3. Add a descriptive title `Toggle Click-Through vs Interactive (Ctrl+Shift+I)` to the button.
  - **Verification:** `pnpm --filter @repo/overlay check-types`

- [ ] **Task 4: Ghost Overlay Selective Click-Through Engine**
  - **Files:** `apps/overlay/src/ghost/GhostOverlay.tsx`
  - **Action:**
    1. Attach a `ref={cardRef}` to `#ghost-card`.
    2. Add a `useEffect` on `[mode]` that registers a `mousemove` listener on `window` when `mode === 'INTERACTIVE'`.
    3. Compute `card.getBoundingClientRect()`. If the cursor is inside, send `api.setIgnoreMouseEvents(false)`; if outside, send `api.setIgnoreMouseEvents(true, { forward: true })`.
    4. On cleanup or when `mode !== 'INTERACTIVE'`, reset `isHoveredRef` and ensure `api.setIgnoreMouseEvents(true, { forward: true })` is sent.
  - **Verification:** Inspect mouse tracking logic and check types.

- [ ] **Task 5: Unified Scrollable Card with Independent Copy & Shortcuts**
  - **Files:** `apps/overlay/src/ghost/GhostOverlay.tsx`
  - **Action:**
    1. Implement independent copy handlers:
       - `handleCopyQuestion`: Copies `currentQuestion`, sets `copiedQ` state for 2s.
       - `handleCopyAnswer`: Copies `streamedText`, sets `copiedA` state for 2s.
       - `handleCopyAll`: Copies `Question:\n...\n\nAnswer:\n...`, sets `copiedAll` state for 2s.
    2. **Pinned Header:**
       - Status dot (streaming / completed).
       - Title `⚡ Copilot Answer`.
       - Demo Mode badge (when applicable).
       - Mode badge showing shortcut:
         - Interactive: `🟢 INTERACTIVE [Ctrl+Shift+I]` + `Card Interactive • Outside Passes Through`
         - Passive: `⚪ PASSIVE [Ctrl+Shift+I]` + `100% Click-Through`
       - Opacity slider.
       - Header `📋 Copy All` and `✕ Dismiss` buttons.
    3. **Scrollable Card Body (`max-h-[62vh] overflow-y-auto custom-scrollbar`):**
       - **Question Block:** Glass card (`bg-white/5 border border-white/10 rounded-xl p-3`) with `Q: [question text]` and dedicated `📋 Copy Question` button.
       - **Answer Block:** Glass card (`bg-slate-900/50 border border-white/10 rounded-xl p-3.5`) with dedicated `📋 Copy Answer` button and `<MarkdownRenderer content={streamedText} />`.
       - Enable `select-text cursor-text` so the user can highlight and copy any text with <kbd>Ctrl+C</kbd> and paste anywhere.
  - **Verification:** `pnpm --filter @repo/overlay check-types`

- [ ] **Task 6: Build & Verification**
  - **Action:**
    1. Build overlay: `pnpm --filter @repo/overlay build`
    2. Build desktop: `pnpm --filter @repo/desktop build`
    3. Run full typecheck: `pnpm check-types`
    4. Run unit tests: `pnpm test`
    5. Commit all changes with conventional commit: `feat(overlay): selective click-through, unified scrollable Q&A card, and independent copy buttons`
