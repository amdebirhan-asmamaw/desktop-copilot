import React, { useState } from 'react';

export interface ChannelTelemetry {
  source: 'MICROPHONE' | 'SYSTEM_LOOPBACK';
  health: 'CONNECTED' | 'NO_AUDIO_TRACK' | 'STALLED' | 'PERMISSION_DENIED';
  currentRms: number;
  peakRms: number;
  totalFrames: number;
  nonZeroFrames: number;
  lastSignalTimestampMs: number;
  speechState: 'SPEAKING' | 'IDLE';
  transcriptionState: 'IDLE' | 'TRANSCRIBING' | 'ERROR';
}

export interface AudioDiagnosticPillProps {
  telemetry: {
    remote: ChannelTelemetry;
    mic: ChannelTelemetry;
  } | null;
}

export const AudioDiagnosticPill: React.FC<AudioDiagnosticPillProps> = ({ telemetry }) => {
  const [showDetails, setShowDetails] = useState(false);

  const remote = telemetry?.remote;
  const mic = telemetry?.mic;

  const remoteRms = remote?.currentRms ?? 0;
  const micRms = mic?.currentRms ?? 0;

  // Compute 0-4 bar heights based on RMS
  const getBars = (rms: number, isRemote: boolean) => {
    const threshold = isRemote ? 0.005 : 0.025;
    const clamped = Math.min(1, Math.max(0, rms / (threshold * 6)));
    return Math.min(4, Math.ceil(clamped * 4));
  };

  const remoteBars = getBars(remoteRms, true);
  const micBars = getBars(micRms, false);

  const getHealthColor = (health?: string) => {
    switch (health) {
      case 'CONNECTED':
        return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]';
      case 'NO_AUDIO_TRACK':
      case 'PERMISSION_DENIED':
        return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]';
      case 'STALLED':
        return 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]';
      default:
        return 'bg-slate-500';
    }
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2.5 px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-700/60 hover:border-slate-500/80 backdrop-blur-md transition-all shadow-inner text-xs font-mono select-none"
        title="Click to toggle detailed audio stream diagnostics"
      >
        {/* Remote / Meeting Stream */}
        <div className="flex items-center gap-1.5" title={`Meeting Stream: ${remote?.health || 'Unknown'} (RMS: ${remoteRms.toFixed(3)})`}>
          <span className={`w-1.5 h-1.5 rounded-full ${getHealthColor(remote?.health)}`} />
          <span className="text-[10px] font-semibold text-cyan-400 tracking-wider">MEET</span>
          <div className="flex items-end gap-0.5 h-2.5 w-3.5">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={`remote-bar-${i}`}
                className={`w-0.5 rounded-sm transition-all duration-75 ${
                  i <= remoteBars
                    ? remote?.speechState === 'SPEAKING'
                      ? 'bg-cyan-300 shadow-[0_0_4px_rgba(34,211,238,0.8)]'
                      : 'bg-cyan-500'
                    : 'bg-slate-700'
                }`}
                style={{ height: `${i * 25}%` }}
              />
            ))}
          </div>
        </div>

        <span className="text-slate-600">|</span>

        {/* Microphone Stream */}
        <div className="flex items-center gap-1.5" title={`Microphone: ${mic?.health || 'Unknown'} (RMS: ${micRms.toFixed(3)})`}>
          <span className={`w-1.5 h-1.5 rounded-full ${getHealthColor(mic?.health)}`} />
          <span className="text-[10px] font-semibold text-emerald-400 tracking-wider">MIC</span>
          <div className="flex items-end gap-0.5 h-2.5 w-3.5">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={`mic-bar-${i}`}
                className={`w-0.5 rounded-sm transition-all duration-75 ${
                  i <= micBars
                    ? mic?.speechState === 'SPEAKING'
                      ? 'bg-emerald-300 shadow-[0_0_4px_rgba(52,211,153,0.8)]'
                      : 'bg-emerald-500'
                    : 'bg-slate-700'
                }`}
                style={{ height: `${i * 25}%` }}
              />
            ))}
          </div>
        </div>
      </button>

      {/* Floating Detailed Diagnostic Modal / Tooltip */}
      {showDetails && (
        <div className="absolute top-8 right-0 z-50 w-72 p-3 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl backdrop-blur-xl text-left font-mono text-[11px] animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
            <span className="text-slate-200 font-bold uppercase tracking-wider text-[10px]">Audio Diagnostics</span>
            <button
              type="button"
              onClick={() => setShowDetails(false)}
              className="text-slate-400 hover:text-white text-xs px-1"
            >
              ✕
            </button>
          </div>

          {/* Meeting Stream Details */}
          <div className="mb-2.5">
            <div className="flex justify-between items-center text-cyan-400 font-semibold mb-0.5">
              <span>MEETING (LOOPBACK)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800">
                {remote?.speechState === 'SPEAKING' ? 'SPEAKING' : 'IDLE'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-300">
              <div>Health: <span className="text-white">{remote?.health || 'UNKNOWN'}</span></div>
              <div>Peak RMS: <span className="text-cyan-300">{(remote?.peakRms ?? 0).toFixed(3)}</span></div>
              <div>Frames: <span className="text-slate-400">{remote?.totalFrames ?? 0}</span></div>
              <div>Non-Zero: <span className="text-emerald-300">{remote?.nonZeroFrames ?? 0}</span></div>
              <div className="col-span-2">
                Last Signal:{' '}
                <span className="text-slate-400">
                  {remote?.lastSignalTimestampMs
                    ? `${Math.round((Date.now() - remote.lastSignalTimestampMs) / 1000)}s ago`
                    : 'Never'}
                </span>
              </div>
            </div>
          </div>

          {/* Microphone Details */}
          <div>
            <div className="flex justify-between items-center text-emerald-400 font-semibold mb-0.5">
              <span>MICROPHONE (YOU)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800">
                {mic?.speechState === 'SPEAKING' ? 'SPEAKING' : 'IDLE'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-300">
              <div>Health: <span className="text-white">{mic?.health || 'UNKNOWN'}</span></div>
              <div>Peak RMS: <span className="text-emerald-300">{(mic?.peakRms ?? 0).toFixed(3)}</span></div>
              <div>Frames: <span className="text-slate-400">{mic?.totalFrames ?? 0}</span></div>
              <div>Non-Zero: <span className="text-emerald-300">{mic?.nonZeroFrames ?? 0}</span></div>
              <div className="col-span-2">
                Last Signal:{' '}
                <span className="text-slate-400">
                  {mic?.lastSignalTimestampMs
                    ? `${Math.round((Date.now() - mic.lastSignalTimestampMs) / 1000)}s ago`
                    : 'Never'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
