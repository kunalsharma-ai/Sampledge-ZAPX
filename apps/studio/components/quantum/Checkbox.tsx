'use client';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

/** Native checkbox (keyboard, forms and screen readers work as usual) with an animated mark. */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={`q-check${className ? ` ${className}` : ''}`}>
      <input type="checkbox" {...rest} />
      <span className="q-check-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>{label}</span>
    </label>
  );
}
