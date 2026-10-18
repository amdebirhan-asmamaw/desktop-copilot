import React from 'react';
import { FloatingHud } from './hud/FloatingHud';
import { GhostOverlay } from './ghost/GhostOverlay';

export const App: React.FC = () => {
  const current = typeof window !== 'undefined'
    ? (window.location.pathname + window.location.hash + window.location.search).toLowerCase()
    : '';

  if (current.includes('ghost')) {
    return <GhostOverlay />;
  }

  return <FloatingHud />;
};
