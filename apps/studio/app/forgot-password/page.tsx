'use client';
/** Forgot password: asks for an email link. The answer is the same whether or not the account exists. */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';
import { AuthBrand, AuthFrame } from '@/components/neon/AuthFrame';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailOn, setEmailOn] = useState<boolean | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ forgotPasswordEmail: boolean }>('/auth/password-options')
      .then((o) => setEmailOn(o.forgotPasswordEmail))
      .catch(() => setEmailOn(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { body: { email } });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <form className="panel stack nx-auth-card" onSubmit={submit}>
        <AuthBrand />
        <h1>Reset your password</h1>
        {emailOn === false ? (
          <p className="muted">
            This SampCode does not send email. Ask an administrator of your organization for a password reset link (Settings → Team).
          </p>
        ) : sent ? (
          <p role="status">If an account with that email exists, we sent it a link to set a new password. Check your inbox.</p>
        ) : (
          <>
            <label className="field">
              Email
              <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <ErrorNote error={error} />
            <button className="primary" disabled={busy || emailOn === null}>
              {busy ? 'Please wait…' : 'Email me a link'}
            </button>
          </>
        )}
        <Link href="/login" className="link">
          Back to sign in
        </Link>
      </form>
    </AuthFrame>
  );
}
