'use client';
import { useId, type ReactNode } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  'data-testid'?: string;
}

/** On/off setting that applies immediately (use a checkbox inside forms that are submitted). */
export function Switch({ checked, onChange, label, description, disabled, ...rest }: SwitchProps) {
  const id = useId();
  return (
    <div className="q-switch-row">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        className="q-switch"
        onClick={() => onChange(!checked)}
        data-testid={rest['data-testid']}
      >
        <span className="q-switch-thumb" aria-hidden="true" />
      </button>
      <span className="q-switch-text">
        <label htmlFor={id}>{label}</label>
        {description ? (
          <span id={`${id}-d`} className="muted small">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
