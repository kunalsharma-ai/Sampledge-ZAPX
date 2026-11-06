'use client';
/** My account: change my password (signs out my other sessions, keeps this one). */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { ErrorNote, Shell } from '@/components/Shell';
import { PageHeader } from '@/components/neon/PageHeader';
import { UserRound } from 'lucide-react';
import { InfoTip } from '@/components/neon/InfoTip';

export default function AccountPage() {
  const me = useMe();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (form.newPassword !== form.repeat) {
      setError(new Error('The new passwords do not match.'));
      return;
    }
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      setForm({ currentPassword: '', newPassword: '', repeat: '' });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <PageHeader icon={UserRound} tone={4} eyebrow="Profile & security" title="My account" help="page.account">
        {me ? (
          <>
            {me.name} · {me.email} · {me.role.toLowerCase()}
          </>
        ) : null}
      </PageHeader>
      <form className="panel stack" style={{ maxWidth: 420 }} onSubmit={submit} data-testid="change-password">
        <h2>
          Change password
          <InfoTip k="section.password" />
        </h2>
        <p className="small muted">Your other signed-in devices are signed out. This one stays signed in.</p>
        <label className="field">
          Current password
          <input type="password" required autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} />
        </label>
        <label className="field">
          New password (at least 10 characters)
          <input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={form.newPassword}
            onChange={set('newPassword')}
          />
        </label>
        <label className="field">
          Repeat new password
          <input type="password" required minLength={10} autoComplete="new-password" value={form.repeat} onChange={set('repeat')} />
        </label>
        <ErrorNote error={error} />
        {done ? (
          <p className="small" role="status">
            Password changed.
          </p>
        ) : null}
        <button className="primary" disabled={busy}>
          {busy ? 'Please wait…' : 'Change password'}
        </button>
      </form>
    </Shell>
  );
}
