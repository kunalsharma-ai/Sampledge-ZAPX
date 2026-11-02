'use client';
import Link from 'next/link';
import { Palette, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';

/** `forInterviewers`: the page is also for the interviewer role (the phone calling screen). */
export function Shell({ children, crumbs, forInterviewers }: { children: ReactNode; crumbs?: ReactNode; forInterviewers?: boolean }) {
  const me = useMe();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand" style={{ color: 'inherit' }}>
          <span className="brand-mark" aria-hidden="true">
            <Zap size={13} strokeWidth={2.6} />
          </span>
          SAMPLEDGE <span>ZAPX</span>
        </Link>
        <nav className="muted">{crumbs}</nav>
        <div className="spacer" />
        {me && me.role !== 'VIEWER' ? (
          <Link href="/calls" className="small">
            Calls
          </Link>
        ) : null}
        {me?.role === 'ADMIN' ? (
          <Link href="/settings" className="small">
            Settings
          </Link>
        ) : me?.role === 'PROGRAMMER' ? (
          <Link href="/settings" className="small">
            API keys
          </Link>
        ) : null}
        <Link href="/appearance" className="small" title="Theme, mode, density and motion" data-testid="appearance-link">
          <Palette size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 4 }} />
          Appearance
        </Link>
        {me ? (
          <span className="muted small">
            {me.name} · {me.role.toLowerCase()} · {me.tenant.name}
          </span>
        ) : null}
        <button
          className="link"
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' });
            window.location.href = '/login';
          }}
        >
          Sign out
        </button>
        <button
          className="link small"
          title="Ends your sessions on every computer and phone"
          data-testid="sign-out-everywhere"
          onClick={async () => {
            if (!window.confirm('Sign out on every device, including this one?')) return;
            await api('/auth/logout-all', { method: 'POST' });
            window.location.href = '/login';
          }}
        >
          Sign out everywhere
        </button>
      </header>
      <main className="container">
        {me?.role === 'INTERVIEWER' && !forInterviewers ? (
          <section className="panel" data-testid="interviewer-notice">
            <h1>Use the interviewer app</h1>
            <p>
              Your account is for interviewing. For face-to-face interviews, sign in to the ZAPX interviewer (CAPI) app on your tablet or
              phone. For phone interviews, open <Link href="/calls">Calls</Link>.
            </p>
          </section>
        ) : (
          children
        )}
      </main>
    </>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; body?: { issues?: Array<{ path: string; message: string }> } };
  return (
    <div className="error-text" role="alert">
      {e.message ?? String(error)}
      {e.body?.issues?.length ? (
        <ul>
          {e.body.issues.slice(0, 10).map((i, n) => (
            <li key={n}>
              <span className="mono">{i.path || '(root)'}</span>: {i.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="copy">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button onClick={() => navigator.clipboard?.writeText(value)}>Copy</button>
    </div>
  );
}
