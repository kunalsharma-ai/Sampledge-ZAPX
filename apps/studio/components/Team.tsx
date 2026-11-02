'use client';
/** Team members of the organization (administrators): list and add, including field interviewers. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';

interface Member {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';
  createdAt: string;
}

const ROLE_HELP: Record<Member['role'], string> = {
  ADMIN: 'everything, including settings and team',
  PROGRAMMER: 'builds, publishes and reviews surveys',
  VIEWER: 'read only',
  INTERVIEWER: 'only the offline CAPI app, for surveys assigned to them',
};

export function Team() {
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'PROGRAMMER' as Member['role'] });
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers(await api<Member[]>('/users'));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="panel stack" data-testid="team">
      <h2>Team</h2>
      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td className="mono small">{m.email}</td>
              <td>
                <span className="badge">{m.role.toLowerCase()}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setAdded(null);
          try {
            const m = await api<Member>('/users', { body: form });
            setAdded(m.email);
            setForm({ name: '', email: '', password: '', role: form.role });
            await load();
          } catch (err) {
            setError(err);
          }
        }}
      >
        <strong className="small">Add a team member</strong>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="field">
            Member name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            Member email
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="field">
            Initial password
            <input
              required
              type="password"
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="field">
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Member['role'] })}>
              {(Object.keys(ROLE_HELP) as Member['role'][]).map((r) => (
                <option key={r} value={r}>
                  {r.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {form.role.toLowerCase()}: {ROLE_HELP[form.role]}. Passwords need at least 10 characters; share them privately.
        </p>
        <div className="row">
          <button className="primary">Add member</button>
          {added ? <span className="ok-text small">Added {added}</span> : null}
        </div>
        <ErrorNote error={error} />
      </form>
    </section>
  );
}
