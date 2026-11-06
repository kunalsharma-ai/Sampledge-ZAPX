'use client';

import { AlertTriangle, HelpCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Neon confirm dialog, the replacement for `window.confirm`.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Delete vendor?', message: '…', confirmLabel: 'Delete', tone: 'danger' }))) return;
 *
 * One dialog is mounted by `ConfirmProvider` in the root layout. It is an `alertdialog` with a focus
 * trap: Tab stays inside, Escape or a click on the backdrop cancels, and focus returns to the control
 * that opened it. Destructive dialogs start on Cancel, so a stray Enter never deletes anything.
 */
export type ConfirmOptions = {
  /** Short question, shown as the heading (the dialog's accessible name). */
  title: string;
  /** What happens if the person confirms. */
  message?: ReactNode;
  /** Label of the confirm button (default "Confirm"). */
  confirmLabel?: string;
  /** Label of the cancel button (default "Cancel"). */
  cancelLabel?: string;
  /** `danger` styles the confirm button red and focuses Cancel first. */
  tone?: 'danger' | 'default';
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm(): (o: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const queue = useRef<Pending[]>([]);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const p = { ...o, resolve };
        setPending((cur) => {
          if (cur) {
            queue.current.push(p);
            return cur;
          }
          return p;
        });
      }),
    [],
  );

  const settle = useCallback((ok: boolean) => {
    setPending((cur) => {
      cur?.resolve(ok);
      return queue.current.shift() ?? null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? <ConfirmDialog key={pending.title} {...pending} onSettle={settle} /> : null}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onSettle,
}: Pending & { onSettle: (ok: boolean) => void }) {
  const titleId = useId();
  const bodyId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);
  const danger = tone === 'danger';

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (danger ? cancelBtn : okBtn).current?.focus();
    return () => {
      // Return focus to whatever opened the dialog, if it is still on the page.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [danger]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onSettle(false);
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const focusable = Array.from(
      panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'),
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const Icon = danger ? AlertTriangle : HelpCircle;
  return (
    <div className="nx-modal-backdrop nx-confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onSettle(false)}>
      <div
        ref={panel}
        className={`nx-modal nx-confirm panel stack${danger ? ' nx-confirm-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? bodyId : undefined}
        data-testid="confirm-dialog"
        onKeyDown={onKeyDown}
      >
        <div className="nx-confirm-head">
          <span className="nx-confirm-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <h2 id={titleId}>{title}</h2>
        </div>
        {message ? (
          <div id={bodyId} className="nx-confirm-body">
            {message}
          </div>
        ) : null}
        <div className="nx-confirm-actions">
          <button ref={cancelBtn} type="button" onClick={() => onSettle(false)}>
            {cancelLabel}
          </button>
          <button ref={okBtn} type="button" className={danger ? 'nx-confirm-danger-btn' : 'primary'} onClick={() => onSettle(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
