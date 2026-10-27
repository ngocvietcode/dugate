import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { FOCUS_RING } from './toneClasses';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-card text-foreground hover:bg-muted',
  danger: 'border border-[rgb(var(--la2-danger)/0.5)] bg-[rgb(var(--la2-danger)/0.10)] text-[rgb(var(--la2-danger))] hover:bg-[rgb(var(--la2-danger)/0.18)]',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', type = 'button', children, ...rest },
  ref,
) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm';
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANT[variant]} ${FOCUS_RING} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
