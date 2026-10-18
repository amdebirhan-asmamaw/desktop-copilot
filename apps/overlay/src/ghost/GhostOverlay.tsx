import React, { useState, useEffect } from 'react';
import { Card, Badge, Button } from '@repo/ui';
import { MarkdownRenderer } from './MarkdownRenderer';

interface CopilotApiBridge {
  onOverlayModeChanged?: (cb: (m: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void;
  onGhostStreamStart?: (cb: (data: { requestId: string; question: string; isDemo?: boolean }) => void) => () => void;
  onGhostStreamChunk?: (cb: (data: { requestId: string; text: string }) => void) => () => void;
  onGhostStreamEnd?: (cb: (data: { requestId: string; fullAnswer?: string }) => void) => () => void;
  onGhostStreamError?: (cb: (data: { requestId: string; error: { code: string; message: string } }) => void) => () => void;
  copyToClipboard?: (text: string) => Promise<void>;
  cancelActiveRequest?: () => Promise<void>;
}

export const GhostOverlay: React.FC = () => {
  const [mode, setMode] = useState<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>('PASSIVE');
  const [activeRequestId, setActiveRequestId] = useState<string>('');
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [isDemo, setIsDemo] = useState<boolean>(false);
  const [streamedText, setStreamedText] = useState<string>('');
  const [status, setStatus] = useState<'IDLE' | 'STREAMING' | 'COMPLETED' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<{ code: string; message: string } | null>(null);
  const [cardOpacity, setCardOpacity] = useState<number>(0.92);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (!api) return;

    const unsubMode = api.onOverlayModeChanged?.((newMode) => {
      setMode(newMode);
    });

    const unsubStart = api.onGhostStreamStart?.((data) => {
      setActiveRequestId(data.requestId);
      setCurrentQuestion(data.question);
      setIsDemo(!!data.isDemo);
      setStreamedText('');
      setErrorMessage(null);
      setStatus('STREAMING');
      setCopied(false);
    });

    const unsubChunk = api.onGhostStreamChunk?.((data) => {
      setActiveRequestId((prev) => {
        if (data.requestId === prev) {
          setStreamedText((t) => t + data.text);
        }
        return prev;
      });
    });

    const unsubEnd = api.onGhostStreamEnd?.((data) => {
      setActiveRequestId((prev) => {
        if (data.requestId === prev) {
          setStatus('COMPLETED');
        }
        return prev;
      });
    });

    const unsubError = api.onGhostStreamError?.((data) => {
      setActiveRequestId((prev) => {
        if (data.requestId === prev) {
          setStatus('ERROR');
          setErrorMessage(data.error);
        }
        return prev;
      });
    });

    return () => {
      unsubMode?.();
      unsubStart?.();
      unsubChunk?.();
      unsubEnd?.();
      unsubError?.();
    };
  }, []);

  const handleCopy = async () => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (api?.copyToClipboard) {
      await api.copyToClipboard(streamedText);
    } else if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(streamedText);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismiss = () => {
    setStatus('IDLE');
    setStreamedText('');
    setErrorMessage(null);
  };

  if (mode === 'HIDDEN' || status === 'IDLE' || (!streamedText && status !== 'ERROR')) {
    return null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none flex flex-col justify-end items-center pb-16 px-8">
      <div
        className="max-w-3xl w-full transition-opacity duration-150"
        style={{ opacity: cardOpacity }}
      >
        <Card
          variant="ghost"
          className={`w-full p-5 text-slate-100 shadow-2xl backdrop-blur-xl transition-all duration-200 ${
            mode === 'INTERACTIVE'
              ? 'pointer-events-auto select-text border-sky-500/70 shadow-sky-500/10'
              : 'pointer-events-none select-none border-white/20'
          }`}
        >
          {/* Header Controls */}
          <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold tracking-widest uppercase text-sky-400 flex items-center gap-1.5">
                {status === 'STREAMING' && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                  </span>
                )}
                ⚡ Copilot Answer
              </span>

              {isDemo && (
                <Badge variant="outline" className="text-[10px] bg-amber-500/20 text-amber-300 border-amber-500/40">
                  Demo Mode
                </Badge>
              )}

              {mode === 'INTERACTIVE' && (
                <Badge variant="interactive" className="text-[10px]">
                  Interactive Focus
                </Badge>
              )}
            </div>

            {/* Interactive Mode Action Bar */}
            {mode === 'INTERACTIVE' ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span>Opacity:</span>
                  <input
                    type="range"
                    min="0.3"
                    max="1"
                    step="0.05"
                    value={cardOpacity}
                    onChange={(e) => setCardOpacity(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-slate-700 rounded-lg cursor-pointer accent-sky-400"
                  />
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  className="text-xs h-7 px-2.5 bg-slate-800/80 hover:bg-slate-700"
                >
                  {copied ? '✓ Copied' : '📋 Copy'}
                </Button>

                <button
                  onClick={handleDismiss}
                  className="text-slate-400 hover:text-white cursor-pointer text-xs p-1"
                  title="Dismiss Answer"
                >
                  ✕
                </button>
              </div>
            ) : (
              <span className="text-[11px] text-slate-400 select-none">
                Ctrl+Shift+I to select or copy
              </span>
            )}
          </div>

          {/* Target Question Heading */}
          {currentQuestion && (
            <div className="mb-2.5 text-xs font-medium text-slate-300 border-l-2 border-sky-400/80 pl-2">
              Q: {currentQuestion}
            </div>
          )}

          {/* Error State Banner */}
          {status === 'ERROR' && errorMessage && (
            <div className="p-3 my-2 rounded-lg bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs">
              <div className="font-semibold text-rose-300 mb-1">
                ⚠️ Provider Error ({errorMessage.code})
              </div>
              <div>{errorMessage.message}</div>
            </div>
          )}

          {/* Formatted Markdown Content */}
          {streamedText && (
            <div className="text-[14.5px] leading-relaxed font-sans selection:bg-sky-500/30 selection:text-white">
              <MarkdownRenderer content={streamedText} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
