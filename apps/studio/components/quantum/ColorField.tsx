'use client';
import { useEffect, useId, useState } from 'react';
import { isHexColor } from '@zapx/quantum';

export interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  'data-testid'?: string;
}

/** Colour picker plus a hex text box (typed values apply once they are a valid colour). */
export function ColorField({ label, value, onChange, ...rest }: ColorFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = isHexColor(text);
  return (
    <div className="q-color">
      <label htmlFor={`${id}-hex`} className="small muted">
        {label}
      </label>
      <div className="q-color-row">
        <input type="color" aria-label={`${label} picker`} value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          id={`${id}-hex`}
          className="mono"
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid || undefined}
          onChange={(e) => {
            setText(e.target.value);
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
          }}
          data-testid={rest['data-testid']}
        />
      </div>
      {!valid ? <span className="error-text small">Use a hex colour such as #4f7dff</span> : null}
    </div>
  );
}
