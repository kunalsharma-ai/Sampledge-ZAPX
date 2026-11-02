'use client';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SelectionOption<T extends string> {
  value: T;
  label: string;
  description?: ReactNode;
  /** Picture shown on the card (cards layout) or as a small leading mark (list layout). */
  visual?: ReactNode;
  disabled?: boolean;
}

export interface SelectionCardsProps<T extends string> {
  label: string;
  value: T | null;
  options: SelectionOption<T>[];
  onChange: (value: T) => void;
  /** `cards` for visual choosing, `list` for a compact layout experienced people scan faster. */
  layout?: 'cards' | 'list';
  /** Minimum card width in the cards layout. */
  minWidth?: number;
  'data-testid'?: string;
}

/** Single choice shown as cards or a compact list. A radio group: arrow keys move, Space/Enter picks. */
export function SelectionCards<T extends string>({
  label,
  value,
  options,
  onChange,
  layout = 'cards',
  minWidth = 180,
  ...rest
}: SelectionCardsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const current = options.findIndex((o) => o.value === value);
  const focusable = current >= 0 ? current : (enabled[0] ?? 0);
  const onKey = (e: KeyboardEvent, i: number) => {
    const forward = ['ArrowRight', 'ArrowDown'].includes(e.key);
    const back = ['ArrowLeft', 'ArrowUp'].includes(e.key);
    if (!forward && !back) return;
    e.preventDefault();
    const pos = enabled.indexOf(i);
    const next = enabled[(pos + (forward ? 1 : -1) + enabled.length) % enabled.length]!;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`q-choices q-choices-${layout}`}
      style={layout === 'cards' ? { gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` } : undefined}
      data-testid={rest['data-testid']}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={o.disabled}
            tabIndex={i === focusable ? 0 : -1}
            className="q-choice"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.visual ? (
              <span className="q-choice-visual" aria-hidden="true">
                {o.visual}
              </span>
            ) : null}
            <span className="q-choice-text">
              <span className="q-choice-label">{o.label}</span>
              {o.description ? <span className="q-choice-desc">{o.description}</span> : null}
            </span>
            <span className="q-choice-mark" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}
