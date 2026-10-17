import * as React from 'react';
import { cn } from '../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'passive' | 'interactive' | 'hidden';
}

export const Badge: React.FC<BadgeProps> = ({ className, variant = 'default', children, ...props }) => {
  const baseStyles = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase';

  const variants: Record<string, string> = {
    default: 'bg-slate-800 text-slate-300 border border-slate-700',
    passive: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    interactive: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
    hidden: 'bg-slate-700/30 text-slate-400 border border-slate-700/40'
  };

  return (
    <div className={cn(baseStyles, variants[variant], className)} {...props}>
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          variant === 'passive' && 'bg-emerald-400',
          variant === 'interactive' && 'bg-blue-400',
          variant === 'hidden' && 'bg-slate-500',
          variant === 'default' && 'bg-slate-400'
        )}
      />
      {children}
    </div>
  );
};
