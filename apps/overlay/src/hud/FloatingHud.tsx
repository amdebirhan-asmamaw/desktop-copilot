import React, { useState, useEffect } from 'react';
import { Button, Card, Dialog } from '@repo/ui';
import { AudioWaveform } from './AudioWaveform';
import { MarkdownRenderer } from '../ghost/MarkdownRenderer';

interface CopilotApiBridge {
  onOverlayModeChanged?: (cb: (m: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void;
  setOverlayMode?: (m: string) => Promise<void>;
  createSession?: (ctx: unknown) => Promise<unknown>;
  feedTranscript?: (p: { speaker: 'USER' | 'REMOTE_SPEAKER'; text: string; isFinal?: boolean }) => Promise<void>;
  cancelActiveRequest?: () => Promise<void>;
  getProviderStatus?: () => Promise<{ provider: string; model: string; isDemo: boolean }>;
  onTranscriptEvent?: (cb: (data: { speaker: string; text: string; isFinal: boolean; timestamp: number }) => void) => () => void;
  captureScreenSnapshot?: () => Promise<{ success: boolean; dataUrl?: string; width?: number; height?: number; error?: string }>;
  setHudSize?: (size: { width: number; height: number }) => Promise<void>;
  copyToClipboard?: (text: string) => Promise<boolean>;
  setWindowPosition?: (x: number, y: number) => Promise<void>;
  getWindowPosition?: () => Promise<{ x: number; y: number }>;
  onGhostStreamStart?: (cb: (data: { requestId: string; question: string; isDemo?: boolean }) => void) => () => void;
  onGhostStreamChunk?: (cb: (data: { requestId: string; text: string }) => void) => () => void;
  onGhostStreamEnd?: (cb: (data: { requestId: string; fullAnswer?: string }) => void) => () => void;
  onGhostStreamError?: (cb: (data: { requestId: string; error: { code: string; message: string } }) => void) => () => void;
}

export const FloatingHud: React.FC = () => {
  const [mode, setMode] = useState<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>('PASSIVE');
  const [micActive, setMicActive] = useState<boolean>(true);
  const [screenActive, setScreenActive] = useState<boolean>(true);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [roleInput, setRoleInput] = useState<string>('Senior Distributed Systems Architect');
  const [instructionsInput, setInstructionsInput] = useState<string>('Keep answers concise with structured bullet points and high-level trade-offs');
  const [quickPrompt, setQuickPrompt] = useState<string>('');
  const [providerInfo, setProviderInfo] = useState<{ provider: string; model: string; isDemo: boolean } | null>(null);
  const [latestTranscript, setLatestTranscript] = useState<{ speaker: string; text: string } | null>(null);

  // Unified Answer & Stream State
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [streamedText, setStreamedText] = useState<string>('');
  const [answerStatus, setAnswerStatus] = useState<'IDLE' | 'STREAMING' | 'COMPLETED' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<{ code: string; message: string } | null>(null);
  const [cardOpacity, setCardOpacity] = useState<number>(0.96);
  const [copiedQ, setCopiedQ] = useState<boolean>(false);
  const [copiedA, setCopiedA] = useState<boolean>(false);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);

  const hasActiveAnswer = answerStatus !== 'IDLE' && (!!streamedText || !!currentQuestion || answerStatus === 'ERROR');

  // Dynamically resize Electron HUD window so unified card or dialog fits smoothly
  useEffect(() => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (showConfigModal) {
      api?.setHudSize?.({ width: 640, height: 420 });
    } else if (hasActiveAnswer) {
      api?.setHudSize?.({ width: 640, height: 560 });
    } else {
      api?.setHudSize?.({ width: 640, height: 95 });
    }
  }, [showConfigModal, hasActiveAnswer]);

  useEffect(() => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (!api) return;

    const unsubMode = api.onOverlayModeChanged?.((newMode) => setMode(newMode));

    const unsubTranscript = api.onTranscriptEvent?.((data) => {
      setLatestTranscript({
        speaker: data.speaker === 'REMOTE_SPEAKER' ? 'Interviewer' : 'You',
        text: data.text
      });
    });

    const unsubStart = api.onGhostStreamStart?.((data) => {
      setCurrentQuestion(data.question);
      setStreamedText('');
      setErrorMessage(null);
      setAnswerStatus('STREAMING');
      setCopiedQ(false);
      setCopiedA(false);
      setCopiedAll(false);
    });

    const unsubChunk = api.onGhostStreamChunk?.((data) => {
      setStreamedText((t) => t + data.text);
    });

    const unsubEnd = api.onGhostStreamEnd?.(() => {
      setAnswerStatus('COMPLETED');
    });

    const unsubError = api.onGhostStreamError?.((data) => {
      setAnswerStatus('ERROR');
      setErrorMessage(data.error);
    });

    api.getProviderStatus?.().then((info) => {
      if (info) setProviderInfo(info);
    });

    return () => {
      unsubMode?.();
      unsubTranscript?.();
      unsubStart?.();
      unsubChunk?.();
      unsubEnd?.();
      unsubError?.();
    };
  }, []);

  const toggleOverlayMode = async () => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    const nextMode = mode === 'PASSIVE' ? 'INTERACTIVE' : 'PASSIVE';
    await api?.setOverlayMode?.(nextMode);
    setMode(nextMode);
  };

  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Primary left click only
    let startX = e.screenX;
    let startY = e.screenY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.screenX - startX;
      const deltaY = moveEvent.screenY - startY;
      startX = moveEvent.screenX;
      startY = moveEvent.screenY;

      const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
      if (api?.getWindowPosition && api?.setWindowPosition) {
        api.getWindowPosition().then((pos) => {
          if (pos) {
            api.setWindowPosition?.(pos.x + deltaX, pos.y + deltaY);
          }
        });
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Robust multi-fallback clipboard copying
  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (!text) return false;

    // 1. Primary: IPC bridge to Electron main process (native clipboard.writeText)
    try {
      const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
      if (api?.copyToClipboard) {
        await api.copyToClipboard(text);
        return true;
      }
    } catch (err) {
      console.warn('[Clipboard] IPC bridge copy failed, trying fallback:', err);
    }

    // 2. Secondary: Browser Clipboard API
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('[Clipboard] navigator.clipboard failed, trying fallback:', err);
    }

    // 3. Fallback: Hidden DOM textarea with document.execCommand('copy')
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '-9999px';
      document.body.appendChild(el);
      el.select();
      const success = document.execCommand('copy');
      document.body.removeChild(el);
      return success;
    } catch (err) {
      console.error('[Clipboard] All copy attempts failed:', err);
      return false;
    }
  };

  const handleCopyQuestion = async () => {
    if (!currentQuestion) return;
    const ok = await copyTextToClipboard(currentQuestion);
    if (ok) {
      setCopiedQ(true);
      setTimeout(() => setCopiedQ(false), 2000);
    }
  };

  const handleCopyAnswer = async () => {
    if (!streamedText) return;
    const ok = await copyTextToClipboard(streamedText);
    if (ok) {
      setCopiedA(true);
      setTimeout(() => setCopiedA(false), 2000);
    }
  };

  const handleCopyAll = async () => {
    const fullText = `Question:\n${currentQuestion}\n\nAnswer:\n${streamedText}`;
    const ok = await copyTextToClipboard(fullText);
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const handleSaveContext = async () => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (api?.createSession) {
      await api.createSession({
        roleOrPersona: roleInput,
        instructions: instructionsInput
      });
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setShowConfigModal(false);
      }, 350);
    } else {
      setShowConfigModal(false);
    }
  };

  const handleCloseModal = () => {
    setShowConfigModal(false);
  };

  const handleFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveContext();
    }
  };

  const handleQuickPromptSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && quickPrompt.trim()) {
      const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
      const question = quickPrompt.trim();
      setQuickPrompt('');
      await api?.feedTranscript?.({
        speaker: 'REMOTE_SPEAKER',
        text: question,
        isFinal: true
      });
    }
  };

  const handleCancelActive = async () => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    await api?.cancelActiveRequest?.();
  };

  const handleDismissAnswer = () => {
    setAnswerStatus('IDLE');
    setStreamedText('');
    setCurrentQuestion('');
    setErrorMessage(null);
  };

  return (
    <>
      <Card
        variant="glass"
        style={{ opacity: cardOpacity }}
        className={`flex flex-col p-3 text-white shadow-[0_20px_50px_rgba(0,0,0,0.7)] backdrop-blur-2xl transition-all duration-200 border rounded-2xl ${
          mode === 'INTERACTIVE'
            ? 'border-sky-400/50 shadow-sky-500/10'
            : 'border-white/15'
        }`}
      >
        {/* Top Row: Clean, Harmonious Header Bar */}
        <div
          className="app-drag flex items-center justify-between gap-2.5 pb-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {/* Left Cluster: Drag Handle + Mode Toggle + Provider Tag + Waveform */}
          <div
            className="flex items-center gap-2 app-no-drag"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {/* Dedicated Tactile Drag Handle */}
            <div
              className="app-drag flex items-center justify-center w-5 h-7 text-slate-400 hover:text-white cursor-grab active:cursor-grabbing select-none transition-colors shrink-0"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              onMouseDown={handleDragMouseDown}
              title="Drag here to reposition overlay window"
            >
              <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" className="opacity-70 hover:opacity-100 transition-opacity">
                <circle cx="2.5" cy="2.5" r="1.2" />
                <circle cx="7.5" cy="2.5" r="1.2" />
                <circle cx="2.5" cy="7" r="1.2" />
                <circle cx="7.5" cy="7" r="1.2" />
                <circle cx="2.5" cy="11.5" r="1.2" />
                <circle cx="7.5" cy="11.5" r="1.2" />
              </svg>
            </div>

            {/* Unified Mode Toggle Pill */}
            <button
              type="button"
              onClick={toggleOverlayMode}
              className={`app-no-drag flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide transition-all select-none shadow-sm ${
                mode === 'INTERACTIVE'
                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-400/40 shadow-emerald-500/10'
                  : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-white/10'
              }`}
              title="Toggle Click-Through vs Interactive (Ctrl+Shift+I)"
            >
              {mode === 'INTERACTIVE' ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-slate-400"></span>
              )}
              <span>{mode === 'INTERACTIVE' ? 'INTERACTIVE' : 'PASSIVE'}</span>
              <kbd className="text-[8.5px] font-mono px-1 py-0.2 rounded bg-black/40 border border-white/10 opacity-75">
                Ctrl+Shift+I
              </kbd>
            </button>

            {/* Provider Pill */}
            {providerInfo && (
              <span
                className="app-no-drag text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300 select-none flex items-center gap-1 font-medium"
                title={`Provider: ${providerInfo.provider} (${providerInfo.model})`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${providerInfo.isDemo ? 'bg-amber-400' : 'bg-sky-400'}`}></span>
                {providerInfo.isDemo ? 'Demo Mode' : providerInfo.provider}
              </span>
            )}

            {/* Audio Waveform */}
            <AudioWaveform active={micActive} />
          </div>

          {/* Right Cluster: Media Toggles + Demo Q&A + Stop + Settings */}
          <div
            className="flex items-center gap-2 app-no-drag"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {/* Segmented Media Controls (Mic & Screen) */}
            <div className="flex items-center bg-slate-900/60 p-0.5 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setMicActive(!micActive)}
                className={`h-6 px-2 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
                  micActive
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
                title={micActive ? 'Microphone Active (Click to mute)' : 'Microphone Muted (Click to unmute)'}
              >
                <span>{micActive ? '🎙️' : '🔇'}</span>
                <span className="text-[9.5px] uppercase font-semibold">{micActive ? 'Mic' : 'Muted'}</span>
              </button>

              <button
                type="button"
                onClick={() => setScreenActive(!screenActive)}
                className={`h-6 px-2 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
                  screenActive
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
                title={screenActive ? 'Screen Capture Active' : 'Screen Capture Paused'}
              >
                <span>{screenActive ? '🖥️' : '⏹️'}</span>
                <span className="text-[9.5px] uppercase font-semibold">{screenActive ? 'Screen' : 'Off'}</span>
              </button>
            </div>

            {/* Demo Q&A Trigger Button */}
            <button
              type="button"
              onClick={async () => {
                const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
                await api?.feedTranscript?.({
                  speaker: 'REMOTE_SPEAKER',
                  text: 'Can you explain your approach to handling database sharding and cross-shard queries?',
                  isFinal: true
                });
              }}
              className="h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-amber-500/20 to-amber-600/20 hover:from-amber-500/30 hover:to-amber-600/30 text-amber-300 border border-amber-400/40 shadow-sm shadow-amber-500/10 transition-all flex items-center gap-1 select-none"
              title="Simulate incoming interviewer question"
            >
              <span>⚡</span>
              <span>Demo Q&A</span>
            </button>

            {/* Cancel/Stop Streaming Button (Only when streaming) */}
            {answerStatus === 'STREAMING' && (
              <button
                type="button"
                onClick={handleCancelActive}
                className="h-7 px-2 rounded-lg text-[11px] font-medium bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-400/40 transition-all flex items-center gap-1 animate-pulse select-none"
                title="Cancel current generation"
              >
                <span>⏹</span>
                <span>Stop</span>
              </button>
            )}

            {/* Settings Context Button */}
            <button
              type="button"
              onClick={() => setShowConfigModal(true)}
              className="h-7 w-7 rounded-lg text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center justify-center text-xs select-none"
              title="Session Persona & Context"
            >
              ⚙️
            </button>
          </div>
        </div>

        {/* Second Row: Prompt Input Bar & Interviewer Ticker */}
        <div
          className="flex items-center gap-2 pt-2 border-t border-white/10 app-no-drag"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex-1">
            <input
              type="text"
              value={quickPrompt}
              onChange={(e) => setQuickPrompt(e.target.value)}
              onKeyDown={handleQuickPromptSubmit}
              placeholder="Type question & press Enter..."
              className="w-full text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-400/80 focus:bg-white/10 transition-all"
            />
          </div>

          {latestTranscript && (
            <div
              className="max-w-[230px] truncate text-[10px] text-slate-300 bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/10 select-none flex items-center gap-1"
              title={`${latestTranscript.speaker}: ${latestTranscript.text}`}
            >
              <span className="text-sky-400 font-semibold shrink-0">{latestTranscript.speaker}:</span>
              <span className="truncate">{latestTranscript.text}</span>
            </div>
          )}
        </div>

        {/* Unified Question & Answer Section (Displays when active) */}
        {hasActiveAnswer && (
          <div
            className="mt-2.5 pt-2 border-t border-white/15 app-no-drag flex flex-col space-y-2.5"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {/* Header of Response Section */}
            <div className="flex items-center justify-between text-xs pb-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold tracking-wider uppercase text-sky-400 flex items-center gap-1.5">
                  {answerStatus === 'STREAMING' && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                    </span>
                  )}
                  ⚡ Copilot Response
                </span>

                <span className="text-[9.5px] text-slate-400 select-none">
                  {mode === 'INTERACTIVE' ? 'Touch & Scrollable' : '100% Click-through'}
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                {mode === 'INTERACTIVE' && (
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 select-none">
                    <span>Opacity:</span>
                    <input
                      type="range"
                      min="0.3"
                      max="1"
                      step="0.05"
                      value={cardOpacity}
                      onChange={(e) => setCardOpacity(parseFloat(e.target.value))}
                      className="w-14 h-1 bg-slate-700 rounded-lg cursor-pointer accent-sky-400"
                    />
                    <span className="text-[9.5px] font-mono text-slate-300 w-6">
                      {Math.round(cardOpacity * 100)}%
                    </span>
                  </div>
                )}

                {mode === 'INTERACTIVE' && streamedText && (
                  <button
                    type="button"
                    onClick={handleCopyAll}
                    className="app-no-drag text-[10px] h-6 px-2.5 rounded-md font-medium transition-all bg-white/5 hover:bg-white/15 border border-white/15 text-slate-200 flex items-center gap-1 select-none"
                    title="Copy both Question and Answer to Clipboard"
                  >
                    {copiedAll ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">✓ Copied All!</span>
                    ) : (
                      <span>📋 Copy All</span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleDismissAnswer}
                  className="app-no-drag text-slate-400 hover:text-white cursor-pointer text-xs p-1 rounded-md hover:bg-white/10 transition-colors select-none"
                  title="Dismiss Answer (Collapses view)"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Scrollable Container for Question & Answer */}
            <div className="max-h-[50vh] overflow-y-auto pr-1 space-y-2.5 custom-scrollbar select-text cursor-text">
              {/* Question Block */}
              {currentQuestion && (
                <div className="bg-slate-900/50 border border-white/10 rounded-xl p-3 flex flex-col space-y-1.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                      Question
                    </span>
                    {mode === 'INTERACTIVE' && (
                      <button
                        type="button"
                        onClick={handleCopyQuestion}
                        className="app-no-drag text-[10px] h-6 px-2.5 rounded-md font-medium transition-all bg-white/5 hover:bg-white/15 border border-white/15 text-slate-200 flex items-center gap-1 select-none"
                        title="Copy Question only"
                      >
                        {copiedQ ? (
                          <span className="text-emerald-400 font-semibold flex items-center gap-1">✓ Copied!</span>
                        ) : (
                          <span>📋 Copy Q</span>
                        )}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-100 font-medium leading-relaxed select-text cursor-text break-words">
                    {currentQuestion}
                  </p>
                </div>
              )}

              {/* Error Banner */}
              {answerStatus === 'ERROR' && errorMessage && (
                <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs">
                  <div className="font-semibold text-rose-300 mb-0.5">
                    ⚠️ {errorMessage.code}
                  </div>
                  <div>{errorMessage.message}</div>
                </div>
              )}

              {/* Thinking / Streaming placeholder before first token */}
              {answerStatus === 'STREAMING' && !streamedText && (
                <div className="bg-slate-900/60 border border-sky-500/20 rounded-xl p-3 flex items-center gap-2.5 text-xs text-sky-200">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400"></span>
                  </span>
                  <span className="font-medium animate-pulse text-[11px] text-sky-300">
                    Analyzing question & generating key points...
                  </span>
                </div>
              )}

              {/* Answer Block */}
              {streamedText && (
                <div className="bg-slate-900/60 border border-white/10 rounded-xl p-3.5 flex flex-col space-y-2">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      Answer
                    </span>
                    {mode === 'INTERACTIVE' && (
                      <button
                        type="button"
                        onClick={handleCopyAnswer}
                        className="app-no-drag text-[10px] h-6 px-2.5 rounded-md font-medium transition-all bg-emerald-600/80 hover:bg-emerald-500 border border-emerald-400/40 text-white shadow-sm shadow-emerald-500/20 flex items-center gap-1 select-none"
                        title="Copy Answer only"
                      >
                        {copiedA ? (
                          <span className="text-white font-semibold flex items-center gap-1">✓ Copied Answer!</span>
                        ) : (
                          <span>📋 Copy Answer</span>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="text-[13.5px] leading-relaxed font-sans text-slate-100 selection:bg-sky-500/30 selection:text-white select-text cursor-text">
                    <MarkdownRenderer content={streamedText} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Context Configuration Modal */}
      <Dialog
        open={showConfigModal}
        onOpenChange={setShowConfigModal}
        title="⚙️ Session Persona & Context"
        description="Set your candidate background and behavioral instructions to guide AI responses."
      >
        <div
          className="space-y-3.5 app-no-drag"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onKeyDown={handleFormKeyDown}
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <label className="block text-[11px] font-semibold text-slate-200 mb-1">
              Role / Target Persona
            </label>
            <input
              type="text"
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              placeholder="e.g. Senior Distributed Systems Architect"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-400/80 focus:bg-white/10 transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-200 mb-1">
              Guidance & Behavioral Instructions
            </label>
            <textarea
              value={instructionsInput}
              onChange={(e) => setInstructionsInput(e.target.value)}
              placeholder="e.g. Keep answers under 3 punchy bullet points and emphasize high-level trade-offs"
              rows={3}
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-400/80 focus:bg-white/10 transition-all resize-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Tip: Press <kbd className="text-[9px] font-mono bg-white/10 px-1 py-0.5 rounded text-slate-300">Ctrl+Enter</kbd> to save.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={handleCloseModal}
              className="text-xs text-slate-300 hover:text-white hover:bg-white/10 h-7 px-3 border border-white/10"
            >
              Cancel
            </Button>
            <Button
              variant="emerald"
              size="sm"
              type="button"
              onClick={handleSaveContext}
              className="text-xs font-semibold h-7 px-3 shadow-lg shadow-emerald-500/20 bg-emerald-600/80 hover:bg-emerald-500 text-white border border-emerald-400/30"
            >
              {saveSuccess ? '✓ Saved!' : 'Save Context'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};
