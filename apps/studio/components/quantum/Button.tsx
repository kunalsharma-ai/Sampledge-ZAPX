'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Shows a spinner, keeps the width and blocks repeat clicks while an action runs. */
  loading?: boolean;
  icon?: ReactNode;
}

/** Quantum button. Primary is for the one main action in a region; danger for destructive ones. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`q-btn q-btn-${variant} q-btn-${size}${variant === 'primary' ? ' primary' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="q-spinner" aria-hidden="true" />
      ) : icon ? (
        <span className="q-btn-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
});
