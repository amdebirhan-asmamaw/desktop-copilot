import React, { useState, useEffect, useRef } from 'react';
import { Button, Card, Dialog } from '@repo/ui';
import { AudioWaveform } from './AudioWaveform';
import { MarkdownRenderer } from '../ghost/MarkdownRenderer';
import { MicIcon, ScreenIcon, DropletIcon, EyeIcon, GearIcon, StopIcon, RetryIcon, CloseIcon, MinimizeIcon, PlusIcon, HistoryIcon } from './Icons';
import { AudioDiagnosticPill, ChannelTelemetry } from './AudioDiagnosticPill';

export interface SessionConversationItem {
  id: string;
  timestamp: number;
  question: string;
  answer: string;
  status: 'STREAMING' | 'COMPLETED' | 'ERROR';
  error?: { code: string; message: string } | null;
}

export interface StoredTranscriptTurn {
  id: string;
  speaker: 'USER' | 'REMOTE_SPEAKER' | 'ASSISTANT';
  timestamp: number;
  text: string;
}

export interface StoredContextSession {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  initialContext?: {
    roleOrPersona?: string;
    instructions?: string;
  };
  transcripts?: StoredTranscriptTurn[];
}

function parseTranscriptsToConversations(transcripts: StoredTranscriptTurn[]): SessionConversationItem[] {
  const items: SessionConversationItem[] = [];
  let pendingQuestion: StoredTranscriptTurn | null = null;

  for (const turn of transcripts) {
    if (turn.speaker === 'REMOTE_SPEAKER' || turn.speaker === 'USER') {
      if (pendingQuestion) {
        items.push({
          id: pendingQuestion.id,
          timestamp: pendingQuestion.timestamp,
          question: pendingQuestion.text,
          answer: '',
          status: 'COMPLETED'
        });
      }
      pendingQuestion = turn;
    } else if (turn.speaker === 'ASSISTANT') {
      if (pendingQuestion) {
        items.push({
          id: pendingQuestion.id,
          timestamp: pendingQuestion.timestamp,
          question: pendingQuestion.text,
          answer: turn.text,
          status: 'COMPLETED'
        });
        pendingQuestion = null;
      } else {
        items.push({
          id: turn.id,
          timestamp: turn.timestamp,
          question: 'AI Guidance',
          answer: turn.text,
          status: 'COMPLETED'
        });
      }
    }
  }

  if (pendingQuestion) {
    items.push({
      id: pendingQuestion.id,
      timestamp: pendingQuestion.timestamp,
      question: pendingQuestion.text,
      answer: '',
      status: 'COMPLETED'
    });
  }

  return items;
}

interface CopilotApiBridge {
  onOverlayModeChanged?: (cb: (m: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void;
  setOverlayMode?: (m: string) => Promise<void>;
  createSession?: (ctx: unknown) => Promise<unknown>;
  getSession?: (sessionId?: string) => Promise<unknown>;
  listSessions?: () => Promise<StoredContextSession[]>;
  switchSession?: (sessionId: string) => Promise<unknown>;
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
  onAudioTelemetry?: (cb: (telemetry: { remote: ChannelTelemetry; mic: ChannelTelemetry }) => void) => () => void;
  feedAudioPcm?: (source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void;
  reportAudioHealth?: (source: 'MICROPHONE' | 'SYSTEM_LOOPBACK', health: 'CONNECTED' | 'NO_AUDIO_TRACK' | 'PERMISSION_DENIED' | 'STALLED') => void;
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
  feedPcm: (src: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void,
  api?: CopilotApiBridge
): () => void {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // Construct default AudioContext; avoid forcing sampleRate which can fail on certain Windows drivers
    const audioCtx = new AudioContextClass();

    const resumeContext = () => {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
          console.log(`[AudioCapture:${source}] AudioContext resumed (state: ${audioCtx.state}, sampleRate: ${audioCtx.sampleRate})`);
        }).catch((err) => {
          console.warn(`[AudioCapture:${source}] AudioContext resume failed:`, err);
        });
      }
    };

    resumeContext();
    audioCtx.onstatechange = () => {
      console.log(`[AudioCapture:${source}] AudioContext state changed: ${audioCtx.state}`);
      if (audioCtx.state === 'suspended') resumeContext();
    };

    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);

    let frameCount = 0;
    let nonZeroCount = 0;
    let peakRms = 0;

    scriptProcessor.onaudioprocess = (e) => {
      if (audioCtx.state === 'suspended') resumeContext();

      const raw = e.inputBuffer.getChannelData(0);
      const pcm = audioCtx.sampleRate !== 16000 ? downsamplePcm(raw, audioCtx.sampleRate, 16000) : new Float32Array(raw);

      let sumSq = 0;
      for (let i = 0; i < pcm.length; i++) {
        const val = pcm[i] ?? 0;
        sumSq += val * val;
      }
      const chunkRms = Math.sqrt(sumSq / (pcm.length || 1));
      frameCount++;
      if (chunkRms > peakRms) peakRms = chunkRms;
      if (chunkRms > 0.001) nonZeroCount++;

      if (frameCount % 60 === 0 && nonZeroCount > 0) {
        console.log(`[AudioCapture:${source}] Frames: ${frameCount}, non-zero: ${nonZeroCount}, peak RMS: ${peakRms.toFixed(4)}, current RMS: ${chunkRms.toFixed(4)}`);
      }

      feedPcm(source, pcm);
    };

    // Route through a zero-gain node so the audio is processed by Web Audio without playing out of speakers
    const muteGain = audioCtx.createGain();
    muteGain.gain.value = 0;
    sourceNode.connect(scriptProcessor);
    scriptProcessor.connect(muteGain);
    muteGain.connect(audioCtx.destination);

    api?.reportAudioHealth?.(source, 'CONNECTED');

    return () => {
      try {
        scriptProcessor.disconnect();
        muteGain.disconnect();
        sourceNode.disconnect();
        audioCtx.close();
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  } catch (err) {
    console.warn(`[FloatingHud] Failed to initialize AudioContext processor for ${source}:`, err);
    api?.reportAudioHealth?.(source, 'NO_AUDIO_TRACK');
    return () => {
      stream.getTracks().forEach((t) => t.stop());
    };
  }
}

async function startMicrophoneCapture(
  api: CopilotApiBridge | undefined,
  feedPcm: (src: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void
): Promise<(() => void) | null> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn('[FloatingHud] navigator.mediaDevices.getUserMedia not available');
      api?.reportAudioHealth?.('MICROPHONE', 'NO_AUDIO_TRACK');
      return null;
    }
    console.log('[FloatingHud] Requesting microphone access...');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) {
      console.warn('[FloatingHud] Microphone stream has 0 audio tracks');
      api?.reportAudioHealth?.('MICROPHONE', 'NO_AUDIO_TRACK');
      return null;
    }
    console.log(`[FloatingHud] Microphone track acquired: label="${tracks[0]!.label}", readyState="${tracks[0]!.readyState}"`);
    return setupStreamProcessor(stream, 'MICROPHONE', feedPcm, api);
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string } | null;
    console.error('[FloatingHud] Microphone capture failed:', error?.name, error?.message);
    const health = error?.name === 'NotAllowedError' ? 'PERMISSION_DENIED' : 'NO_AUDIO_TRACK';
    api?.reportAudioHealth?.('MICROPHONE', health);
    return null;
  }
}

async function startSystemAudioCapture(
  api: CopilotApiBridge,
  feedPcm: (src: 'MICROPHONE' | 'SYSTEM_LOOPBACK', pcm: Float32Array) => void
): Promise<(() => void) | null> {
  try {
    if (!navigator.mediaDevices) {
      console.warn('[FloatingHud] navigator.mediaDevices unavailable for system audio');
      api.reportAudioHealth?.('SYSTEM_LOOPBACK', 'NO_AUDIO_TRACK');
      return null;
    }

    let stream: MediaStream | null = null;
    const sourceId = await api.getSystemAudioSourceId?.();
    console.log(`[FloatingHud] Initializing system loopback capture (screen source: ${sourceId || 'none'})...`);

    // Approach 1: Electron getUserMedia with desktop audio loopback
    if (sourceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop'
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
        if (stream.getAudioTracks().length === 0) {
          console.warn('[LoopbackDiagnostic] getUserMedia desktop returned 0 audio tracks, attempting getDisplayMedia fallback');
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
        }
      } catch (e: unknown) {
        const error = e as { message?: string } | null;
        console.warn('[FloatingHud] getUserMedia desktop failed, will try getDisplayMedia:', error?.message);
        stream = null;
      }
    }

    // Approach 2: Standard getDisplayMedia fallback (supported in modern Electron sessions)
    if (!stream && navigator.mediaDevices.getDisplayMedia) {
      try {
        console.log('[FloatingHud] Attempting navigator.mediaDevices.getDisplayMedia for loopback audio...');
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true
        });
      } catch (e: unknown) {
        const error = e as { message?: string } | null;
        console.warn('[FloatingHud] getDisplayMedia loopback capture failed:', error?.message);
        stream = null;
      }
    }

    if (!stream) {
      console.warn('[FloatingHud] System loopback audio capture could not acquire stream');
      api.reportAudioHealth?.('SYSTEM_LOOPBACK', 'NO_AUDIO_TRACK');
      return null;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.warn('[LoopbackDiagnostic] Desktop loopback stream has NO audio tracks!');
      stream.getTracks().forEach((t) => t.stop());
      api.reportAudioHealth?.('SYSTEM_LOOPBACK', 'NO_AUDIO_TRACK');
      return null;
    }

    const track = audioTracks[0]!;
    console.log(`[LoopbackDiagnostic] Loopback track active: label="${track.label}", id="${track.id}", readyState="${track.readyState}"`);

    track.onended = () => {
      console.warn('[LoopbackDiagnostic] Loopback audio track ended unexpectedly!');
      api.reportAudioHealth?.('SYSTEM_LOOPBACK', 'NO_AUDIO_TRACK');
    };
    track.onmute = () => {
      console.warn('[LoopbackDiagnostic] Loopback audio track muted by system/hardware!');
      api.reportAudioHealth?.('SYSTEM_LOOPBACK', 'STALLED');
    };
    track.onunmute = () => {
      console.log('[LoopbackDiagnostic] Loopback audio track unmuted.');
      api.reportAudioHealth?.('SYSTEM_LOOPBACK', 'CONNECTED');
    };

    return setupStreamProcessor(stream, 'SYSTEM_LOOPBACK', feedPcm, api);
  } catch (err: unknown) {
    const error = err as { message?: string } | null;
    console.warn('[FloatingHud] System loopback audio capture unavailable:', error?.message);
    api.reportAudioHealth?.('SYSTEM_LOOPBACK', 'NO_AUDIO_TRACK');
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
  const [audioTelemetry, setAudioTelemetry] = useState<{ remote: ChannelTelemetry; mic: ChannelTelemetry } | null>(null);

  // Session & Multi-Conversation States
  const [conversations, setConversations] = useState<SessionConversationItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [sessionsList, setSessionsList] = useState<StoredContextSession[]>([]);
  const [showSessionsModal, setShowSessionsModal] = useState<boolean>(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const conversationScrollRef = useRef<HTMLDivElement>(null);

  const isAnyStreaming = conversations.some((c) => c.status === 'STREAMING');
  const hasActiveContent = conversations.length > 0 && !isCollapsed;

  const [cardOpacity, setCardOpacity] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('desktop_copilot_opacity') : null;
    const parsed = saved ? parseFloat(saved) : 0.95;
    return Math.max(0.70, Math.min(1.0, isNaN(parsed) ? 0.95 : parsed));
  });

  // Dynamically resize Electron HUD window so conversations or dialogs fit smoothly
  useEffect(() => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (showConfigModal || showSessionsModal) {
      api?.setHudSize?.({ width: 660, height: 480 });
    } else if (hasActiveContent) {
      api?.setHudSize?.({ width: 660, height: 580 });
    } else {
      api?.setHudSize?.({ width: 660, height: 95 });
    }
  }, [showConfigModal, showSessionsModal, hasActiveContent]);

  // Auto-scroll when new items are added or conversations change
  useEffect(() => {
    if (conversationScrollRef.current) {
      conversationScrollRef.current.scrollTop = conversationScrollRef.current.scrollHeight;
    }
  }, [conversations.length]);

  useEffect(() => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (!api) return;

    // Load initial active session & session list on mount
    api.getSession?.().then((sessUnknown) => {
      const sess = sessUnknown as StoredContextSession | null;
      if (sess) {
        setActiveSessionId(sess.sessionId);
        if (sess.transcripts && sess.transcripts.length > 0) {
          setConversations(parseTranscriptsToConversations(sess.transcripts));
        }
      }
    });

    api.listSessions?.().then((list) => {
      if (list) setSessionsList(list);
    });

    const unsubMode = api.onOverlayModeChanged?.((newMode) => setMode(newMode));

    const unsubTranscript = api.onTranscriptEvent?.((data) => {
      setLatestTranscript({
        speaker: data.speaker === 'REMOTE_SPEAKER' ? 'Interviewer' : 'You',
        text: data.text,
        isFinal: data.isFinal
      });
    });

    const unsubStart = api.onGhostStreamStart?.((data) => {
      setIsCollapsed(false);
      setCopiedAll(false);
      setConversations((prev) => {
        const existingIdx = prev.findIndex((item) => item.id === data.requestId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx]!,
            question: data.question,
            answer: '',
            status: 'STREAMING',
            error: null
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: data.requestId,
            timestamp: Date.now(),
            question: data.question,
            answer: '',
            status: 'STREAMING',
            error: null
          }
        ];
      });
    });

    const unsubChunk = api.onGhostStreamChunk?.((data) => {
      setConversations((prev) =>
        prev.map((item) =>
          item.id === data.requestId
            ? { ...item, answer: item.answer + data.text, status: 'STREAMING' }
            : item
        )
      );
    });

    const unsubEnd = api.onGhostStreamEnd?.((data) => {
      setConversations((prev) =>
        prev.map((item) =>
          item.id === data.requestId
            ? {
                ...item,
                answer: data.fullAnswer !== undefined ? data.fullAnswer : item.answer,
                status: 'COMPLETED'
              }
            : item
        )
      );
      api.listSessions?.().then((list) => {
        if (list) setSessionsList(list);
      });
    });

    const unsubError = api.onGhostStreamError?.((data) => {
      setConversations((prev) => {
        const existingIdx = prev.findIndex((item) => item.id === data.requestId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx]!,
            status: 'ERROR',
            error: data.error
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: data.requestId,
            timestamp: Date.now(),
            question: data.question || 'Question',
            answer: '',
            status: 'ERROR',
            error: data.error
          }
        ];
      });
    });

    api.getProviderStatus?.().then((info) => {
      if (info) setProviderInfo(info);
    });

    const unsubTelemetry = api.onAudioTelemetry?.((data) => {
      setAudioTelemetry(data);
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
      unsubTelemetry?.();
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

    startMicrophoneCapture(api, (source, pcm) => {
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
    if (!api?.feedAudioPcm) return;

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

  const handleCopyItem = async (item: SessionConversationItem) => {
    const fullText = `Question:\n${item.question}\n\nAnswer:\n${item.answer}`;
    const ok = await copyTextToClipboard(fullText);
    if (ok) {
      setCopiedItemId(item.id);
      setTimeout(() => setCopiedItemId(null), 2000);
    }
  };

  const handleCopyAll = async () => {
    if (conversations.length === 0) return;
    const fullText = conversations
      .map(
        (c, idx) =>
          `### Q #${idx + 1}: ${c.question}\n\n**Answer:**\n${c.answer || '(In progress...)'}`
      )
      .join('\n\n---\n\n');
    const ok = await copyTextToClipboard(fullText);
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const handleNewChat = async () => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (!api?.createSession) return;
    try {
      const newSess = (await api.createSession({
        roleOrPersona: roleInput,
        instructions: instructionsInput
      })) as StoredContextSession | null;
      if (newSess) {
        setActiveSessionId(newSess.sessionId);
        setConversations([]);
        setIsCollapsed(false);
        const list = (await api.listSessions?.()) as StoredContextSession[] | null;
        if (list) setSessionsList(list);
      }
    } catch (err) {
      console.error('[FloatingHud] Failed to create new chat session:', err);
    }
  };

  const handleOpenSessionsModal = async () => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (api?.listSessions) {
      try {
        const list = (await api.listSessions()) as StoredContextSession[] | null;
        if (list) setSessionsList(list);
      } catch (err) {
        console.warn('Failed to refresh sessions list:', err);
      }
    }
    setShowSessionsModal(true);
  };

  const handleSwitchSession = async (sessId: string) => {
    if (sessId === activeSessionId) {
      setShowSessionsModal(false);
      return;
    }
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (!api?.switchSession) return;
    try {
      const sess = (await api.switchSession(sessId)) as StoredContextSession | null;
      if (sess) {
        setActiveSessionId(sess.sessionId);
        if (sess.transcripts) {
          setConversations(parseTranscriptsToConversations(sess.transcripts));
        } else {
          setConversations([]);
        }
        setIsCollapsed(false);
        setShowSessionsModal(false);
      }
    } catch (err) {
      console.error('[FloatingHud] Failed to switch session:', err);
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
      setIsCollapsed(false);
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

  const handleRetry = async (questionToRetry?: string) => {
    const q = questionToRetry || conversations[conversations.length - 1]?.question;
    if (!q) return;
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (api?.retryQuestion) {
      await api.retryQuestion(q);
    } else if (api?.feedTranscript) {
      await api.feedTranscript({
        speaker: 'REMOTE_SPEAKER',
        text: q,
        isFinal: true
      });
    }
  };

  const handleDismissAnswer = () => {
    setIsCollapsed(true);
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

            {/* Live Dual-Stream Audio Diagnostic Pill */}
            <AudioDiagnosticPill telemetry={audioTelemetry} />
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

            {/* Cancel/Stop Streaming Button (Only when streaming) */}
            {isAnyStreaming && (
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

        {/* Second Row: Session Controls + Prompt Input Bar + Interviewer Ticker */}
        <div
          className="flex items-center gap-2 pt-2 border-t border-white/10 app-no-drag"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Action Button 1: Start New Chat Session */}
          <button
            type="button"
            onClick={handleNewChat}
            className="h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 active:scale-95 text-sky-200 border border-sky-400/30 transition-all flex items-center gap-1.5 shadow-sm select-none shrink-0"
            title="Start a new chat session with its own conversation history"
          >
            <PlusIcon className="w-3.5 h-3.5 text-sky-300" />
            <span>New Chat</span>
          </button>

          {/* Action Button 2: Sessions List & Switcher */}
          <button
            type="button"
            onClick={handleOpenSessionsModal}
            className="h-7 px-2.5 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/10 active:scale-95 text-slate-300 hover:text-white border border-white/10 transition-all flex items-center gap-1.5 select-none shrink-0"
            title="View and switch between chat sessions"
          >
            <HistoryIcon className="w-3.5 h-3.5 text-slate-300" />
            <span>Sessions{sessionsList.length > 0 ? ` (${sessionsList.length})` : ''}</span>
          </button>

          {/* Prompt input */}
          <div className="flex-1 min-w-[140px]">
            <input
              type="text"
              value={quickPrompt}
              onChange={(e) => setQuickPrompt(e.target.value)}
              onKeyDown={handleQuickPromptSubmit}
              placeholder="Ask question & press Enter..."
              className="w-full text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-400/80 focus:bg-white/10 transition-all"
            />
          </div>

          {/* Interviewer Live Transcript Ticker */}
          {latestTranscript && (
            <div
              className={`max-w-[220px] truncate text-[10px] px-2.5 py-1.5 rounded-lg border select-none flex items-center gap-1.5 transition-all shrink-0 ${
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

          {/* Re-expand button when collapsed */}
          {conversations.length > 0 && isCollapsed && (
            <button
              type="button"
              onClick={() => setIsCollapsed(false)}
              className="h-7 px-2 rounded-lg text-[10px] font-medium bg-sky-500/20 text-sky-300 border border-sky-400/30 hover:bg-sky-500/30 transition-all select-none shrink-0"
              title="Show chat conversation history"
            >
              Show Chat ({conversations.length})
            </button>
          )}
        </div>

        {/* Unified Session Conversations Feed (Displays when active) */}
        {conversations.length > 0 && !isCollapsed && (
          <div
            className="mt-2.5 pt-2 border-t border-white/15 app-no-drag flex flex-col space-y-2.5"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {/* Header of Response Section */}
            <div className="flex items-center justify-between text-xs pb-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold tracking-wider uppercase text-sky-400 flex items-center gap-1.5">
                  {isAnyStreaming && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                    </span>
                  )}
                  ⚡ Session Conversation ({conversations.length} {conversations.length === 1 ? 'Turn' : 'Turns'})
                </span>

                <span className="text-[9.5px] text-slate-400 select-none">
                  {mode === 'INTERACTIVE' ? 'Scroll up for turn 1' : '100% Click-through'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {mode === 'INTERACTIVE' && (
                  <button
                    type="button"
                    onClick={handleCopyAll}
                    className="app-no-drag text-[10px] h-6 px-2.5 rounded-md font-medium transition-all bg-white/5 hover:bg-white/15 border border-white/15 text-slate-200 flex items-center gap-1 select-none"
                    title="Copy entire session conversation to clipboard"
                  >
                    {copiedAll ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">✓ Copied All!</span>
                    ) : (
                      <span>📋 Copy Session</span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsCollapsed(true)}
                  className="app-no-drag text-slate-400 hover:text-white cursor-pointer text-xs p-1 rounded-md hover:bg-white/10 transition-colors select-none"
                  title="Collapse conversation feed"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Vertically Scrollable Container: allows user to scroll all the way up to turn 1 */}
            <div
              ref={conversationScrollRef}
              className="max-h-[50vh] overflow-y-auto pr-1.5 space-y-3 custom-scrollbar select-text cursor-text"
            >
              {conversations.map((item, idx) => (
                <div
                  key={item.id}
                  className="bg-slate-900/60 border border-white/10 rounded-xl p-3 flex flex-col space-y-2 transition-all shadow-md"
                >
                  {/* Turn Header */}
                  <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/30">
                        Q #{idx + 1}
                      </span>
                      <span className="text-[9.5px] text-slate-400 font-mono">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      {item.status === 'STREAMING' && (
                        <span className="text-[10px] text-sky-400 animate-pulse font-medium flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-sky-400"></span>
                          Streaming...
                        </span>
                      )}
                      {item.status === 'COMPLETED' && (
                        <span className="text-[10px] text-emerald-400/80 font-medium flex items-center gap-1">
                          ✓ Ready
                        </span>
                      )}
                    </div>

                    {mode === 'INTERACTIVE' && item.answer && (
                      <button
                        type="button"
                        onClick={() => handleCopyItem(item)}
                        className="text-[9.5px] h-5 px-2 rounded font-medium bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all flex items-center gap-1 border border-white/10 select-none"
                        title="Copy this Q&A pair"
                      >
                        {copiedItemId === item.id ? (
                          <span className="text-emerald-400 font-semibold">✓ Copied</span>
                        ) : (
                          <span>📋 Copy</span>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Question */}
                  <div className="bg-slate-950/60 border border-white/10 rounded-lg p-2.5">
                    <div className="text-[9.5px] font-bold uppercase tracking-wider text-sky-400 mb-1">
                      Question
                    </div>
                    <p className="text-xs text-slate-100 font-medium leading-relaxed break-words">
                      {item.question}
                    </p>
                  </div>

                  {/* Error State */}
                  {item.status === 'ERROR' && item.error && (
                    <div className="p-3 rounded-lg bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs flex flex-col gap-2 shadow-inner">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-rose-300 font-semibold">{item.error.code}</span>
                        <button
                          type="button"
                          onClick={() => handleRetry(item.question)}
                          className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 text-[10px] font-medium border border-rose-400/40 transition-all flex items-center gap-1 active:scale-95 select-none"
                        >
                          <RetryIcon className="w-3 h-3 text-rose-300" />
                          <span>Retry</span>
                        </button>
                      </div>
                      <div className="text-[11px] leading-relaxed break-words">{item.error.message}</div>
                    </div>
                  )}

                  {/* Streaming In-Progress Placeholder */}
                  {item.status === 'STREAMING' && !item.answer && (
                    <div className="bg-sky-950/30 border border-sky-500/20 rounded-lg p-2.5 flex items-center gap-2 text-xs text-sky-200">
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400"></span>
                      </span>
                      <span className="font-medium animate-pulse text-[11px] text-sky-300">
                        Analyzing question & generating key points...
                      </span>
                    </div>
                  )}

                  {/* Answer */}
                  {item.answer && (
                    <div className="bg-slate-950/50 border border-white/10 rounded-lg p-3">
                      <div className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-400 mb-1.5">
                        Answer
                      </div>
                      <div className="text-[13px] leading-relaxed font-sans text-slate-100 selection:bg-sky-500/30 selection:text-white select-text cursor-text">
                        <MarkdownRenderer content={item.answer} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
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

      {/* Sessions List Modal Dialog */}
      <Dialog
        open={showSessionsModal}
        onOpenChange={setShowSessionsModal}
        title="📜 Chat Sessions"
        description="Switch between previous conversations or start a new chat session."
      >
        <div
          className="space-y-3 app-no-drag"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick Action: Start New Chat */}
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs text-slate-300 font-medium">
              Total Sessions: <span className="font-mono text-sky-400 font-bold">{sessionsList.length}</span>
            </span>
            <Button
              variant="emerald"
              size="sm"
              type="button"
              onClick={() => {
                setShowSessionsModal(false);
                handleNewChat();
              }}
              className="text-xs font-semibold h-7 px-3 bg-emerald-600/80 hover:bg-emerald-500 text-white flex items-center gap-1.5 border border-emerald-400/30"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </Button>
          </div>

          {/* List of Sessions */}
          <div className="max-h-[280px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {sessionsList.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                No past sessions found. Start a new chat!
              </div>
            ) : (
              sessionsList.map((s) => {
                const isActive = s.sessionId === activeSessionId;
                const transcriptCount = s.transcripts?.length || 0;
                const firstQuestion = s.transcripts?.find(
                  (t) => t.speaker === 'REMOTE_SPEAKER' || t.speaker === 'USER'
                )?.text;

                return (
                  <div
                    key={s.sessionId}
                    onClick={() => handleSwitchSession(s.sessionId)}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 ${
                      isActive
                        ? 'bg-sky-500/15 border-sky-400/50 shadow-sm shadow-sky-500/10'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-slate-200">
                          {s.sessionId}
                        </span>
                        {isActive && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(s.updatedAt || s.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>

                    {firstQuestion ? (
                      <p className="text-[11px] text-slate-300 truncate italic">
                        "{firstQuestion}"
                      </p>
                    ) : (
                      <p className="text-[10.5px] text-slate-500 italic">
                        Empty session (No questions yet)
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 border-t border-white/5">
                      <span>{transcriptCount} turn{transcriptCount === 1 ? '' : 's'} recorded</span>
                      {!isActive && (
                        <span className="text-sky-400 hover:underline font-medium text-[10.5px]">
                          Open Session →
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-white/10">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setShowSessionsModal(false)}
              className="text-xs text-slate-300 hover:text-white hover:bg-white/10 h-7 px-3 border border-white/10"
            >
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};
