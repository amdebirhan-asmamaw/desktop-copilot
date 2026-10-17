import * as React from 'react';
import { cn } from '../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'emerald' | 'blue' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

    const variants: Record<string, string> = {
      default: 'bg-white/10 hover:bg-white/20 text-white border border-white/15 shadow-sm',
      outline: 'bg-transparent hover:bg-white/10 text-slate-200 border border-slate-700',
      ghost: 'hover:bg-white/10 text-slate-300 hover:text-white',
      emerald: 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30',
      blue: 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30',
      destructive: 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30'
    };

    const sizes: Record<string, string> = {
      default: 'h-8 px-3 text-xs',
      sm: 'h-7 px-2 text-[11px]',
      lg: 'h-10 px-4 text-sm',
      icon: 'h-8 w-8'
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
