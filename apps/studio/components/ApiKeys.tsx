'use client';
/** Organization API keys: create (shown once), list and revoke. Admins see every key. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CopyField, ErrorNote } from './Shell';

interface Key {
  id: string;
  name: string;
  prefix: string;
  role: 'PROGRAMMER' | 'VIEWER';
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string; email: string };
}

const when = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');

function state(k: Key) {
  if (k.revokedAt) return <span className="badge bad">revoked</span>;
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) return <span className="badge warn">expired</span>;
  return <span className="badge good">active</span>;
}

export function ApiKeys({ isAdmin }: { isAdmin: boolean }) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [form, setForm] = useState({ name: '', role: 'VIEWER' as Key['role'], expiresInDays: '90' });
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await api<Key[]>('/api-keys'));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="panel stack wide" data-testid="api-keys">
      <h2>API keys</h2>
      <p className="muted small" style={{ margin: 0 }}>
        For scripts and integrations: send <span className="mono">Authorization: Bearer &lt;key&gt;</span>. A key acts as the member who
        created it, with at most its own role, and sees the same projects. {isAdmin ? 'You see every key in the organization.' : ''}
      </p>
      {created ? (
        <div className="callout stack" style={{ gap: 6 }} data-testid="new-api-key">
          <strong>Copy the key for “{created.name}” now. It is not shown again.</strong>
          <CopyField label="New API key" value={created.key} />
          <button className="link" onClick={() => setCreated(null)}>
            I have stored it
          </button>
        </div>
      ) : null}
      {keys.length ? (
        <div className="scroll-x">
          <table className="data small">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Role</th>
                {isAdmin ? <th>Created by</th> : null}
                <th>Last used</th>
                <th>Expires</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="mono">zapx_{k.prefix}_…</td>
                  <td>{k.role.toLowerCase()}</td>
                  {isAdmin ? <td>{k.createdBy.name}</td> : null}
                  <td>{when(k.lastUsedAt)}</td>
                  <td>{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'never'}</td>
                  <td>{state(k)}</td>
                  <td>
                    {!k.revokedAt ? (
                      <button
                        className="link"
                        onClick={async () => {
                          if (!window.confirm(`Revoke “${k.name}”? Anything using it stops working at once.`)) return;
                          try {
                            await api(`/api-keys/${k.id}`, { method: 'DELETE' });
                            await load();
                          } catch (e) {
                            setError(e);
                          }
                        }}
                      >
                        Revoke {k.name}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No API keys yet.</p>
      )}
      <form
        className="row"
        style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const k = await api<Key & { key: string }>('/api-keys', {
              body: { name: form.name, role: form.role, ...(form.expiresInDays ? { expiresInDays: Number(form.expiresInDays) } : {}) },
            });
            setCreated({ name: k.name, key: k.key });
            setForm({ ...form, name: '' });
            await load();
          } catch (err) {
            setError(err);
          }
        }}
      >
        <label className="field">
          Key label
          <input
            required
            maxLength={120}
            placeholder="e.g. Nightly export"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="field">
          Key role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Key['role'] })}>
            <option value="VIEWER">viewer (read only)</option>
            <option value="PROGRAMMER">programmer (can change surveys)</option>
          </select>
        </label>
        <label className="field">
          Expires after
          <select value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="">never</option>
          </select>
        </label>
        <button className="primary">Create API key</button>
      </form>
      <ErrorNote error={error} />
    </section>
  );
}
