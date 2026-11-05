'use client';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'placeholder'> {
  label: string;
  /** Help shown under the field. */
  hint?: ReactNode;
  /** Error message: marks the field invalid and is announced to screen readers. */
  error?: string | null;
  /** Trailing adornment, e.g. a unit. */
  suffix?: ReactNode;
}

/** Floating-label text input. The label is a real <label>, never a placeholder. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, suffix, id, className, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`q-field${error ? ' q-invalid' : ''}${className ? ` ${className}` : ''}`}>
      <div className="q-field-box">
        <input ref={ref} id={inputId} placeholder=" " aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
        <label htmlFor={inputId}>
          {label}
          {rest.required ? <span aria-hidden="true"> *</span> : null}
        </label>
        {suffix ? <span className="q-field-suffix">{suffix}</span> : null}
      </div>
      {hint ? (
        <div id={hintId} className="q-field-hint">
          {hint}
        </div>
      ) : null}
      <div id={errorId} className="q-field-error" aria-live="polite">
        {error ?? ''}
      </div>
    </div>
  );
});
