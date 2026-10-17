import * as React from 'react';
import { cn } from '../lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'glass' | 'ghost' | 'solid';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'glass', ...props }, ref) => {
    const variants: Record<string, string> = {
      glass: 'bg-slate-900/80 backdrop-blur-xl border border-white/10 shadow-2xl rounded-xl',
      ghost: 'bg-slate-950/75 backdrop-blur-xl border border-white/15 shadow-2xl rounded-2xl',
      solid: 'bg-slate-900 border border-slate-800 shadow-lg rounded-xl'
    };

    return <div ref={ref} className={cn(variants[variant], className)} {...props} />;
  }
);

Card.displayName = 'Card';
