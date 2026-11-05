'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';

interface Note {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/** Blueprint phase 5: in-app notifications from automation rules (and approvals waiting). */
export function NotificationBell() {
  const [data, setData] = useState<{ unread: number; items: Note[] } | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const load = useCallback(() => api<{ unread: number; items: Note[] }>('/notifications').then(setData, () => undefined), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const read = async (n: Note) => {
    if (!n.read) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    void load();
  };
  const unread = data?.unread ?? 0;

  return (
    <div className="q-theme-menu" ref={root} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        className="q-theme-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        data-testid="notifications"
        onClick={() => {
          setOpen((o) => !o);
          void load();
        }}
      >
        <Bell size={14} aria-hidden />
        {unread ? (
          <span className="nx-badge-count" data-testid="notifications-unread">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={panelId} className="q-theme-panel nx-notes" role="dialog" aria-label="Notifications">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Notifications</strong>
            {unread ? (
              <button
                className="nx-text-btn"
                onClick={async () => {
                  await api('/notifications/read-all', { method: 'POST' });
                  void load();
                }}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {!data?.items.length ? <p className="muted small">Nothing yet. Automation rules can send you notifications.</p> : null}
          <ul className="nx-note-list">
            {data?.items.slice(0, 20).map((n) => (
              <li key={n.id} className={n.read ? 'read' : ''}>
                {n.link ? (
                  <Link href={n.link} onClick={() => void read(n)}>
                    <strong>{n.title}</strong>
                  </Link>
                ) : (
                  <strong>{n.title}</strong>
                )}
                <div className="small">{n.body}</div>
                <div className="row small muted" style={{ justifyContent: 'space-between' }}>
                  <span>{new Date(n.createdAt).toLocaleString()}</span>
                  {!n.read ? (
                    <button className="nx-text-btn" onClick={() => void read(n)}>
                      Mark read
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <Link href="/automation" className="small">
            Automation rules
          </Link>
        </div>
      ) : null}
    </div>
  );
}
