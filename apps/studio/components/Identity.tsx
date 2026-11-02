'use client';
/**
 * Settings for administrators: single sign-on (OpenID Connect, Milestone 8; SAML 2.0, Milestone 13),
 * SCIM provisioning, the organization's plan with its usage, and billing (Milestone 13).
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CopyField, ErrorNote } from './Shell';

type Role = 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';

type Protocol = 'OIDC' | 'SAML';

interface SsoState {
  available: boolean;
  callbackUrl: string;
  saml: { entityId: string; acsUrl: string; metadataUrl: string };
  config: {
    enabled: boolean;
    protocol: Protocol;
    samlEntryPoint: string | null;
    samlIdpIssuer: string | null;
    samlCerts: string[];
    issuer: string;
    clientId: string;
    clientSecretSet: boolean;
    domains: string[];
    enforced: boolean;
    jitRole: Role | null;
    updatedAt: string;
  } | null;
}

export function SsoSettings() {
  const [state, setState] = useState<SsoState | null>(null);
  const [form, setForm] = useState({
    enabled: true,
    protocol: 'OIDC' as Protocol,
    samlEntryPoint: '',
    samlIdpIssuer: '',
    samlCert: '',
    issuer: '',
    clientId: '',
    clientSecret: '',
    domains: '',
    enforced: false,
    jitRole: '' as '' | Role,
  });
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<SsoState>('/sso');
      setState(s);
      if (s.config)
        setForm({
          enabled: s.config.enabled,
          protocol: s.config.protocol,
          samlEntryPoint: s.config.samlEntryPoint ?? '',
          samlIdpIssuer: s.config.samlIdpIssuer ?? '',
          samlCert: s.config.samlCerts.join('\n'),
          issuer: s.config.issuer,
          clientId: s.config.clientId,
          clientSecret: '',
          domains: s.config.domains.join(', '),
          enforced: s.config.enforced,
          jitRole: s.config.jitRole ?? '',
        });
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api('/sso', {
        method: 'PUT',
        body: {
          enabled: form.enabled,
          protocol: form.protocol,
          ...(form.protocol === 'SAML'
            ? {
                samlEntryPoint: form.samlEntryPoint.trim(),
                samlIdpIssuer: form.samlIdpIssuer.trim(),
                samlCerts: splitCerts(form.samlCert),
              }
            : {
                issuer: form.issuer.trim(),
                clientId: form.clientId.trim(),
                ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
              }),
          domains: form.domains
            .split(/[\s,]+/)
            .map((d) => d.trim())
            .filter(Boolean),
          enforced: form.enforced,
          jitRole: form.jitRole || null,
        },
      });
      setNote(
        !form.enabled
          ? 'Saved. Single sign-on is off.'
          : form.protocol === 'SAML'
            ? 'Saved. Sign in once from a private window to check the identity provider.'
            : 'Saved. The identity provider answered correctly.',
      );
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  return (
    <section className="panel stack" data-testid="sso-settings">
      <h2>Single sign-on</h2>
      {!state.available ? (
        <p className="muted small">Single sign-on is not included in your plan.</p>
      ) : (
        <form className="stack" onSubmit={save}>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">Protocol</legend>
            <div className="row" role="radiogroup" aria-label="Protocol">
              {(
                [
                  ['OIDC', 'OpenID Connect'],
                  ['SAML', 'SAML 2.0'],
                ] as const
              ).map(([p, label]) => (
                <label key={p} className="check small">
                  <input
                    type="radio"
                    name="sso-protocol"
                    checked={form.protocol === p}
                    onChange={() => setForm({ ...form, protocol: p })}
                  />{' '}
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {form.protocol === 'OIDC' ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Microsoft Entra ID, Okta, Google Workspace, Keycloak and others. Register ZAPX as a web application at your provider with
                this redirect address, then enter its details here.
              </p>
              <CopyField label="Redirect URI" value={state.callbackUrl} />
              <label className="field">
                Issuer URL
                <input
                  value={form.issuer}
                  onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                  placeholder="https://login.example.com"
                  required
                />
              </label>
              <label className="field">
                Client ID
                <input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required />
              </label>
              <label className="field">
                Client secret
                <input
                  type="password"
                  autoComplete="off"
                  value={form.clientSecret}
                  onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                  placeholder={state.config?.protocol === 'OIDC' && state.config.clientSecretSet ? 'Stored. Leave empty to keep it.' : ''}
                  required={!(state.config?.protocol === 'OIDC' && state.config.clientSecretSet)}
                />
              </label>
            </>
          ) : (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                For identity providers that use SAML (AD FS, Entra ID, Okta, OneLogin, PingFederate). Add ZAPX as a SAML application with
                these details or import the metadata, have it send the email address (as the name ID or an email attribute), and sign the
                assertions. Sign-in starts from the ZAPX login page.
              </p>
              <CopyField label="Entity ID (audience)" value={state.saml.entityId} />
              <CopyField label="Assertion consumer service (ACS) URL" value={state.saml.acsUrl} />
              <p className="small" style={{ margin: 0 }}>
                <a href="/api/auth/sso/saml/metadata" target="_blank" rel="noreferrer">
                  Download ZAPX metadata (XML)
                </a>
              </p>
              <label className="field">
                Identity provider sign-in URL
                <input
                  value={form.samlEntryPoint}
                  onChange={(e) => setForm({ ...form, samlEntryPoint: e.target.value })}
                  placeholder="https://idp.example.com/saml/sso"
                  required
                />
              </label>
              <label className="field">
                Identity provider entity ID (issuer)
                <input
                  value={form.samlIdpIssuer}
                  onChange={(e) => setForm({ ...form, samlIdpIssuer: e.target.value })}
                  placeholder="https://idp.example.com/saml"
                  required
                />
              </label>
              <label className="field">
                Signing certificate (PEM). During a rotation, paste both, one after the other.
                <textarea
                  rows={5}
                  className="mono small"
                  value={form.samlCert}
                  onChange={(e) => setForm({ ...form, samlCert: e.target.value })}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  required
                />
              </label>
            </>
          )}
          <label className="field">
            Email domains
            <input
              value={form.domains}
              onChange={(e) => setForm({ ...form, domains: e.target.value })}
              placeholder="example.com, example.co.uk"
              required
            />
          </label>
          <label className="field">
            New people who sign in
            <select
              aria-label="New people who sign in"
              value={form.jitRole}
              onChange={(e) => setForm({ ...form, jitRole: e.target.value as '' | Role })}
            >
              <option value="">Refuse (an admin adds members first)</option>
              <option value="VIEWER">Create them as viewers</option>
              <option value="PROGRAMMER">Create them as programmers</option>
              <option value="INTERVIEWER">Create them as interviewers</option>
            </select>
          </label>
          <label className="check small">
            <input type="checkbox" checked={form.enforced} onChange={(e) => setForm({ ...form, enforced: e.target.checked })} /> Require
            single sign-on (admins can still use their password, so you can get back in if the provider fails)
          </label>
          <label className="check small">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Single
            sign-on is on
          </label>
          <ErrorNote error={error} />
          {note ? (
            <p className="ok-text small" role="status" style={{ margin: 0 }}>
              {note}
            </p>
          ) : null}
          <div>
            <button className="primary" disabled={busy}>
              {busy ? (form.protocol === 'OIDC' ? 'Checking the provider…' : 'Saving…') : 'Save single sign-on'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Splits pasted PEM text into certificates (several during a rotation). */
function splitCerts(text: string): string[] {
  const found = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  return found ?? (text.trim() ? [text.trim()] : []);
}

interface ScimState {
  available: boolean;
  baseUrl: string;
  token: { prefix: string; createdAt: string; lastUsedAt: string | null } | null;
}

export function ScimSettings() {
  const [state, setState] = useState<ScimState | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<ScimState>('/scim/token'));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (state?.token && !window.confirm('Replace the SCIM token? The current one stops working at once.')) return;
    setError(null);
    try {
      setCreated((await api<{ token: string }>('/scim/token', { method: 'POST' })).token);
      await load();
    } catch (e) {
      setError(e);
    }
  };
  const revoke = async () => {
    if (!window.confirm('Revoke the SCIM token? Your identity provider stops provisioning at once.')) return;
    setError(null);
    try {
      await api('/scim/token', { method: 'DELETE' });
      setCreated(null);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  if (!state) return null;
  return (
    <section className="panel stack" data-testid="scim-settings">
      <h2>SCIM provisioning</h2>
      {!state.available ? (
        <p className="muted small">SCIM provisioning is not included in your plan.</p>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Let your identity provider add, update and deactivate members. The role comes from the user&apos;s{' '}
            <span className="mono">roles</span> value: admin, programmer, viewer or interviewer (viewer if none). Deactivated or deleted
            users are disabled in ZAPX; their history is kept. Groups are not supported.
          </p>
          <CopyField label="SCIM base URL" value={state.baseUrl} />
          {created ? (
            <div className="callout stack" style={{ gap: 6 }} data-testid="new-scim-token">
              <strong>Copy the token now. It is not shown again.</strong>
              <CopyField label="SCIM token" value={created} />
              <button className="link" onClick={() => setCreated(null)}>
                I have stored it
              </button>
            </div>
          ) : null}
          <p className="small" style={{ margin: 0 }} data-testid="scim-token-status">
            {state.token
              ? `Token scim_${state.token.prefix}_… created ${new Date(state.token.createdAt).toLocaleString()}, ${
                  state.token.lastUsedAt ? `last used ${new Date(state.token.lastUsedAt).toLocaleString()}` : 'not used yet'
                }.`
              : 'No token yet.'}
          </p>
          <ErrorNote error={error} />
          <div className="row">
            <button onClick={create}>{state.token ? 'Replace token' : 'Create SCIM token'}</button>
            {state.token ? (
              <button className="danger" onClick={revoke}>
                Revoke token
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

interface PlanSummary {
  plan: { code: string; name: string };
  limits: {
    seats: number | null;
    interviewers: number | null;
    liveSurveys: number | null;
    completesPerMonth: number | null;
    sso: boolean;
    scim: boolean;
  };
  usage: { seats: number; interviewers: number; liveSurveys: number; completesThisMonth: number };
  periodStart: string;
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="stack" style={{ gap: 4 }} data-testid={`usage-${label}`}>
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <span>{label}</span>
        <strong>
          {used.toLocaleString()} {limit === null ? '(unlimited)' : `of ${limit.toLocaleString()}`}
        </strong>
      </div>
      {limit !== null ? (
        <div
          className={`bar${pct >= 100 ? ' full' : pct >= 80 ? ' near' : ''}`}
          role="progressbar"
          aria-label={label}
          aria-valuenow={Math.round(pct)}
        >
          <div style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function PlanUsage() {
  const [s, setS] = useState<PlanSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    void api<PlanSummary>('/plan').then(setS, setError);
  }, []);
  if (!s) return <ErrorNote error={error} />;
  const month = new Date(s.periodStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <section className="panel stack" data-testid="plan-usage" style={{ alignSelf: 'start' }}>
      <h2>Plan: {s.plan.name}</h2>
      <Meter label="Team members" used={s.usage.seats} limit={s.limits.seats} />
      <Meter label="Interviewers" used={s.usage.interviewers} limit={s.limits.interviewers} />
      <Meter label="Live surveys" used={s.usage.liveSurveys} limit={s.limits.liveSurveys} />
      <Meter label={`Completes in ${month}`} used={s.usage.completesThisMonth} limit={s.limits.completesPerMonth} />
      <p className="muted small" style={{ margin: 0 }}>
        Single sign-on: {s.limits.sso ? 'included' : 'not included'} · SCIM: {s.limits.scim ? 'included' : 'not included'}. When the
        month&apos;s completes are used, new respondents see the survey as closed; people already in an interview can finish.
      </p>
    </section>
  );
}

interface BillingSummary {
  enabled: boolean;
  plan: string;
  status: string | null;
  periodEnd: string | null;
  hasSubscription: boolean;
  canManage: boolean;
  purchasable: Array<{ code: string; name: string; limits: PlanSummary['limits'] }>;
}

const STATUS_TEXT: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Payment failed: Stripe is retrying. Update the payment method to keep the plan.',
  canceled: 'Cancelled',
  unpaid: 'Unpaid',
  incomplete: 'Waiting for the first payment',
  incomplete_expired: 'The first payment did not complete',
};

const limit = (n: number | null, what: string) => (n === null ? `unlimited ${what}` : `${n.toLocaleString()} ${what}`);

/** Billing (Milestone 13): buy a plan with Stripe Checkout, manage it in the Stripe portal. */
export function Billing() {
  const [b, setB] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [returned] = useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('billing')));
  useEffect(() => {
    void api<BillingSummary>('/billing').then(setB, setError);
  }, []);

  const go = async (path: string, body?: unknown, key = path) => {
    setBusy(key);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(path, { method: 'POST', body });
      window.location.assign(url);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  if (!b) return error ? <ErrorNote error={error} /> : null;
  if (!b.enabled) {
    return (
      <section className="panel stack" data-testid="billing">
        <h2>Billing</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Online billing is not turned on for this ZAPX installation. Your plan is set by your ZAPX operator.
        </p>
      </section>
    );
  }
  return (
    <section className="panel stack" data-testid="billing">
      <h2>Billing</h2>
      {returned === 'success' ? (
        <p className="ok-text small" role="status" style={{ margin: 0 }}>
          Thank you. Your plan changes as soon as Stripe confirms the payment, usually within a minute.
        </p>
      ) : returned === 'cancelled' ? (
        <p className="muted small" role="status" style={{ margin: 0 }}>
          Checkout was cancelled; nothing was charged.
        </p>
      ) : null}
      {b.hasSubscription ? (
        <p className="small" style={{ margin: 0 }}>
          Subscription: <strong>{STATUS_TEXT[b.status ?? ''] ?? b.status}</strong>
          {b.periodEnd && (b.status === 'active' || b.status === 'trialing')
            ? ` · renews ${new Date(b.periodEnd).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
            : ''}
        </p>
      ) : null}
      {!b.hasSubscription || b.status === 'canceled' || b.status === 'incomplete_expired' ? (
        <div className="stack">
          {b.purchasable.map((p) => (
            <div key={p.code} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="small">
                <strong>{p.name}</strong>
                <span className="muted">
                  {' '}
                  · {limit(p.limits.seats, 'members')}, {limit(p.limits.completesPerMonth, 'completes a month')}
                  {p.limits.sso ? ', single sign-on' : ''}
                  {p.limits.scim ? ', SCIM' : ''}
                </span>
              </div>
              <button
                className="primary"
                disabled={!!busy || p.code === b.plan}
                onClick={() => void go('/billing/checkout', { plan: p.code }, p.code)}
              >
                {p.code === b.plan ? 'Current plan' : busy === p.code ? 'Opening Stripe…' : `Choose ${p.name}`}
              </button>
            </div>
          ))}
          <p className="muted small" style={{ margin: 0 }}>
            Payment is handled by Stripe; ZAPX never sees card details. Prices are shown on the Stripe page before you pay.
          </p>
        </div>
      ) : null}
      {b.canManage ? (
        <div>
          <button disabled={!!busy} onClick={() => void go('/billing/portal')}>
            {busy === '/billing/portal' ? 'Opening Stripe…' : 'Manage billing (plan, payment method, invoices)'}
          </button>
        </div>
      ) : null}
      <ErrorNote error={error} />
    </section>
  );
}
