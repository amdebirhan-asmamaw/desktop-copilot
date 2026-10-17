import React, { useState, useEffect } from 'react';
import { Card } from '@repo/ui';

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
    <div className="fixed inset-0 pointer-events-none flex flex-col justify-end items-center pb-20 px-6">
      <Card
        variant="ghost"
        className={`max-w-3xl w-full p-5 text-slate-50 text-[15px] leading-relaxed transition-all duration-200 ${
          mode === 'INTERACTIVE'
            ? 'pointer-events-auto select-text border-blue-500 shadow-blue-500/10'
            : 'pointer-events-none select-none border-white/15'
        }`}
      >
        <div className="flex justify-between items-center mb-2.5">
          <span className="text-[11px] uppercase tracking-widest text-sky-400 font-bold">
            ⚡ Copilot Answer Suggestion {mode === 'INTERACTIVE' && '(Interactive Mode)'}
          </span>
          {mode === 'INTERACTIVE' && (
            <button
              onClick={() => setStreamedText('')}
              className="text-slate-400 hover:text-white cursor-pointer text-xs transition-colors p-1"
            >
              ✕ Dismiss
            </button>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words font-sans selection:bg-blue-500/30 selection:text-white">
          {streamedText}
        </div>
      </Card>
    </div>
  );
};
