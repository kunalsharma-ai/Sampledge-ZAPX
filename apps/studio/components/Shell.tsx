'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';

export function Shell({ children, crumbs }: { children: ReactNode; crumbs?: ReactNode }) {
  const me = useMe();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand" style={{ color: 'inherit' }}>
          SAMPLEDGE <span>ZAPX</span>
        </Link>
        <nav className="muted">{crumbs}</nav>
        <div className="spacer" />
        {me?.role === 'ADMIN' ? (
          <Link href="/settings" className="small">
            Settings
          </Link>
        ) : me?.role === 'PROGRAMMER' ? (
          <Link href="/settings" className="small">
            API keys
          </Link>
        ) : null}
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
      </header>
      <main className="container">
        {me?.role === 'INTERVIEWER' ? (
          <section className="panel" data-testid="interviewer-notice">
            <h1>Use the interviewer app</h1>
            <p>
              Your account is for face-to-face interviewing. Sign in to the ZAPX interviewer (CAPI) app on your tablet or phone instead.
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
