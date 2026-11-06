'use client';
/**
 * Super admin: one organization. Change its plan and subscription, suspend or reactivate it, switch
 * features on or off for it (web CRM and mobile app separately), manage its members and their own
 * features, and see its integrations and activity. Every change applies at once in the CRM and the
 * mobile app, and is written to the organization's audit log.
 */
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CopyField, ErrorNote } from '@/components/Shell';
import { SuperAdminFrame, StatusBadge, ago, fmtDate, type PlanRow } from '@/components/super-admin/SuperAdminFrame';
import { FeatureMatrix, SURFACES, type FeatureDef, type Surface } from '@/components/super-admin/FeatureMatrix';
import { ActivityFeed, type ActivityEvent } from '@/components/super-admin/ActivityFeed';
import { InfoTip } from '@/components/neon/InfoTip';

type Overrides = Partial<Record<Surface, Record<string, boolean>>>;

interface Member {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';
  disabledAt: string | null;
  superAdmin: boolean;
  mobileAccess: boolean;
  featureOverrides: Overrides;
  lastSeenAt: string | null;
  lastClient: string | null;
}

interface Detail {
  organization: {
    id: string;
    name: string;
    plan: string;
    planName: string;
    subscriptionStatus: string;
    subscriptionEndsAt: string | null;
    suspendedAt: string | null;
    suspendedReason: string | null;
    platformOperator: boolean;
    adminNotes: string;
    createdAt: string;
  };
  plan: { code: string; name: string; webFeatures: string[]; mobileFeatures: string[] };
  overrides: Overrides;
  effective: Record<Surface, Record<string, boolean>>;
  usage: {
    limits: { seats: number | null; interviewers: number | null; liveSurveys: number | null; completesPerMonth: number | null };
    usage: { seats: number; interviewers: number; liveSurveys: number; completesThisMonth: number };
  };
  members: Member[];
  integrations: {
    sso: { enabled: boolean; protocol: string; enforced: boolean; domains: string[] } | null;
    scim: { since: string; lastUsedAt: string | null } | null;
    webhooks: number;
    apiKeys: number;
    vendors: number;
    ai: { enabled: boolean; tasks: string[] } | null;
  };
  activity: ActivityEvent[];
}

const toDateInput = (v: string | null) => (v ? v.slice(0, 10) : '');

function Subscription({ d, plans, onSaved }: { d: Detail; plans: PlanRow[]; onSaved: () => void }) {
  const o = d.organization;
  const [f, setF] = useState({
    name: o.name,
    plan: o.plan,
    status: o.subscriptionStatus,
    endsAt: toDateInput(o.subscriptionEndsAt),
    notes: o.adminNotes,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/super/organizations/${o.id}`, {
        method: 'PATCH',
        body: {
          name: f.name,
          plan: f.plan,
          subscriptionStatus: f.status,
          subscriptionEndsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`).toISOString() : null,
          notes: f.notes,
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const suspend = async () => {
    const reason = window.prompt('Why is this organization suspended? (its members see this is suspended, not the reason)') ?? null;
    if (reason === null) return;
    await api(`/super/organizations/${o.id}/suspend`, { body: { reason } }).then(onSaved, setError);
  };
  const reactivate = () => api(`/super/organizations/${o.id}/reactivate`, { method: 'POST' }).then(onSaved, setError);

  return (
    <section className="panel nx-card stack" data-testid="subscription">
      <div className="nx-card-head">
        <h2>
          Subscription
          <InfoTip k="sa.subscription" />
        </h2>
        <StatusBadge status={o.subscriptionStatus} suspended={!!o.suspendedAt} />
      </div>
      {o.suspendedAt ? (
        <p className="error-text small" style={{ margin: 0 }}>
          Suspended since {fmtDate(o.suspendedAt)}
          {o.suspendedReason ? `: ${o.suspendedReason}` : ''}. Nobody in this organization can sign in or use any feature.
        </p>
      ) : null}
      <div className="sa-form">
        <label className="field">
          Name
          <input value={f.name} onChange={set('name')} />
        </label>
        <label className="field">
          Plan
          <select value={f.plan} onChange={set('plan')} data-testid="plan-select">
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select value={f.status} onChange={set('status')} data-testid="status-select">
            <option value="active">Active</option>
            <option value="trialing">Trial</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="field">
          Ends on
          <input type="date" value={f.endsAt} onChange={set('endsAt')} data-testid="ends-input" />
        </label>
        <label className="field wide">
          Notes (only super admins see these)
          <textarea rows={2} value={f.notes} onChange={set('notes')} />
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => void save()} data-testid="save-subscription">
          Save
        </button>
        {saved ? <span className="ok-text small">Saved. Applies at once.</span> : null}
        <span className="spacer" />
        {o.suspendedAt ? (
          <button onClick={() => void reactivate()} data-testid="reactivate">
            Reactivate
          </button>
        ) : o.platformOperator ? null : (
          <button className="danger" onClick={() => void suspend()} data-testid="suspend">
            Suspend
          </button>
        )}
      </div>
      <table className="data small">
        <tbody>
          {(
            [
              ['Team seats', d.usage.usage.seats, d.usage.limits.seats],
              ['Interviewers', d.usage.usage.interviewers, d.usage.limits.interviewers],
              ['Live surveys', d.usage.usage.liveSurveys, d.usage.limits.liveSurveys],
              ['Completes this month', d.usage.usage.completesThisMonth, d.usage.limits.completesPerMonth],
            ] as const
          ).map(([label, used, max]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">
                {used.toLocaleString()} / {max === null ? 'unlimited' : max.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function OrgFeatures({ d, features, onSaved }: { d: Detail; features: FeatureDef[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Overrides>(d.overrides);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(d.overrides), [d.overrides]);
  const inPlan = (k: string, s: Surface) => (s === 'web' ? d.plan.webFeatures : d.plan.mobileFeatures).includes(k);
  const value = (k: string, s: Surface) => draft[s]?.[k] ?? inPlan(k, s);
  const toggle = (k: string, s: Surface, on: boolean) => {
    setSaved(false);
    setDraft((cur) => {
      const m = { ...(cur[s] ?? {}) };
      if (on === inPlan(k, s)) delete m[k];
      else m[k] = on;
      return { ...cur, [s]: m };
    });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(d.overrides);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/super/organizations/${d.organization.id}/features`, { method: 'PUT', body: draft });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const changes = SURFACES.reduce((n, s) => n + Object.keys(draft[s] ?? {}).length, 0);
  return (
    <section className="panel nx-card stack" data-testid="org-features">
      <div className="nx-card-head">
        <h2>
          Features
          <InfoTip k="sa.features" />
        </h2>
        <span className="muted small">
          From the {d.plan.name} plan{changes ? `, with ${changes} change${changes === 1 ? '' : 's'} for this organization` : ''}
        </span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Tick or untick to give this organization a feature its plan does not include, or take one away. Highlighted boxes differ from the
        plan. Saving applies at once to everyone in the organization, in the web CRM and the mobile app.
      </p>
      <FeatureMatrix
        features={features}
        testId="org-feature-matrix"
        cell={(k, s) => {
          const changed = draft[s]?.[k] !== undefined;
          return { checked: value(k, s), changed, note: changed ? 'changed' : 'plan' };
        }}
        onToggle={toggle}
      />
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" disabled={!dirty || busy} onClick={() => void save()} data-testid="save-org-features">
          Save features
        </button>
        <button className="link" disabled={!changes} onClick={() => setDraft({})}>
          Back to the plan
        </button>
        {saved && !dirty ? <span className="ok-text small">Saved. Applies at once.</span> : null}
      </div>
    </section>
  );
}

function MemberRow({ m, d, features, onSaved }: { m: Member; d: Detail; features: FeatureDef[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Overrides>(m.featureOverrides);
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const patch = (body: Record<string, unknown>) => api(`/super/users/${m.id}`, { method: 'PATCH', body }).then(onSaved, setError);
  const removed = SURFACES.reduce((n, s) => n + Object.keys(m.featureOverrides[s] ?? {}).length, 0);
  return (
    <>
      <tr data-testid={`member-${m.email}`}>
        <td>
          <strong>{m.name}</strong>
          {m.superAdmin ? (
            <span className="badge warn" style={{ marginLeft: 6 }}>
              super admin
            </span>
          ) : null}
          <div className="muted">{m.email}</div>
        </td>
        <td>
          <select aria-label={`Role of ${m.email}`} value={m.role} onChange={(e) => void patch({ role: e.target.value })}>
            <option value="ADMIN">Admin</option>
            <option value="PROGRAMMER">Programmer</option>
            <option value="VIEWER">Viewer</option>
            <option value="INTERVIEWER">Interviewer</option>
          </select>
        </td>
        <td>
          <label className="check">
            <input
              type="checkbox"
              checked={m.mobileAccess}
              onChange={(e) => void patch({ mobileAccess: e.target.checked })}
              data-testid={`mobile-access-${m.email}`}
            />
            Mobile app
          </label>
        </td>
        <td>
          {ago(m.lastSeenAt)}
          {m.lastClient ? <span className="muted"> · {m.lastClient}</span> : null}
        </td>
        <td>{m.disabledAt ? <span className="badge bad">Disabled</span> : <span className="badge good">Active</span>}</td>
        <td>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="small" onClick={() => setOpen((v) => !v)} data-testid={`member-features-${m.email}`}>
              Features{removed ? ` (${removed} off)` : ''}
            </button>
            <button className="small" onClick={() => void patch({ disabled: !m.disabledAt })}>
              {m.disabledAt ? 'Enable' : 'Disable'}
            </button>
            {!m.disabledAt ? (
              <button
                className="small"
                onClick={() =>
                  void api<{ url: string; emailed: boolean }>(`/super/users/${m.id}/password-reset`, { method: 'POST' }).then(
                    setLink,
                    setError,
                  )
                }
              >
                Reset link
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {error || link ? (
        <tr>
          <td colSpan={6}>
            <ErrorNote error={error} />
            {link ? (
              <div className="stack" style={{ gap: 4 }}>
                <span className="small muted">{link.emailed ? 'Emailed to the member.' : 'Send this link to the member:'}</span>
                <CopyField value={link.url} label="Password reset link" />
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
      {open ? (
        <tr>
          <td colSpan={6}>
            <p className="muted small">
              Untick a feature to take it away from {m.name} only. A member never gets more than the organization has.
            </p>
            <FeatureMatrix
              features={features}
              testId={`member-matrix-${m.email}`}
              cell={(k, s) => {
                const orgOn = d.effective[s]?.[k] === true;
                const off = draft[s]?.[k] === false;
                return {
                  checked: orgOn && !off,
                  disabled: !orgOn,
                  changed: off,
                  note: !orgOn ? 'not in org' : off ? 'removed' : undefined,
                };
              }}
              onToggle={(k, s, on) =>
                setDraft((cur) => {
                  const mm = { ...(cur[s] ?? {}) };
                  if (on) delete mm[k];
                  else mm[k] = false;
                  return { ...cur, [s]: mm };
                })
              }
            />
            <div className="row">
              <button
                className="primary small"
                onClick={() => void patch({ featureOverrides: draft }).then(() => setOpen(false))}
                data-testid="save-member-features"
              >
                Save {m.name}&rsquo;s features
              </button>
              <button className="link small" onClick={() => setDraft({})}>
                Give back everything
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AddMember({ orgId, onSaved }: { orgId: string; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'PROGRAMMER' });
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ setup: { url: string; emailed: boolean } }>(`/super/organizations/${orgId}/members`, { body: f });
      setLink(r.setup);
      setF({ name: '', email: '', role: 'PROGRAMMER' });
      onSaved();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="stack" onSubmit={submit} data-testid="add-member">
      <div className="sa-form">
        <label className="field">
          Member name
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="field">
          Email
          <input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </label>
        <label className="field">
          Role
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="ADMIN">Admin</option>
            <option value="PROGRAMMER">Programmer</option>
            <option value="VIEWER">Viewer</option>
            <option value="INTERVIEWER">Interviewer</option>
          </select>
        </label>
        <button className="primary">Add member</button>
      </div>
      <ErrorNote error={error} />
      {link ? (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">{link.emailed ? 'The setup link was emailed.' : 'Send this setup link to the new member:'}</span>
          <CopyField value={link.url} label="Setup link" />
        </div>
      ) : null}
    </form>
  );
}

export default function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => void api<Detail>(`/super/organizations/${id}`).then(setD, setError), [id]);
  useEffect(() => {
    load();
    void api<FeatureDef[]>('/features').then(setFeatures, setError);
    void api<PlanRow[]>('/super/plans').then(setPlans, setError);
  }, [load]);

  const i = d?.integrations;
  return (
    <SuperAdminFrame
      help="sa.organization"
      title={d?.organization.name ?? 'Organization'}
      intro={d ? `Registered ${fmtDate(d.organization.createdAt)} · ${d.organization.planName} plan` : undefined}
    >
      <ErrorNote error={error} />
      {d ? (
        <>
          <div className="sa-grid">
            <Subscription
              key={`${d.organization.plan}${d.organization.subscriptionStatus}${d.organization.suspendedAt}`}
              d={d}
              plans={plans}
              onSaved={load}
            />
            <section className="panel nx-card stack" data-testid="org-integrations">
              <div className="nx-card-head">
                <h2>
                  Integrations
                  <InfoTip k="sa.orgOwnIntegrations" />
                </h2>
                <Link href="/super-admin/integrations" className="small">
                  All integrations
                </Link>
              </div>
              <table className="data small">
                <tbody>
                  <tr>
                    <td>Single sign-on</td>
                    <td>
                      {i?.sso?.enabled ? `${i.sso.protocol}${i.sso.enforced ? ', required' : ''} (${i.sso.domains.join(', ')})` : 'Off'}
                    </td>
                  </tr>
                  <tr>
                    <td>SCIM provisioning</td>
                    <td>{i?.scim ? `On, last used ${ago(i.scim.lastUsedAt)}` : 'Off'}</td>
                  </tr>
                  <tr>
                    <td>Webhooks</td>
                    <td>{i?.webhooks} active</td>
                  </tr>
                  <tr>
                    <td>API keys</td>
                    <td>{i?.apiKeys} active</td>
                  </tr>
                  <tr>
                    <td>Sample vendors</td>
                    <td>{i?.vendors}</td>
                  </tr>
                  <tr>
                    <td>AI</td>
                    <td>{i?.ai ? (i.ai.enabled ? `On (${i.ai.tasks.join(', ')})` : 'Off') : 'Default'}</td>
                  </tr>
                </tbody>
              </table>
              <p className="muted small" style={{ margin: 0 }}>
                Switch these off for the organization with the Single sign-on, Webhooks, API keys, Vendors and AI assistant features below.
              </p>
            </section>
          </div>
          <div className="sa-grid">
            <OrgFeatures d={d} features={features} onSaved={load} />
          </div>
          <section className="panel nx-card stack" style={{ marginTop: 16 }} data-testid="org-members">
            <div className="nx-card-head">
              <h2>
                Members
                <InfoTip k="sa.members" />
              </h2>
              <span className="muted small">{d.members.length} in this organization</span>
            </div>
            <div className="scroll-x">
              <table className="data small">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Access</th>
                    <th>Last active</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.members.map((m) => (
                    <MemberRow key={`${m.id}${JSON.stringify(m.featureOverrides)}`} m={m} d={d} features={features} onSaved={load} />
                  ))}
                </tbody>
              </table>
            </div>
            <AddMember orgId={d.organization.id} onSaved={load} />
          </section>
          <section className="panel nx-card" style={{ marginTop: 16 }}>
            <div className="nx-card-head">
              <h2>
                Activity
                <InfoTip k="sa.activity" />
              </h2>
              <Link href={`/super-admin/activity?org=${d.organization.id}`} className="small">
                All activity of this organization
              </Link>
            </div>
            <ActivityFeed events={d.activity} showOrg={false} />
          </section>
        </>
      ) : !error ? (
        <div className="nx-skeleton" style={{ height: 300 }} />
      ) : null}
    </SuperAdminFrame>
  );
}
