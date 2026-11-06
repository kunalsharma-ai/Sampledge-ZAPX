import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HELP, type HelpKey } from './help';

/**
 * The neon "i" next to a heading. Tapping it opens a card that explains what the section is for,
 * how to use it and when (text in help.ts). Escape, a tap outside or "Got it" closes it.
 */
export function Info({ k }: { k: HelpKey }) {
  const e = HELP[k];
  const id = useId();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    btn.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    ok.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
  return (
    <>
      <button ref={btn} type="button" className="capi-info" aria-label="Help" aria-expanded={open} onClick={() => setOpen(true)}>
        i
      </button>
      {open
        ? createPortal(
            <div className="capi-info-backdrop" onClick={close}>
              <div className="capi-info-card" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(ev) => ev.stopPropagation()}>
                <h3 id={id}>{e.title}</h3>
                <strong>What it is for</strong>
                <p>{e.what}</p>
                <strong>How to use it</strong>
                <ol>
                  {e.how.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <strong>Where and when to use it</strong>
                <p>{e.where}</p>
                <button ref={ok} type="button" className="capi-button" onClick={close}>
                  Got it
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
