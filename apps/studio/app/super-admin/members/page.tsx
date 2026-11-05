'use client';
/** Super admin: every member of every organization, with when and where (web or mobile) they were last active. */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';
import { SuperAdminFrame, ago } from '@/components/super-admin/SuperAdminFrame';

interface Row {
  id: string;
  email: string;
  name: string;
  role: string;
  disabledAt: string | null;
  superAdmin: boolean;
  mobileAccess: boolean;
  lastSeenAt: string | null;
  lastClient: string | null;
  featureOverrides: Partial<Record<'web' | 'mobile', Record<string, boolean>>>;
  tenant: { id: string; name: string };
}

export default function MembersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => void api<Row[]>(`/super/users${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setRows, setError), [q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  const patch = (id: string, body: Record<string, unknown>) => api(`/super/users/${id}`, { method: 'PATCH', body }).then(load, setError);

  return (
    <SuperAdminFrame title="Members" intro="Every account on this installation. Open a member's organization to change their own features.">
      <ErrorNote error={error} />
      <section className="panel nx-card">
        <input
          type="search"
          placeholder="Search by name or email"
          aria-label="Search members"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: '100%', maxWidth: 420 }}
        />
        <div className="scroll-x" style={{ marginTop: 12 }}>
          <table className="data small" data-testid="members-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Organization</th>
                <th>Role</th>
                <th>Last active</th>
                <th>Mobile app</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((u) => {
                const off =
                  (u.featureOverrides.web ? Object.keys(u.featureOverrides.web).length : 0) +
                  (u.featureOverrides.mobile ? Object.keys(u.featureOverrides.mobile).length : 0);
                return (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      {u.superAdmin ? (
                        <span className="badge warn" style={{ marginLeft: 6 }}>
                          super admin
                        </span>
                      ) : null}
                      {off ? (
                        <span className="badge" style={{ marginLeft: 6 }}>
                          {off} features off
                        </span>
                      ) : null}
                      <div className="muted">{u.email}</div>
                    </td>
                    <td>
                      <Link href={`/super-admin/organizations/${u.tenant.id}`}>{u.tenant.name}</Link>
                    </td>
                    <td>{u.role.toLowerCase()}</td>
                    <td>
                      {ago(u.lastSeenAt)}
                      {u.lastClient ? <span className="muted"> · {u.lastClient}</span> : null}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Mobile app for ${u.email}`}
                        checked={u.mobileAccess}
                        onChange={(e) => void patch(u.id, { mobileAccess: e.target.checked })}
                      />
                    </td>
                    <td>
                      <button className="small" disabled={u.superAdmin} onClick={() => void patch(u.id, { disabled: !u.disabledAt })}>
                        {u.disabledAt ? 'Enable' : 'Disable'}
                      </button>{' '}
                      {u.disabledAt ? <span className="badge bad">Disabled</span> : <span className="badge good">Active</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </SuperAdminFrame>
  );
}
