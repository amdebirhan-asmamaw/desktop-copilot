import React, { useState, useEffect } from 'react';
import { Button, Card, Dialog } from '@repo/ui';
import { AudioWaveform } from './AudioWaveform';
import { MarkdownRenderer } from '../ghost/MarkdownRenderer';
import { MicIcon, ScreenIcon, DropletIcon, EyeIcon, GearIcon, SparklesIcon, StopIcon, RetryIcon, CloseIcon, MinimizeIcon } from './Icons';

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
  onAdjustOpacity?: (cb: (delta: number) => void) => () => void;
  setWindowOpacity?: (opacity: number) => Promise<void>;
  toggleVisibility?: () => Promise<void>;
  retryQuestion?: (question?: string) => Promise<void>;
  onAudioLevels?: (cb: (levels: number[]) => void) => () => void;
  feedAudioPcm?: (source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void;
  getSystemAudioSourceId?: () => Promise<string | null>;
  quitApp?: () => Promise<void>;
  minimizeApp?: () => Promise<void>;
  onGhostStreamStart?: (cb: (data: { requestId: string; question: string; isDemo?: boolean }) => void) => () => void;
  onGhostStreamChunk?: (cb: (data: { requestId: string; text: string }) => void) => () => void;
  onGhostStreamEnd?: (cb: (data: { requestId: string; fullAnswer?: string }) => void) => () => void;
  onGhostStreamError?: (cb: (data: { requestId: string; question?: string; error: { code: string; message: string } }) => void) => () => void;
}

function downsamplePcm(input: Float32Array, fromRate: number, toRate: number = 16000): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const newLen = Math.round(input.length / ratio);
  const output = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = Math.min(Math.floor(i * ratio), input.length - 1);
    output[i] = input[idx]!;
  }
  return output;
}

function setupStreamProcessor(
  stream: MediaStream,
  source: 'MICROPHONE' | 'SYSTEM_LOOPBACK',
  feedPcm: (src: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void
): () => void {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioContextClass({ sampleRate: 16000 });
    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);

    scriptProcessor.onaudioprocess = (e) => {
      const raw = e.inputBuffer.getChannelData(0);
      const pcm = audioCtx.sampleRate !== 16000 ? downsamplePcm(raw, audioCtx.sampleRate, 16000) : new Float32Array(raw);
      feedPcm(source, pcm);
    };

    sourceNode.connect(scriptProcessor);
    scriptProcessor.connect(audioCtx.destination);

    return () => {
      try {
        scriptProcessor.disconnect();
        sourceNode.disconnect();
        audioCtx.close();
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  } catch (err) {
    console.warn('[FloatingHud] Failed to initialize AudioContext processor:', err);
    return () => {
      stream.getTracks().forEach((t) => t.stop());
    };
  }
}

async function startMicrophoneCapture(
  feedPcm: (src: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void
): Promise<(() => void) | null> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    return setupStreamProcessor(stream, 'MICROPHONE', feedPcm);
  } catch (err) {
    console.warn('[FloatingHud] Microphone capture unavailable:', err);
    return null;
  }
}

async function startSystemAudioCapture(
  api: CopilotApiBridge,
  feedPcm: (src: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void
): Promise<(() => void) | null> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    const sourceId = await api.getSystemAudioSourceId?.();
    if (!sourceId) return null;

    // Electron desktop loopback audio capture
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      } as unknown as MediaTrackConstraints,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: 1
        }
      } as unknown as MediaTrackConstraints
    });

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }

    return setupStreamProcessor(stream, 'SYSTEM_LOOPBACK', feedPcm);
  } catch (err) {
    console.warn('[FloatingHud] System loopback audio capture unavailable:', err);
    return null;
  }
}

export const FloatingHud: React.FC = () => {
  const [mode, setMode] = useState<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>('PASSIVE');
  const [micActive, setMicActive] = useState<boolean>(true);
  const [screenActive, setScreenActive] = useState<boolean>(true);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showOpacitySlider, setShowOpacitySlider] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [roleInput, setRoleInput] = useState<string>('Senior Distributed Systems Architect');
  const [instructionsInput, setInstructionsInput] = useState<string>('Deliver a spoken-ready conversational sentence opening with 5-7 concrete technical terms, followed by 2-3 key trade-off bullet points. Zero conversational filler.');
  const [quickPrompt, setQuickPrompt] = useState<string>('');
  const [providerInfo, setProviderInfo] = useState<{ provider: string; model: string; isDemo: boolean } | null>(null);
  const [latestTranscript, setLatestTranscript] = useState<{ speaker: string; text: string; isFinal: boolean } | null>(null);

  // Unified Answer & Stream State
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [streamedText, setStreamedText] = useState<string>('');
  const [answerStatus, setAnswerStatus] = useState<'IDLE' | 'STREAMING' | 'COMPLETED' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<{ code: string; message: string } | null>(null);
  const [cardOpacity, setCardOpacity] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('desktop_copilot_opacity') : null;
    const parsed = saved ? parseFloat(saved) : 0.95;
    return Math.max(0.70, Math.min(1.0, isNaN(parsed) ? 0.95 : parsed));
  });
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
        text: data.text,
        isFinal: data.isFinal
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
      if (data.question) {
        setCurrentQuestion(data.question);
      }
    });

    api.getProviderStatus?.().then((info) => {
      if (info) setProviderInfo(info);
    });

    const unsubOpacity = api.onAdjustOpacity?.((delta) => {
      setCardOpacity((prev) => {
        const next = Math.max(0.70, Math.min(1.0, Math.round((prev + delta) * 100) / 100));
        localStorage.setItem('desktop_copilot_opacity', String(next));
        api.setWindowOpacity?.(next);
        return next;
      });
    });

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (e.key === '[' || e.key === '{') {
          e.preventDefault();
          setCardOpacity((prev) => {
            const next = Math.max(0.70, Math.min(1.0, Math.round((prev - 0.05) * 100) / 100));
            localStorage.setItem('desktop_copilot_opacity', String(next));
            api.setWindowOpacity?.(next);
            return next;
          });
        } else if (e.key === ']' || e.key === '}') {
          e.preventDefault();
          setCardOpacity((prev) => {
            const next = Math.max(0.70, Math.min(1.0, Math.round((prev + 0.05) * 100) / 100));
            localStorage.setItem('desktop_copilot_opacity', String(next));
            api.setWindowOpacity?.(next);
            return next;
          });
        } else if (e.key.toLowerCase() === 'h') {
          e.preventDefault();
          api.toggleVisibility?.();
        }
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);

    return () => {
      unsubMode?.();
      unsubTranscript?.();
      unsubStart?.();
      unsubChunk?.();
      unsubEnd?.();
      unsubError?.();
      unsubOpacity?.();
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, []);

  // Real Microphone Stream Capture
  useEffect(() => {
    if (!micActive) return;
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (!api?.feedAudioPcm) return;

    let cleanupFn: (() => void) | null = null;
    let isCancelled = false;

    startMicrophoneCapture((source, pcm) => {
      api.feedAudioPcm?.(source, pcm);
    }).then((cleanup) => {
      if (isCancelled) {
        cleanup?.();
      } else {
        cleanupFn = cleanup;
      }
    });

    return () => {
      isCancelled = true;
      cleanupFn?.();
    };
  }, [micActive]);

  // Real System Audio Loopback Capture
  useEffect(() => {
    if (!screenActive) return;
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (!api?.feedAudioPcm || !api?.getSystemAudioSourceId) return;

    let cleanupFn: (() => void) | null = null;
    let isCancelled = false;

    startSystemAudioCapture(api, (source, pcm) => {
      api.feedAudioPcm?.(source, pcm);
    }).then((cleanup) => {
      if (isCancelled) {
        cleanup?.();
      } else {
        cleanupFn = cleanup;
      }
    });

    return () => {
      isCancelled = true;
      cleanupFn?.();
    };
  }, [screenActive]);

  const updateOpacity = (val: number) => {
    const clamped = Math.max(0.70, Math.min(1.0, Math.round(val * 100) / 100));
    setCardOpacity(clamped);
    localStorage.setItem('desktop_copilot_opacity', String(clamped));
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    api?.setWindowOpacity?.(clamped);
  };

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

  const handleRetry = async () => {
    if (!currentQuestion) return;
    setAnswerStatus('STREAMING');
    setErrorMessage(null);
    setStreamedText('');
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (api?.retryQuestion) {
      await api.retryQuestion(currentQuestion);
    } else if (api?.feedTranscript) {
      await api.feedTranscript({
        speaker: 'REMOTE_SPEAKER',
        text: currentQuestion,
        isFinal: true
      });
    }
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
            {/* Segmented Media Controls (Mic & Screen) - Icons Only */}
            <div className="flex items-center bg-slate-900/70 p-0.5 rounded-lg border border-white/10 gap-0.5 shadow-inner">
              <button
                type="button"
                onClick={() => setMicActive(!micActive)}
                className={`h-7 w-7 rounded-md transition-all flex items-center justify-center select-none ${
                  micActive
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-sm shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
                aria-label={micActive ? 'Mute microphone' : 'Unmute microphone'}
                title={micActive ? 'Microphone Active (Click to mute)' : 'Microphone Muted (Click to unmute)'}
              >
                <MicIcon active={micActive} className="w-3.5 h-3.5 transition-transform active:scale-90" />
              </button>

              <button
                type="button"
                onClick={() => setScreenActive(!screenActive)}
                className={`h-7 w-7 rounded-md transition-all flex items-center justify-center select-none ${
                  screenActive
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40 shadow-sm shadow-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
                aria-label={screenActive ? 'Pause screen capture' : 'Resume screen capture'}
                title={screenActive ? 'Screen Capture Active (Click to pause)' : 'Screen Capture Paused (Click to resume)'}
              >
                <ScreenIcon active={screenActive} className="w-3.5 h-3.5 transition-transform active:scale-90" />
              </button>
            </div>

            {/* Transparency Controller Pill */}
            <div className="relative flex items-center bg-slate-900/60 p-0.5 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setShowOpacitySlider(!showOpacitySlider)}
                className="h-7 px-2 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 text-slate-300 hover:text-white hover:bg-white/10 select-none"
                title="Adjust Transparency (Ctrl+Shift+[ to dim, Ctrl+Shift+] to brighten)"
              >
                <DropletIcon className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-[10px] font-mono font-semibold">{Math.round(cardOpacity * 100)}%</span>
              </button>

              {showOpacitySlider && (
                <div
                  className="absolute top-8 right-0 z-50 bg-slate-950/95 border border-white/15 p-2.5 rounded-xl shadow-2xl backdrop-blur-2xl flex flex-col gap-2 min-w-[170px] app-no-drag"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-300 font-medium">
                    <span>Opacity</span>
                    <span className="font-mono text-sky-400 font-bold">{Math.round(cardOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.70"
                    max="1"
                    step="0.05"
                    value={cardOpacity}
                    onChange={(e) => updateOpacity(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg cursor-pointer accent-sky-400"
                  />
                  <div className="flex items-center justify-between gap-1 text-[9px] text-slate-400">
                    <button
                      type="button"
                      onClick={() => updateOpacity(0.70)}
                      className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      70%
                    </button>
                    <button
                      type="button"
                      onClick={() => updateOpacity(0.85)}
                      className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      85%
                    </button>
                    <button
                      type="button"
                      onClick={() => updateOpacity(1.0)}
                      className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      Solid
                    </button>
                  </div>
                  <div className="text-[8.5px] text-slate-400 border-t border-white/10 pt-1 flex items-center justify-between">
                    <span>Hotkeys:</span>
                    <span className="font-mono text-slate-300">Ctrl+Shift+[ / ]</span>
                  </div>
                </div>
              )}
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
              className="h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-amber-500/20 to-amber-600/20 hover:from-amber-500/30 hover:to-amber-600/30 text-amber-300 border border-amber-400/40 shadow-sm shadow-amber-500/10 transition-all flex items-center gap-1.5 select-none"
              title="Simulate incoming interviewer question"
            >
              <SparklesIcon className="w-3.5 h-3.5 text-amber-300" />
              <span>Demo Q&A</span>
            </button>

            {/* Cancel/Stop Streaming Button (Only when streaming) */}
            {answerStatus === 'STREAMING' && (
              <button
                type="button"
                onClick={handleCancelActive}
                className="h-7 px-2 rounded-lg text-[11px] font-medium bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-400/40 transition-all flex items-center gap-1.5 animate-pulse select-none"
                title="Cancel current generation"
              >
                <StopIcon className="w-3 h-3 text-rose-300" />
                <span>Stop</span>
              </button>
            )}

            {/* Hide Overlay Button */}
            <button
              type="button"
              onClick={async () => {
                const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
                await api?.toggleVisibility?.();
              }}
              className="h-7 px-2 rounded-lg text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center gap-1.5 text-xs select-none"
              title="Hide Overlay (Ctrl+Shift+H) - Press Ctrl+Shift+H anywhere to bring it back"
            >
              <EyeIcon className="w-3.5 h-3.5 text-slate-300" />
              <kbd className="text-[8.5px] font-mono text-slate-400 bg-black/40 px-1 py-0.2 rounded border border-white/10">
                Ctrl+Shift+H
              </kbd>
            </button>

            {/* Settings Context Button */}
            <button
              type="button"
              onClick={() => setShowConfigModal(true)}
              className="h-7 w-7 rounded-lg text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center justify-center text-xs select-none"
              title="Session Persona & Context"
            >
              <GearIcon className="w-3.5 h-3.5 text-slate-300" />
            </button>

            {/* Window Controls: Minimize & Close */}
            <div className="flex items-center gap-1 pl-1 ml-0.5 border-l border-white/10">
              <button
                type="button"
                onClick={async () => {
                  const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
                  await api?.minimizeApp?.();
                }}
                className="h-7 w-7 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 border border-transparent hover:border-white/10 transition-all flex items-center justify-center select-none"
                title="Minimize / Hide to System Tray (Ctrl+Shift+H)"
              >
                <MinimizeIcon className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={async () => {
                  const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
                  await api?.quitApp?.();
                }}
                className="h-7 w-7 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/20 hover:border-rose-400/40 border border-transparent transition-all flex items-center justify-center select-none"
                title="Exit Desktop Copilot"
              >
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            </div>
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
              className={`max-w-[260px] truncate text-[10px] px-2.5 py-1.5 rounded-lg border select-none flex items-center gap-1.5 transition-all ${
                latestTranscript.isFinal
                  ? 'text-slate-200 bg-white/10 border-white/15'
                  : 'text-slate-300 bg-sky-500/10 border-sky-400/30 italic'
              }`}
              title={`${latestTranscript.speaker}: ${latestTranscript.text}`}
            >
              <span className={`font-semibold shrink-0 ${latestTranscript.speaker === 'Interviewer' ? 'text-sky-400' : 'text-emerald-400'}`}>
                {latestTranscript.speaker}:
              </span>
              <span className="truncate">{latestTranscript.text}</span>
              {!latestTranscript.isFinal && (
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse shrink-0"></span>
              )}
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
                      min="0.70"
                      max="1"
                      step="0.05"
                      value={cardOpacity}
                      onChange={(e) => updateOpacity(parseFloat(e.target.value))}
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

              {/* Error Banner with Retry Action */}
              {answerStatus === 'ERROR' && errorMessage && (
                <div className="p-3.5 rounded-xl bg-gradient-to-br from-rose-950/80 via-slate-950/90 to-slate-900/90 border border-rose-500/40 text-rose-200 text-xs shadow-xl flex flex-col gap-2.5 backdrop-blur-md">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-rose-300 flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                      </span>
                      <span className="text-[11px] font-mono uppercase tracking-wide">{errorMessage.code}</span>
                    </div>
                    {currentQuestion && (
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 hover:text-white border border-rose-400/40 font-medium text-[11px] transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer select-none"
                        title="Retry answering this question"
                      >
                        <RetryIcon className="w-3.5 h-3.5 text-rose-300" />
                        <span>Retry Question</span>
                      </button>
                    )}
                  </div>
                  <div className="text-[11.5px] leading-relaxed text-rose-200/90 break-words">{errorMessage.message}</div>
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
