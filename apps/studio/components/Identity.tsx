'use client';
/**
 * Milestone 8 settings for administrators: single sign-on (OpenID Connect), SCIM provisioning, and
 * the organization's plan with its usage.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CopyField, ErrorNote } from './Shell';

type Role = 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';

interface SsoState {
  available: boolean;
  callbackUrl: string;
  config: {
    enabled: boolean;
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
          issuer: form.issuer.trim(),
          clientId: form.clientId.trim(),
          ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
          domains: form.domains
            .split(/[\s,]+/)
            .map((d) => d.trim())
            .filter(Boolean),
          enforced: form.enforced,
          jitRole: form.jitRole || null,
        },
      });
      setNote(form.enabled ? 'Saved. The identity provider answered correctly.' : 'Saved. Single sign-on is off.');
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
          <p className="muted small" style={{ margin: 0 }}>
            OpenID Connect (Microsoft Entra ID, Okta, Google Workspace, Keycloak and others). Register ZAPX as a web application at your
            provider with this redirect address, then enter its details here.
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
              placeholder={state.config?.clientSecretSet ? 'Stored. Leave empty to keep it.' : ''}
              required={!state.config?.clientSecretSet}
            />
          </label>
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
              {busy ? 'Checking the provider…' : 'Save single sign-on'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
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
        month&apos;s completes are used, new respondents see the survey as closed; people already in an interview can finish. Plans are
        changed by your ZAPX operator.
      </p>
    </section>
  );
}
