import React, { useState, useEffect } from 'react';
import { Button, Badge, Card, Input, Dialog, Switch } from '@repo/ui';

export const FloatingHud: React.FC = () => {
  const [mode, setMode] = useState<'PASSIVE' | 'INTERACTIVE' | 'HIDDEN'>('PASSIVE');
  const [micActive, setMicActive] = useState(true);
  const [screenActive, setScreenActive] = useState(true);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [roleInput, setRoleInput] = useState('');
  const [instructionsInput, setInstructionsInput] = useState('');

  useEffect(() => {
    const api = (window as unknown as { copilotApi?: { onOverlayModeChanged: (cb: (m: 'PASSIVE' | 'INTERACTIVE' | 'HIDDEN') => void) => () => void } }).copilotApi;
    if (api?.onOverlayModeChanged) {
      return api.onOverlayModeChanged((newMode) => setMode(newMode));
    }
  }, []);

  const toggleOverlayMode = async () => {
    const api = (window as unknown as { copilotApi?: { setOverlayMode: (m: string) => Promise<void> } }).copilotApi;
    const nextMode = mode === 'PASSIVE' ? 'INTERACTIVE' : 'PASSIVE';
    await api?.setOverlayMode(nextMode);
    setMode(nextMode);
  };

  const handleSaveContext = async () => {
    const api = (window as unknown as { copilotApi?: { createSession: (ctx: unknown) => Promise<unknown> } }).copilotApi;
    if (api?.createSession) {
      await api.createSession({
        roleOrPersona: roleInput,
        instructions: instructionsInput
      });
    }
    setShowConfigModal(false);
  };

  return (
    <Card variant="glass" className="flex flex-col px-3.5 py-2.5 text-white [app-region:drag]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={mode.toLowerCase() as 'passive' | 'interactive' | 'hidden'}>
            COPILOT: {mode}
          </Badge>
        </div>

        <div className="flex items-center gap-2 [app-region:no-drag]">
          <Switch
            checked={micActive}
            onCheckedChange={setMicActive}
            label={micActive ? '🎙️ Mic' : '🔇 Muted'}
          />

          <Switch
            checked={screenActive}
            onCheckedChange={setScreenActive}
            label={screenActive ? '🖥️ Vision' : '🖥️ Off'}
          />

          <Button
            size="sm"
            variant={mode === 'INTERACTIVE' ? 'blue' : 'default'}
            onClick={toggleOverlayMode}
          >
            {mode === 'PASSIVE' ? 'Passive' : 'Interactive'}
          </Button>

          <Button
            size="sm"
            variant="emerald"
            onClick={async () => {
              const api = (window as unknown as {
                copilotApi?: {
                  feedTranscript?: (p: { speaker: 'REMOTE_SPEAKER'; text: string }) => Promise<void>;
                };
              }).copilotApi;
              await api?.feedTranscript?.({
                speaker: 'REMOTE_SPEAKER',
                text: 'Can you explain your approach to handling database sharding and cross-shard queries?'
              });
            }}
            title="Simulate incoming interviewer question"
          >
            ⚡ Demo Q&A
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowConfigModal(true)}
          >
            ⚙️ Context
          </Button>
        </div>
      </div>

      <Dialog
        open={showConfigModal}
        onOpenChange={setShowConfigModal}
        title="Session Initial Context"
        description="Provide background notes, candidate resume summary, or role instructions to guide copilot answers."
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-300 mb-1">
              Role / Persona
            </label>
            <Input
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              placeholder="e.g. Senior Distributed Systems Engineer"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-300 mb-1">
              Guidance & Instructions
            </label>
            <Input
              value={instructionsInput}
              onChange={(e) => setInstructionsInput(e.target.value)}
              placeholder="e.g. Keep answers under 3 punchy bullet points"
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
