'use client';
/** Set a new password from a one-time reset link (/reset-password?token=…). */
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [form, setForm] = useState({ password: '', repeat: '' });
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.repeat) {
      setError(new Error('The passwords do not match.'));
      return;
    }
    setBusy(true);
    try {
      await api('/auth/reset-password', { body: { token, password: form.password } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel stack center-card" onSubmit={submit}>
      <div className="brand" style={{ fontSize: 18 }}>
        SAMPLEDGE <span>ZAPX</span>
      </div>
      <h1>Set a new password</h1>
      {!token ? (
        <p className="error-text" role="alert">
          This link is incomplete. Open the full link from the email, or ask for a new one.
        </p>
      ) : done ? (
        <p role="status">Your password was changed and you were signed out everywhere. Sign in with the new password.</p>
      ) : (
        <>
          <label className="field">
            New password (at least 10 characters)
            <input
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="field">
            Repeat new password
            <input
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={form.repeat}
              onChange={(e) => setForm({ ...form, repeat: e.target.value })}
            />
          </label>
          <ErrorNote error={error} />
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : 'Set password'}
          </button>
        </>
      )}
      <Link href={done ? '/login' : '/forgot-password'} className="link">
        {done ? 'Sign in' : 'Ask for a new link'}
      </Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
