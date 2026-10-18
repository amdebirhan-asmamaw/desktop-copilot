import React, { useEffect, useState } from 'react';

interface AudioWaveformProps {
  active: boolean;
  className?: string;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({ active, className = '' }) => {
  const [levels, setLevels] = useState<number[]>([4, 6, 8, 5, 7, 4]);

  useEffect(() => {
    if (!active) {
      setLevels([2, 2, 2, 2, 2, 2]);
      return;
    }

    const interval = setInterval(() => {
      setLevels((prev) =>
        prev.map(() => Math.floor(Math.random() * 12) + 3)
      );
    }, 90);

    return () => clearInterval(interval);
  }, [active]);

  return (
    <div
      className={`flex items-center gap-[2.5px] px-1.5 py-1 rounded bg-slate-900/60 border border-slate-700/50 ${className}`}
      title={active ? 'Microphone Active' : 'Microphone Muted'}
    >
      {levels.map((lvl, idx) => (
        <span
          key={idx}
          className={`w-[2.5px] rounded-full transition-all duration-75 ${
            active
              ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
              : 'bg-slate-600'
          }`}
          style={{ height: `${lvl}px` }}
        />
      ))}
    </div>
  );
};
