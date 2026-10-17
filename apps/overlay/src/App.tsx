import React from 'react';
import { FloatingHud } from './hud/FloatingHud';
import { GhostOverlay } from './ghost/GhostOverlay';

export const App: React.FC = () => {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';

  if (path.includes('/ghost')) {
    return <GhostOverlay />;
  }

  return <FloatingHud />;
};
