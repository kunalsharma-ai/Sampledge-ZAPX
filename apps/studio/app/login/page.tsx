'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';

function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', organization: '' });
  const [error, setError] = useState<unknown>(null);
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

  return (
    <form className="panel stack center-card" onSubmit={submit}>
      <div className="brand" style={{ fontSize: 18 }}>
        SAMPLEDGE <span>ZAPX</span>
      </div>
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
        <input type="password" required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} />
      </label>
      <ErrorNote error={error} />
      <button className="primary" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an organization' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
