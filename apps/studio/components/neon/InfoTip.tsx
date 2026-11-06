'use client';

import { Info, Lightbulb, MapPin, Target, Wrench } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HELP, type HelpKey } from '@/lib/help';

/**
 * The small neon "i" next to a feature, page section, tab or question type. Hovering (mouse) shows a
 * preview; clicking or tapping pins it open. The card explains, in plain language, what the feature is
 * for, how to use it and where or when to use it. All text lives in `lib/help.ts`.
 *
 *   <h2>Quotas <InfoTip k="section.quotas" /></h2>
 *
 * The button's accessible name is just "Help" (plus the topic as its description), so it never
 * changes how tests or screen readers find the heading or button it sits next to. The card is
 * rendered in a portal with fixed positioning, so panels with `overflow: hidden` never clip it.
 * Escape, a click outside or the close of the page closes it; focus goes back to the button.
 */
export function InfoTip({ k, label, size = 15 }: { k: HelpKey; /** Visible text after the icon. */ label?: string; size?: number }) {
  const entry = HELP[k];
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState<false | 'hover' | 'pinned'>(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const w = Math.min(360, window.innerWidth - 24);
    const h = card.current?.offsetHeight ?? 260;
    const left = Math.max(12, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - w - 12));
    const below = b.bottom + 10;
    const above = below + h > window.innerHeight - 8 && b.top - h - 10 > 8;
    setPos({ top: above ? b.top - h - 10 : below, left, above });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !card.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  if (!entry) return null;

  const hoverIn = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen((o) => o || 'hover'), 180);
  };
  const hoverOut = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen((o) => (o === 'hover' ? false : o)), 220);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`nx-info${label ? ' with-label' : ''}`}
        aria-label={label ? undefined : 'Help'}
        aria-description={`About ${entry.title}`}
        aria-expanded={!!open}
        aria-controls={open ? id : undefined}
        data-help={k}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => (o === 'pinned' ? false : 'pinned'));
        }}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
      >
        <Info size={size} aria-hidden="true" />
        {label ? <span>{label}</span> : null}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={card}
              id={id}
              role="dialog"
              aria-modal="false"
              aria-labelledby={`${id}-t`}
              className={`nx-info-card${pos?.above ? ' above' : ''}`}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
              onPointerEnter={hoverIn}
              onPointerLeave={hoverOut}
            >
              <div className="nx-info-title" id={`${id}-t`}>
                <span className="nx-info-badge" aria-hidden="true">
                  <Info size={14} />
                </span>
                {entry.title}
              </div>
              <div className="nx-info-row">
                <Target size={14} aria-hidden="true" />
                <div>
                  <strong>What it is for</strong>
                  <p>{entry.what}</p>
                </div>
              </div>
              <div className="nx-info-row">
                <Wrench size={14} aria-hidden="true" />
                <div>
                  <strong>How to use it</strong>
                  {entry.how.length === 1 ? (
                    <p>{entry.how[0]}</p>
                  ) : (
                    <ol>
                      {entry.how.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
              <div className="nx-info-row">
                <MapPin size={14} aria-hidden="true" />
                <div>
                  <strong>Where and when to use it</strong>
                  <p>{entry.where}</p>
                </div>
              </div>
              {entry.tip ? (
                <div className="nx-info-row tip">
                  <Lightbulb size={14} aria-hidden="true" />
                  <p>{entry.tip}</p>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
