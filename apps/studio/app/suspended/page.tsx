'use client';
/** Shown when the super admin has suspended the member's organization: nothing else works until it is reactivated. */
import { api } from '@/lib/api';

export default function SuspendedPage() {
  return (
    <main className="center-card">
      <section className="panel stack" data-testid="suspended">
        <h1>Your organization is suspended</h1>
        <p>
          Your organization&rsquo;s ZAPX access is paused, so you cannot open projects, surveys or settings right now. This usually means
          the subscription ended. Contact your ZAPX account manager to reactivate it; everything is kept as it was.
        </p>
        <div className="row">
          <button
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
              window.location.href = '/login';
            }}
          >
            Sign out
          </button>
          <button className="primary" onClick={() => (window.location.href = '/')}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
