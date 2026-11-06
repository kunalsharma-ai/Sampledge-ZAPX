'use client';
/** Super admin: every organization, and registering a new organization with its first administrator. */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CopyField, ErrorNote } from '@/components/Shell';
import { SuperAdminFrame, StatusBadge, ago, fmtDate, type PlanRow } from '@/components/super-admin/SuperAdminFrame';
import { InfoTip } from '@/components/neon/InfoTip';

interface OrgRow {
  id: string;
  name: string;
  plan: string;
  planName: string;
  subscriptionStatus: string;
  subscriptionEndsAt: string | null;
  suspendedAt: string | null;
  platformOperator: boolean;
  createdAt: string;
  members: number;
  projects: number;
  admins: Array<{ id: string; email: string; name: string }>;
  lastActiveAt: string | null;
  overrides: number;
}

interface Created {
  organization: { id: string; name: string };
  admin: { email: string };
  setup: { url: string; expiresAt: string; emailed: boolean } | null;
}

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'trialing', label: 'Trial' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'suspended', label: 'Suspended' },
];

function RegisterForm({ plans, onDone }: { plans: PlanRow[]; onDone: (c: Created) => void }) {
  const [f, setF] = useState({
    organization: '',
    adminName: '',
    adminEmail: '',
    plan: '',
    subscriptionStatus: 'active',
    endsAt: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const plan = f.plan || plans.find((p) => p.active)?.code || '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<Created>('/super/organizations', {
        body: {
          organization: f.organization,
          adminName: f.adminName,
          adminEmail: f.adminEmail,
          plan,
          subscriptionStatus: f.subscriptionStatus,
          subscriptionEndsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`).toISOString() : null,
          notes: f.notes || undefined,
        },
      });
      onDone(created);
      setF({ organization: '', adminName: '', adminEmail: '', plan: '', subscriptionStatus: 'active', endsAt: '', notes: '' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel nx-card stack" onSubmit={submit} data-testid="register-org">
      <h2>
        Register an organization
        <InfoTip k="sa.register" />
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Creates the organization and its first administrator. The administrator gets a link to choose a password (emailed when email sending
        is set up; you can also copy it).
      </p>
      <div className="sa-form">
        <label className="field">
          Organization
          <input required value={f.organization} onChange={set('organization')} data-testid="org-name-input" />
        </label>
        <label className="field">
          Administrator name
          <input required value={f.adminName} onChange={set('adminName')} data-testid="admin-name-input" />
        </label>
        <label className="field">
          Administrator email
          <input required type="email" value={f.adminEmail} onChange={set('adminEmail')} data-testid="admin-email-input" />
        </label>
        <label className="field">
          Plan
          <select value={plan} onChange={set('plan')} data-testid="org-plan-select">
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
                {p.active ? '' : ' (not offered)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Subscription
          <select value={f.subscriptionStatus} onChange={set('subscriptionStatus')}>
            <option value="active">Active</option>
            <option value="trialing">Trial</option>
          </select>
        </label>
        <label className="field">
          Ends on (optional)
          <input type="date" value={f.endsAt} onChange={set('endsAt')} />
        </label>
        <label className="field wide">
          Notes (only super admins see these)
          <input value={f.notes} onChange={set('notes')} />
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" disabled={busy} data-testid="register-org-submit">
          {busy ? 'Registering…' : 'Register organization'}
        </button>
      </div>
    </form>
  );
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
    api<OrgRow[]>(`/super/organizations?${params}`).then(setOrgs, setError);
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    void api<PlanRow[]>('/super/plans').then(setPlans, setError);
    if (new URLSearchParams(window.location.search).get('new')) setShowForm(true);
  }, []);

  return (
    <SuperAdminFrame
      help="sa.organizations"
      title="Organizations"
      intro="Each organization is one customer with its own administrators, members, plan and features."
      actions={
        <button className="primary" onClick={() => setShowForm((v) => !v)} data-testid="show-register">
          {showForm ? 'Close' : 'Register organization'}
        </button>
      }
    >
      <ErrorNote error={error} />
      {created ? (
        <section className="panel stack" data-testid="org-created">
          <strong>
            {created.organization.name} is registered. Its administrator is {created.admin.email}.
          </strong>
          {created.setup ? (
            <>
              <span className="small muted">
                {created.setup.emailed ? 'The setup link was emailed. ' : 'Email sending is off, so send this setup link yourself. '}
                It works once, until {new Date(created.setup.expiresAt).toLocaleString()}.
              </span>
              <CopyField value={created.setup.url} label="Setup link" />
            </>
          ) : null}
          <Link href={`/super-admin/organizations/${created.organization.id}`}>Open the organization</Link>
        </section>
      ) : null}
      {showForm ? (
        <RegisterForm
          plans={plans}
          onDone={(c) => {
            setCreated(c);
            setShowForm(false);
            load();
          }}
        />
      ) : null}

      <section className="panel nx-card" style={{ marginTop: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search by organization or member email"
            aria-label="Search organizations"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: '1 1 260px' }}
          />
          <div className="sa-pill-row" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                className={status === f.value ? 'primary small' : 'small'}
                aria-pressed={status === f.value}
                onClick={() => setStatus(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="scroll-x" style={{ marginTop: 12 }}>
          <table className="data small" data-testid="org-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Plan</th>
                <th>Subscription</th>
                <th>Ends</th>
                <th className="num">Members</th>
                <th>Administrators</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {orgs?.map((o) => (
                <tr key={o.id} data-testid="org-row">
                  <td>
                    <Link href={`/super-admin/organizations/${o.id}`}>{o.name}</Link>
                    {o.platformOperator ? (
                      <span className="badge" style={{ marginLeft: 6 }}>
                        operator
                      </span>
                    ) : null}
                    {o.overrides ? (
                      <span className="badge warn" style={{ marginLeft: 6 }} title="Features changed for this organization">
                        {o.overrides} custom
                      </span>
                    ) : null}
                  </td>
                  <td>{o.planName}</td>
                  <td>
                    <StatusBadge status={o.subscriptionStatus} suspended={!!o.suspendedAt} />
                  </td>
                  <td>{fmtDate(o.subscriptionEndsAt)}</td>
                  <td className="num">{o.members}</td>
                  <td>{o.admins.map((a) => a.email).join(', ') || '—'}</td>
                  <td>{ago(o.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orgs && !orgs.length ? <p className="muted small">No organization matches.</p> : null}
        </div>
      </section>
    </SuperAdminFrame>
  );
}
