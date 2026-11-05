'use client';
/**
 * Team members of the organization (administrators): list, add, and change a member's role and
 * project access. Changes apply to the member's next request.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { ErrorNote } from './Shell';

type Role = 'ADMIN' | 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';
type Scope = 'ALL' | 'ASSIGNED';

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  projectScope: Scope;
  disabledAt: string | null;
  ssoSubject: string | null;
  scimExternalId: string | null;
  createdAt: string;
  _count?: { projects: number };
}

const ROLE_HELP: Record<Role, string> = {
  ADMIN: 'everything, including settings and team',
  PROGRAMMER: 'builds, publishes and reviews surveys',
  VIEWER: 'read only',
  INTERVIEWER: 'only the offline CAPI app, for surveys assigned to them',
};

const scoped = (role: Role) => role === 'PROGRAMMER' || role === 'VIEWER';

export function Team() {
  const me = useMe();
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'PROGRAMMER' as Role, projectScope: 'ALL' as Scope });
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ name: string; url: string; expiresAt: string; emailed: boolean } | null>(null);

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

  const change = async (m: Member, body: Partial<Pick<Member, 'role' | 'projectScope'>> & { disabled?: boolean }) => {
    setError(null);
    setNote(null);
    try {
      await api(`/users/${m.id}`, { method: 'PATCH', body });
      setNote(
        body.disabled === true
          ? `Disabled ${m.name}. They are signed out and their API keys stop working.`
          : body.disabled === false
            ? `Enabled ${m.name}.`
            : `Updated ${m.name}. It applies to their next action.`,
      );
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const reset = async (m: Member) => {
    if (!window.confirm(`Create a password reset link for ${m.name}? Older links for them stop working.`)) return;
    setError(null);
    setNote(null);
    try {
      const r = await api<{ url: string; expiresAt: string; emailed: boolean }>(`/users/${m.id}/password-reset`, { method: 'POST' });
      setResetLink({ name: m.name, ...r });
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="panel stack wide" data-testid="team">
      <h2>Team</h2>
      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Project access</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className={m.disabledAt ? 'muted' : undefined}>
              <td>
                {m.name}
                {m.ssoSubject ? (
                  <span className="badge" title="Has signed in with single sign-on">
                    SSO
                  </span>
                ) : null}
                {m.scimExternalId ? (
                  <span className="badge" title="Managed by your identity provider (SCIM)">
                    SCIM
                  </span>
                ) : null}
              </td>
              <td className="mono small">{m.email}</td>
              <td>
                {m.id === me?.id ? (
                  <span className="badge">{m.role.toLowerCase()} (you)</span>
                ) : (
                  <select
                    aria-label={`Role of ${m.name}`}
                    value={m.role}
                    onChange={(e) => void change(m, { role: e.target.value as Role })}
                  >
                    {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {r.toLowerCase()}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td>
                {scoped(m.role) ? (
                  <select
                    aria-label={`Project access of ${m.name}`}
                    value={m.projectScope}
                    onChange={(e) => void change(m, { projectScope: e.target.value as Scope })}
                  >
                    <option value="ALL">All projects</option>
                    <option value="ASSIGNED">Assigned projects ({m._count?.projects ?? 0})</option>
                  </select>
                ) : (
                  <span className="muted small">{m.role === 'INTERVIEWER' ? 'Assigned surveys only' : 'All projects'}</span>
                )}
              </td>
              <td>
                {m.disabledAt ? <span className="badge bad">disabled</span> : <span className="badge good">active</span>}{' '}
                {m.id === me?.id ? null : (
                  <button className="link" onClick={() => void change(m, { disabled: !m.disabledAt })}>
                    {m.disabledAt ? `Enable ${m.name}` : `Disable ${m.name}`}
                  </button>
                )}
                {m.id === me?.id || m.disabledAt ? null : (
                  <>
                    {' '}
                    <button className="link" onClick={() => void reset(m)}>
                      Reset password
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {resetLink ? (
        <div className="stack" role="status" data-testid="reset-link">
          <p className="small" style={{ margin: 0 }}>
            Password reset link for {resetLink.name}
            {resetLink.emailed ? ' (also emailed to them)' : ''}. It works once, until {new Date(resetLink.expiresAt).toLocaleString()}.
            Send it to them privately; it is shown only now.
          </p>
          <input readOnly className="mono small" value={resetLink.url} onFocus={(e) => e.currentTarget.select()} aria-label="Reset link" />
        </div>
      ) : null}
      <p className="muted small" style={{ margin: 0 }}>
        Members with assigned project access only see projects an administrator adds them to, on the project page under Project access.
      </p>
      {note ? (
        <p className="ok-text small" role="status" style={{ margin: 0 }}>
          {note}
        </p>
      ) : null}
      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setNote(null);
          try {
            const m = await api<Member>('/users', { body: form });
            setNote(`Added ${m.email}`);
            setForm({ ...form, name: '', email: '', password: '' });
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
            <select aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {r.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          {scoped(form.role) ? (
            <label className="field">
              Project access
              <select
                aria-label="Project access"
                value={form.projectScope}
                onChange={(e) => setForm({ ...form, projectScope: e.target.value as Scope })}
              >
                <option value="ALL">All projects</option>
                <option value="ASSIGNED">Assigned projects only</option>
              </select>
            </label>
          ) : null}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {form.role.toLowerCase()}: {ROLE_HELP[form.role]}. Passwords need at least 10 characters; share them privately.
        </p>
        <div className="row">
          <button className="primary">Add member</button>
        </div>
        <ErrorNote error={error} />
      </form>
    </section>
  );
}
