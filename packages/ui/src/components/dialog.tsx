import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  className
}) => {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/40 backdrop-blur-xs animate-in fade-in-0 duration-150 [app-region:no-drag]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-full max-w-lg bg-slate-950/80 backdrop-blur-2xl border border-white/20 rounded-2xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)] [app-region:no-drag] flex flex-col max-h-[92vh] overflow-hidden text-slate-100",
          className
        )}
      >
        <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10 shrink-0">
          <div>
            {title && <h3 className="text-xs font-semibold tracking-wide text-white flex items-center gap-1.5">{title}</h3>}
            {description && <p className="text-[10px] text-slate-300/80 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-slate-300 hover:text-white text-xs cursor-pointer px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1 border border-white/15"
            title="Close (Esc)"
          >
            <span>✕</span>
            <kbd className="text-[9px] text-slate-300 font-mono bg-black/40 px-1 py-0.5 rounded">Esc</kbd>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pr-0.5 space-y-3">
          {children}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return content;
};
