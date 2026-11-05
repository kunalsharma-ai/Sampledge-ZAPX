'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';
import { AuthBrand, AuthFrame } from '@/components/neon/AuthFrame';

function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', organization: '' });
  const ssoError = params.get('sso_error');
  const [error, setError] = useState<unknown>(ssoError ? new Error(ssoError) : null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await api('/auth/login', { body: { email: form.email, password: form.password } });
      else await api('/auth/register', { body: form });
      const next = params.get('next');
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Single sign-on: the organization is found from the email domain, then the browser goes to its provider. */
  const sso = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError(new Error('Enter your work email first.'));
      return;
    }
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/auth/sso/start', { body: { email: form.email, next: params.get('next') ?? '/' } });
      window.location.href = url;
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="panel stack nx-auth-card" onSubmit={submit}>
      <AuthBrand />
      <h1>{mode === 'login' ? 'Sign in' : 'Create an organization'}</h1>
      {mode === 'register' ? (
        <>
          <label className="field">
            Organization
            <input required value={form.organization} onChange={set('organization')} />
          </label>
          <label className="field">
            Your name
            <input required value={form.name} onChange={set('name')} />
          </label>
        </>
      ) : null}
      <label className="field">
        Email
        <input type="email" required autoComplete="username" value={form.email} onChange={set('email')} />
      </label>
      <label className="field">
        Password
        <input
          type="password"
          required
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={form.password}
          onChange={set('password')}
        />
      </label>
      <ErrorNote error={error} />
      <button className="primary" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      {mode === 'login' ? (
        <button type="button" onClick={sso} disabled={busy}>
          Sign in with SSO
        </button>
      ) : null}
      {mode === 'login' ? (
        <Link href="/forgot-password" className="link">
          Forgot your password?
        </Link>
      ) : null}
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an organization' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthFrame>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
