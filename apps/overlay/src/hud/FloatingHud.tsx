import React, { useState, useEffect } from 'react';
import { Button, Badge, Card, Input, Dialog, Switch } from '@repo/ui';
import { AudioWaveform } from './AudioWaveform';

interface CopilotApiBridge {
  onOverlayModeChanged?: (cb: (m: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void;
  setOverlayMode?: (m: string) => Promise<void>;
  createSession?: (ctx: unknown) => Promise<unknown>;
  feedTranscript?: (p: { speaker: 'USER' | 'REMOTE_SPEAKER'; text: string; isFinal?: boolean }) => Promise<void>;
  cancelActiveRequest?: () => Promise<void>;
  getProviderStatus?: () => Promise<{ provider: string; model: string; isDemo: boolean }>;
  onTranscriptEvent?: (cb: (data: { speaker: string; text: string; isFinal: boolean; timestamp: number }) => void) => () => void;
  captureScreenSnapshot?: () => Promise<{ success: boolean; dataUrl?: string; width?: number; height?: number; error?: string }>;
}

export const FloatingHud: React.FC = () => {
  const [mode, setMode] = useState<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>('PASSIVE');
  const [micActive, setMicActive] = useState<boolean>(true);
  const [screenActive, setScreenActive] = useState<boolean>(true);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [roleInput, setRoleInput] = useState<string>('Senior Distributed Systems Architect');
  const [instructionsInput, setInstructionsInput] = useState<string>('Keep answers concise with structured bullet points and high-level trade-offs');
  const [quickPrompt, setQuickPrompt] = useState<string>('');
  const [providerInfo, setProviderInfo] = useState<{ provider: string; model: string; isDemo: boolean } | null>(null);
  const [latestTranscript, setLatestTranscript] = useState<{ speaker: string; text: string } | null>(null);

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

    api.getProviderStatus?.().then((info) => {
      if (info) setProviderInfo(info);
    });

    return () => {
      unsubMode?.();
      unsubTranscript?.();
    };
  }, []);

  const toggleOverlayMode = async () => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    const nextMode = mode === 'PASSIVE' ? 'INTERACTIVE' : 'PASSIVE';
    await api?.setOverlayMode?.(nextMode);
    setMode(nextMode);
  };

  const handleSaveContext = async () => {
    const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
    if (api?.createSession) {
      await api.createSession({
        roleOrPersona: roleInput,
        instructions: instructionsInput
      });
    }
    setShowConfigModal(false);
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

  return (
    <Card variant="glass" className="flex flex-col px-3.5 py-2 text-white [app-region:drag] shadow-2xl backdrop-blur-2xl border-white/15">
      {/* Top Row: Indicators and Actions */}
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 [app-region:no-drag]">
          <Badge variant={mode.toLowerCase() as 'passive' | 'interactive' | 'hidden'}>
            {mode}
          </Badge>

          {providerInfo && (
            <Badge
              variant={providerInfo.isDemo ? 'warning' : 'passive'}
              className="text-[9px]"
              title={`Model: ${providerInfo.model}`}
            >
              {providerInfo.isDemo ? '🟡 Demo' : `🟢 ${providerInfo.provider}`}
            </Badge>
          )}

          <AudioWaveform active={micActive} />
        </div>

        <div className="flex items-center gap-1.5 [app-region:no-drag]">
          <Switch
            checked={micActive}
            onCheckedChange={setMicActive}
            label={micActive ? '🎙️' : '🔇'}
          />

          <Switch
            checked={screenActive}
            onCheckedChange={setScreenActive}
            label={screenActive ? '🖥️' : '⏹️'}
          />

          <Button
            size="sm"
            variant={mode === 'INTERACTIVE' ? 'blue' : 'default'}
            onClick={toggleOverlayMode}
            className="text-[11px] h-6 px-2"
          >
            {mode === 'PASSIVE' ? 'Interact' : 'Passive'}
          </Button>

          <Button
            size="sm"
            variant="emerald"
            onClick={async () => {
              const api = (window as unknown as { copilotApi?: CopilotApiBridge }).copilotApi;
              await api?.feedTranscript?.({
                speaker: 'REMOTE_SPEAKER',
                text: 'Can you explain your approach to handling database sharding and cross-shard queries?',
                isFinal: true
              });
            }}
            title="Simulate incoming interviewer question"
            className="text-[11px] h-6 px-2"
          >
            ⚡ Demo Q&A
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleCancelActive}
            title="Cancel / Stop current answer generation"
            className="text-[11px] h-6 px-1.5 hover:bg-rose-500/20 hover:text-rose-300"
          >
            ⏹️
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowConfigModal(true)}
            className="text-[11px] h-6 px-1.5"
            title="Session Persona & Context"
          >
            ⚙️
          </Button>
        </div>
      </div>

      {/* Middle/Bottom Row: Silent Prompt Box & Transcript Ticker */}
      <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-white/10 [app-region:no-drag]">
        <div className="flex-1">
          <input
            type="text"
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            onKeyDown={handleQuickPromptSubmit}
            placeholder="Type question & press Enter..."
            className="w-full text-[11px] px-2 py-0.5 rounded bg-slate-900/80 border border-slate-700/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400/80 transition-colors"
          />
        </div>

        {latestTranscript && (
          <div
            className="max-w-[200px] truncate text-[10px] text-slate-300 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/40 select-none"
            title={`${latestTranscript.speaker}: ${latestTranscript.text}`}
          >
            <span className="text-sky-400 font-semibold">{latestTranscript.speaker}:</span> {latestTranscript.text}
          </div>
        )}
      </div>

      {/* Context Configuration Modal */}
      <Dialog
        open={showConfigModal}
        onOpenChange={setShowConfigModal}
        title="Session Initial Context & Persona"
        description="Configure your background, candidate persona, or target interview rules to shape Copilot answers."
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-300 mb-1">
              Role / Target Persona
            </label>
            <Input
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              placeholder="e.g. Senior Distributed Systems Engineer"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-300 mb-1">
              Guidance & Behavioral Instructions
            </label>
            <Input
              value={instructionsInput}
              onChange={(e) => setInstructionsInput(e.target.value)}
              placeholder="e.g. Keep answers under 3 punchy bullet points and emphasize trade-offs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setShowConfigModal(false)}>
              Cancel
            </Button>
            <Button variant="emerald" size="sm" onClick={handleSaveContext}>
              Save Context
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
};
