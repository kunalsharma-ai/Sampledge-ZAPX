'use client';
import { useId } from 'react';

export interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Text for the current value, e.g. "55%". */
  valueText?: (v: number) => string;
  hint?: string;
  'data-testid'?: string;
}

/** Range input with a filled track and its value written out. */
export function Slider({ label, value, onChange, min = 0, max = 100, step = 1, valueText = (v) => `${v}%`, hint, ...rest }: SliderProps) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="q-slider">
      <div className="q-slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="mono small">
          {valueText(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText(value)}
        aria-describedby={hint ? `${id}-h` : undefined}
        style={{ '--q-fill': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={rest['data-testid']}
      />
      {hint ? (
        <span id={`${id}-h`} className="muted small">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
