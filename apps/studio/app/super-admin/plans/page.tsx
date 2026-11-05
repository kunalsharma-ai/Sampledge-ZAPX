'use client';
/**
 * Super admin: subscription plans. Each plan has a price (shown only; Stripe prices are set in
 * Integrations), limits, and the features it includes, separately for the web CRM and the mobile
 * app. Changing a plan applies at once to every organization on it.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';
import { SuperAdminFrame } from '@/components/super-admin/SuperAdminFrame';
import { FeatureMatrix, type FeatureDef, type Surface } from '@/components/super-admin/FeatureMatrix';

interface Limits {
  seats: number | null;
  interviewers: number | null;
  liveSurveys: number | null;
  completesPerMonth: number | null;
  sso: boolean;
  scim: boolean;
}

interface Plan {
  code: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: 'month' | 'year';
  limits: Limits;
  webFeatures: string[];
  mobileFeatures: string[];
  active: boolean;
  sortOrder: number;
  organizations: number;
}

const LIMITS: Array<{ key: keyof Omit<Limits, 'sso' | 'scim'>; label: string }> = [
  { key: 'seats', label: 'Team seats' },
  { key: 'interviewers', label: 'Interviewers' },
  { key: 'liveSurveys', label: 'Live surveys' },
  { key: 'completesPerMonth', label: 'Completes a month' },
];

const blank = (features: FeatureDef[]): Plan => ({
  code: '',
  name: '',
  description: '',
  priceCents: 0,
  currency: 'USD',
  interval: 'month',
  limits: { seats: 5, interviewers: 5, liveSurveys: 5, completesPerMonth: 1000, sso: false, scim: false },
  webFeatures: features.filter((f) => f.surfaces.includes('web')).map((f) => f.key),
  mobileFeatures: features.filter((f) => f.surfaces.includes('mobile')).map((f) => f.key),
  active: true,
  sortOrder: 10,
  organizations: 0,
});

function PlanEditor({ initial, features, isNew, onDone }: { initial: Plan; features: FeatureDef[]; isNew: boolean; onDone: () => void }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const setLimit = (k: keyof Limits, v: number | null | boolean) => setP({ ...p, limits: { ...p.limits, [k]: v } });
  const toggle = (k: string, s: Surface, on: boolean) => {
    setSaved(false);
    setP((cur) => {
      const field = s === 'web' ? 'webFeatures' : 'mobileFeatures';
      const list = cur[field].filter((x) => x !== k);
      return { ...cur, [field]: on ? [...list, k] : list };
    });
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      currency: p.currency,
      interval: p.interval,
      limits: p.limits,
      webFeatures: p.webFeatures,
      mobileFeatures: p.mobileFeatures,
      active: p.active,
      sortOrder: p.sortOrder,
    };
    try {
      if (isNew) await api('/super/plans', { body: { ...body, code: p.code } });
      else await api(`/super/plans/${p.code}`, { method: 'PUT', body });
      setSaved(true);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the ${p.name} plan?`)) return;
    await api(`/super/plans/${p.code}`, { method: 'DELETE' }).then(onDone, setError);
  };

  return (
    <div className="stack" data-testid={`plan-editor-${p.code || 'new'}`}>
      <div className="sa-form">
        {isNew ? (
          <label className="field">
            Code (cannot change later)
            <input
              required
              value={p.code}
              placeholder="e.g. agency"
              onChange={(e) => setP({ ...p, code: e.target.value.toLowerCase() })}
              data-testid="plan-code"
            />
          </label>
        ) : null}
        <label className="field">
          Name
          <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} data-testid="plan-name" />
        </label>
        <label className="field">
          Price ({p.currency})
          <input
            type="number"
            min={0}
            step="0.01"
            value={p.priceCents / 100}
            onChange={(e) => setP({ ...p, priceCents: Math.round(Number(e.target.value) * 100) })}
          />
        </label>
        <label className="field">
          Billed
          <select value={p.interval} onChange={(e) => setP({ ...p, interval: e.target.value as Plan['interval'] })}>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </label>
        <label className="field">
          Currency
          <input maxLength={3} value={p.currency} onChange={(e) => setP({ ...p, currency: e.target.value.toUpperCase() })} />
        </label>
        {LIMITS.map((l) => (
          <label key={l.key} className="field">
            {l.label}
            <input
              type="number"
              min={0}
              placeholder="unlimited"
              value={p.limits[l.key] ?? ''}
              onChange={(e) => setLimit(l.key, e.target.value === '' ? null : Number(e.target.value))}
              data-testid={`limit-${l.key}`}
            />
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={p.limits.sso} onChange={(e) => setLimit('sso', e.target.checked)} /> Single sign-on allowed
        </label>
        <label className="check">
          <input type="checkbox" checked={p.limits.scim} onChange={(e) => setLimit('scim', e.target.checked)} /> SCIM allowed
        </label>
        <label className="check">
          <input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Offered to new
          organizations
        </label>
        <label className="field wide">
          Description
          <input value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Leave a limit empty for unlimited. Tick the features this plan includes on the web CRM and on the mobile app.
      </p>
      <FeatureMatrix
        features={features}
        testId={`plan-matrix-${p.code || 'new'}`}
        cell={(k, s) => ({ checked: (s === 'web' ? p.webFeatures : p.mobileFeatures).includes(k) })}
        onToggle={toggle}
      />
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => void save()} data-testid="save-plan">
          {isNew ? 'Create plan' : 'Save plan'}
        </button>
        {saved ? <span className="ok-text small">Saved. Applies at once to every organization on this plan.</span> : null}
        <span className="spacer" />
        {!isNew ? (
          <button
            className="danger"
            disabled={p.organizations > 0}
            title={p.organizations ? 'Move its organizations first' : undefined}
            onClick={() => void remove()}
          >
            Delete plan
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => void api<Plan[]>('/super/plans').then(setPlans, setError), []);
  useEffect(() => {
    load();
    void api<FeatureDef[]>('/features').then(setFeatures, setError);
  }, [load]);

  const count = (p: Plan) => `${p.webFeatures.length} web · ${p.mobileFeatures.length} mobile features`;
  return (
    <SuperAdminFrame
      title="Plans & features"
      intro="What each subscription includes. Organizations get their plan's features; you can still change single features for one organization on its page."
      actions={
        <button className="primary" onClick={() => setOpen(open === '__new' ? null : '__new')} data-testid="new-plan">
          New plan
        </button>
      }
    >
      <ErrorNote error={error} />
      {open === '__new' && features.length ? (
        <section className="panel nx-card stack" style={{ marginBottom: 16 }}>
          <h2>New plan</h2>
          <PlanEditor
            initial={blank(features)}
            features={features}
            isNew
            onDone={() => {
              setOpen(null);
              load();
            }}
          />
        </section>
      ) : null}
      <div className="stack">
        {plans?.map((p) => (
          <section key={p.code} className="panel nx-card stack" data-testid={`plan-${p.code}`}>
            <div className="nx-card-head">
              <h2>
                {p.name} <span className="muted small mono">{p.code}</span>
                {!p.active ? <span className="badge">not offered</span> : null}
              </h2>
              <div className="row" style={{ gap: 10 }}>
                <span className="small">
                  {p.priceCents
                    ? `${(p.priceCents / 100).toLocaleString(undefined, { style: 'currency', currency: p.currency })} / ${p.interval}`
                    : 'No price set'}
                </span>
                <span className="muted small">{count(p)}</span>
                <span className="badge">{p.organizations} organizations</span>
                <button onClick={() => setOpen(open === p.code ? null : p.code)} data-testid={`edit-plan-${p.code}`}>
                  {open === p.code ? 'Close' : 'Edit'}
                </button>
              </div>
            </div>
            {p.description ? (
              <p className="muted small" style={{ margin: 0 }}>
                {p.description}
              </p>
            ) : null}
            {open === p.code ? <PlanEditor key={JSON.stringify(p)} initial={p} features={features} isNew={false} onDone={load} /> : null}
          </section>
        ))}
      </div>
    </SuperAdminFrame>
  );
}
