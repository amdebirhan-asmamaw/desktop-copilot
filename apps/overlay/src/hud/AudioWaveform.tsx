import React, { useEffect, useState } from 'react';

interface AudioWaveformProps {
  active: boolean;
  levels?: number[];
  className?: string;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({ active, levels: externalLevels, className = '' }) => {
  const [internalLevels, setInternalLevels] = useState<number[]>([2, 2, 2, 2, 2, 2]);

  useEffect(() => {
    if (!active) {
      setInternalLevels([2, 2, 2, 2, 2, 2]);
      return;
    }

    if (externalLevels && externalLevels.length >= 6) {
      setInternalLevels(externalLevels.slice(0, 6).map((v) => Math.max(2, Math.min(16, Math.round(v * 16)))));
      return;
    }

    // Subscribe to IPC audio level events if available
    const api = (window as unknown as { copilotApi?: { onAudioLevels?: (cb: (levels: number[]) => void) => () => void } }).copilotApi;
    const unsub = api?.onAudioLevels?.((levels) => {
      if (levels && levels.length >= 6) {
        setInternalLevels(levels.slice(0, 6).map((v) => Math.max(2, Math.min(16, Math.round(v * 16)))));
      }
    });

    return () => unsub?.();
  }, [active, externalLevels]);

  const isSpeaking = active && internalLevels.some((l) => l > 3);

  return (
    <div
      className={`flex items-center gap-[2.5px] px-1.5 py-1 rounded-lg bg-slate-900/60 border transition-all ${
        isSpeaking ? 'border-emerald-500/40 shadow-sm shadow-emerald-500/20' : 'border-slate-800/60'
      } ${className}`}
      title={active ? (isSpeaking ? 'Voice Detected (Listening)' : 'Microphone Ready (Silent)') : 'Microphone Paused'}
    >
      {internalLevels.map((lvl, idx) => (
        <span
          key={idx}
          className={`w-[2.5px] rounded-full transition-all duration-75 ${
            active
              ? isSpeaking
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                : 'bg-emerald-500/40'
              : 'bg-slate-600'
          }`}
          style={{ height: `${lvl}px` }}
        />
      ))}
    </div>
  );
};
