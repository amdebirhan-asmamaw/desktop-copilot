import * as React from 'react';
import { cn } from '../lib/utils';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-2xl [app-region:no-drag]">
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
          <button
            onClick={() => onOpenChange(false)}
            className="text-slate-400 hover:text-white text-xs cursor-pointer p-1"
          >
            ✕
          </button>
        </div>
        {description && <p className="text-xs text-slate-400 mb-4">{description}</p>}
        {children}
      </div>
    </div>
  );
};
