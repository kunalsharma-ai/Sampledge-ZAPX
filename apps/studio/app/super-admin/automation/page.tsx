'use client';
/**
 * Super admin automation: "when this happens to an organization, do that" rules. Start from a
 * ready-made rule with one click, or build one: pick a trigger, then add actions. Rules are checked
 * every minute; each firing happens once per organization and is logged below.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Play, Plus, Trash2, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';
import { SuperAdminFrame, ago, fmtTime, type PlanRow } from '@/components/super-admin/SuperAdminFrame';
import type { FeatureDef } from '@/components/super-admin/FeatureMatrix';
import { useConfirm } from '@/components/neon/ConfirmDialog';
import { InfoTip } from '@/components/neon/InfoTip';

type Params = { days?: number; percent?: number; status?: string };
type Action = { type: string } & Record<string, unknown>;

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  params: Params;
  actions: Action[];
  summary: string;
  runs: number;
  lastRunAt: string | null;
}

interface Vocabulary {
  triggers: Array<{ key: string; label: string; help: string; params: string[] }>;
  actions: Array<{ key: string; label: string }>;
  templates: Array<{ id: string; description: string; rule: Omit<Rule, 'id' | 'summary' | 'runs' | 'lastRunAt'> }>;
}

interface Run {
  id: string;
  automation: { id: string; name: string };
  organization: { id: string; name: string | null };
  outcome: string;
  results: Array<{ type: string; ok: boolean; detail: string }>;
  at: string;
}

const STATUSES = ['', 'active', 'trialing', 'expired', 'cancelled'];

function ActionFields({
  a,
  onChange,
  plans,
  features,
}: {
  a: Action;
  onChange: (a: Action) => void;
  plans: PlanRow[];
  features: FeatureDef[];
}) {
  const set = (k: string, v: unknown) => onChange({ ...a, [k]: v });
  switch (a.type) {
    case 'notify_super_admins':
      return (
        <label className="field">
          Message ({'{organization}'}, {'{plan}'}, {'{endsAt}'}, {'{percent}'})
          <input value={String(a.message ?? '')} onChange={(e) => set('message', e.target.value)} />
        </label>
      );
    case 'email_org_admins':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <label className="field">
            Subject
            <input value={String(a.subject ?? '')} onChange={(e) => set('subject', e.target.value)} />
          </label>
          <label className="field">
            Message
            <textarea rows={2} value={String(a.message ?? '')} onChange={(e) => set('message', e.target.value)} />
          </label>
        </div>
      );
    case 'change_plan':
      return (
        <label className="field">
          New plan
          <select value={String(a.plan ?? '')} onChange={(e) => set('plan', e.target.value)}>
            <option value="">Choose…</option>
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      );
    case 'set_subscription':
      return (
        <div className="sa-form">
          <label className="field">
            Status
            <select value={String(a.status ?? '')} onChange={(e) => set('status', e.target.value || undefined)}>
              <option value="">No change</option>
              {STATUSES.filter(Boolean).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Extend by days
            <input
              type="number"
              min={1}
              value={Number(a.extendDays ?? '') || ''}
              onChange={(e) => set('extendDays', e.target.value ? Number(e.target.value) : undefined)}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={!!a.clearEnd} onChange={(e) => set('clearEnd', e.target.checked || undefined)} /> Remove end
            date
          </label>
        </div>
      );
    case 'suspend_org':
      return (
        <label className="field">
          Reason
          <input value={String(a.reason ?? '')} onChange={(e) => set('reason', e.target.value)} />
        </label>
      );
    case 'set_feature':
      return (
        <div className="sa-form">
          <label className="field">
            Feature
            <select value={String(a.feature ?? '')} onChange={(e) => set('feature', e.target.value)}>
              <option value="">Choose…</option>
              {features.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Where
            <select value={String(a.surface ?? 'both')} onChange={(e) => set('surface', e.target.value)}>
              <option value="both">Web and mobile</option>
              <option value="web">Web CRM</option>
              <option value="mobile">Mobile app</option>
            </select>
          </label>
          <label className="field">
            Switch
            <select value={a.on === false ? 'off' : 'on'} onChange={(e) => set('on', e.target.value === 'on')}>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
        </div>
      );
    default:
      return <span className="muted small">No settings.</span>;
  }
}

function RuleBuilder({
  vocab,
  plans,
  features,
  initial,
  onSave,
  onCancel,
}: {
  vocab: Vocabulary;
  plans: PlanRow[];
  features: FeatureDef[];
  initial: Omit<Rule, 'id' | 'summary' | 'runs' | 'lastRunAt'>;
  onSave: (r: Omit<Rule, 'id' | 'summary' | 'runs' | 'lastRunAt'>) => Promise<void>;
  onCancel: () => void;
}) {
  const [r, setR] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const trig = vocab.triggers.find((t) => t.key === r.trigger);
  const setParam = (k: keyof Params, v: unknown) =>
    setR({ ...r, params: { ...r.params, [k]: v === '' || v === undefined ? undefined : v } });
  const save = () =>
    onSave({ ...r, params: Object.fromEntries(Object.entries(r.params).filter(([, v]) => v !== undefined)) }).catch(setError);
  return (
    <div className="stack" data-testid="rule-builder">
      <label className="field">
        Rule name
        <input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} data-testid="rule-name" />
      </label>
      <h3 className="small" style={{ margin: 0 }}>
        1. When
      </h3>
      <div className="sa-form">
        <label className="field">
          Trigger
          <select value={r.trigger} onChange={(e) => setR({ ...r, trigger: e.target.value, params: {} })} data-testid="rule-trigger">
            {vocab.triggers.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {trig?.params.includes('days') ? (
          <label className="field">
            Days
            <input
              type="number"
              min={1}
              max={365}
              value={r.params.days ?? ''}
              onChange={(e) => setParam('days', e.target.value ? Number(e.target.value) : undefined)}
            />
          </label>
        ) : null}
        {trig?.params.includes('percent') ? (
          <label className="field">
            Percent
            <input
              type="number"
              min={1}
              max={100}
              value={r.params.percent ?? ''}
              onChange={(e) => setParam('percent', e.target.value ? Number(e.target.value) : undefined)}
            />
          </label>
        ) : null}
        {trig?.params.includes('status') ? (
          <label className="field">
            Only when the subscription is
            <select value={r.params.status ?? ''} onChange={(e) => setParam('status', e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s || 'any status'}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {trig ? (
        <p className="muted small" style={{ margin: 0 }}>
          {trig.help}
        </p>
      ) : null}
      <h3 className="small" style={{ margin: 0 }}>
        2. Then
      </h3>
      {r.actions.map((a, i) => (
        <div key={i} className="sa-action-row">
          <label className="field">
            Action {i + 1}
            <select
              value={a.type}
              onChange={(e) => setR({ ...r, actions: r.actions.map((x, n) => (n === i ? { type: e.target.value } : x)) })}
              data-testid={`rule-action-${i}`}
            >
              {vocab.actions.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <ActionFields
            a={a}
            plans={plans}
            features={features}
            onChange={(na) => setR({ ...r, actions: r.actions.map((x, n) => (n === i ? na : x)) })}
          />
          <button
            className="link"
            aria-label={`Remove action ${i + 1}`}
            onClick={() => setR({ ...r, actions: r.actions.filter((_, n) => n !== i) })}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <div>
        <button className="small" onClick={() => setR({ ...r, actions: [...r.actions, { type: 'notify_super_admins', message: '' }] })}>
          <Plus size={14} aria-hidden="true" /> Add action
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} /> Rule is on
      </label>
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" disabled={!r.name || !r.actions.length} onClick={() => void save()} data-testid="save-rule">
          Save rule
        </button>
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SuperAutomationPage() {
  const confirm = useConfirm();
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; organizations: Array<{ id: string; name: string; alreadyDone: boolean }> } | null>(
    null,
  );
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    void api<Rule[]>('/super/automation/rules').then(setRules, setError);
    void api<Run[]>('/super/automation/runs').then(setRuns, setError);
  }, []);
  useEffect(() => {
    load();
    void api<Vocabulary>('/super/automation/vocabulary').then(setVocab, setError);
    void api<PlanRow[]>('/super/plans').then(setPlans, setError);
    void api<FeatureDef[]>('/features').then(setFeatures, setError);
  }, [load]);

  const create = async (r: Omit<Rule, 'id' | 'summary' | 'runs' | 'lastRunAt'>) => {
    await api('/super/automation/rules', { body: r });
    setEditing(null);
    load();
  };
  const update = async (id: string, r: Partial<Rule>) => {
    await api(`/super/automation/rules/${id}`, { method: 'PATCH', body: r });
    setEditing(null);
    load();
  };
  const runNow = async (rule?: string) => {
    const r = await api<{ fired: number }>(`/super/automation/run${rule ? `?rule=${rule}` : ''}`, { method: 'POST' });
    setNote(r.fired ? `Ran for ${r.fired} organization(s).` : 'Nothing new matched. Each rule acts once per organization and event.');
    load();
  };
  const used = new Set(rules?.map((r) => r.name));

  return (
    <SuperAdminFrame
      help="sa.automation"
      title="Automation"
      intro="Let SampCode handle subscriptions on its own: warn before they end, suspend or downgrade when they end, start trials, and alert you about usage. Rules are checked every minute."
      actions={
        <>
          <button onClick={() => void runNow().catch(setError)} data-testid="run-all">
            <Play size={14} aria-hidden="true" /> Run all now
          </button>
          <button className="primary" onClick={() => setEditing('__new')} data-testid="new-rule">
            <Plus size={14} aria-hidden="true" /> New rule
          </button>
        </>
      }
    >
      <ErrorNote error={error} />
      {note ? (
        <p className="ok-text small" role="status">
          {note}
        </p>
      ) : null}

      {vocab ? (
        <section className="panel nx-card stack" data-testid="templates">
          <div className="nx-card-head">
            <h2>
              <Zap size={18} aria-hidden="true" /> Ready-made rules
              <InfoTip k="sa.readyRules" />
            </h2>
            <span className="muted small">One click adds the rule switched on. You can change it afterwards.</span>
          </div>
          <div className="sa-grid">
            {vocab.templates.map((t) => (
              <div key={t.id} className="sa-template" data-testid={`template-${t.id}`}>
                <h3>{t.rule.name}</h3>
                <p className="muted small" style={{ margin: 0 }}>
                  {t.description}
                </p>
                <div>
                  <button className="small primary" disabled={used.has(t.rule.name)} onClick={() => void create(t.rule).catch(setError)}>
                    {used.has(t.rule.name) ? 'Added' : 'Add this rule'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {editing === '__new' && vocab ? (
        <section className="panel nx-card" style={{ marginTop: 16 }}>
          <h2>
            New rule
            <InfoTip k="sa.newRule" />
          </h2>
          <RuleBuilder
            vocab={vocab}
            plans={plans}
            features={features}
            initial={{
              name: '',
              enabled: true,
              trigger: 'subscription_ending',
              params: { days: 7 },
              actions: [{ type: 'notify_super_admins', message: '' }],
            }}
            onSave={create}
            onCancel={() => setEditing(null)}
          />
        </section>
      ) : null}

      <section className="panel nx-card stack" style={{ marginTop: 16 }} data-testid="rules">
        <div className="nx-card-head">
          <h2>
            Your rules
            <InfoTip k="sa.yourRules" />
          </h2>
          <span className="muted small">{rules?.filter((r) => r.enabled).length ?? 0} on</span>
        </div>
        {rules && !rules.length ? <p className="muted small">No rules yet. Add a ready-made one above.</p> : null}
        {rules?.map((r) => (
          <div key={r.id} className="sa-template" data-testid={`rule-${r.name}`}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h3>{r.name}</h3>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => void update(r.id, { enabled: e.target.checked }).catch(setError)}
                  />{' '}
                  On
                </label>
                <button
                  className="small"
                  onClick={() =>
                    void api<{ organizations: Array<{ id: string; name: string; alreadyDone: boolean }> }>(
                      `/super/automation/rules/${r.id}/preview`,
                    ).then((p) => setPreview({ id: r.id, organizations: p.organizations }), setError)
                  }
                >
                  Who matches now?
                </button>
                <button className="small" onClick={() => void runNow(r.id).catch(setError)}>
                  Run now
                </button>
                <button className="small" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                  Edit
                </button>
                <button
                  className="small danger"
                  onClick={async () => {
                    if (await confirm({ title: `Delete the rule "${r.name}"?`, confirmLabel: 'Delete', tone: 'danger' }))
                      void api(`/super/automation/rules/${r.id}`, { method: 'DELETE' }).then(load, setError);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="small" style={{ margin: 0 }}>
              {r.summary}
            </p>
            <p className="muted small" style={{ margin: 0 }}>
              Ran {r.runs} time{r.runs === 1 ? '' : 's'} · last checked {ago(r.lastRunAt)}
            </p>
            {preview?.id === r.id ? (
              <div className="small" data-testid="rule-preview">
                {preview.organizations.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {preview.organizations.map((o) => (
                      <li key={o.id}>
                        <Link href={`/super-admin/organizations/${o.id}`}>{o.name}</Link>
                        {o.alreadyDone ? <span className="muted"> (already done)</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted">No organization matches right now.</span>
                )}
              </div>
            ) : null}
            {editing === r.id && vocab ? (
              <RuleBuilder
                vocab={vocab}
                plans={plans}
                features={features}
                initial={{ name: r.name, enabled: r.enabled, trigger: r.trigger, params: r.params, actions: r.actions }}
                onSave={(nr) => update(r.id, nr)}
                onCancel={() => setEditing(null)}
              />
            ) : null}
          </div>
        ))}
      </section>

      <section className="panel nx-card" style={{ marginTop: 16 }} data-testid="runs">
        <div className="nx-card-head">
          <h2>
            What automation did
            <InfoTip k="sa.autoRuns" />
          </h2>
        </div>
        {runs.length ? (
          <div className="scroll-x">
            <table className="data small">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Rule</th>
                  <th>Organization</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((x) => (
                  <tr key={x.id}>
                    <td>{fmtTime(x.at)}</td>
                    <td>{x.automation.name}</td>
                    <td>
                      <Link href={`/super-admin/organizations/${x.organization.id}`}>{x.organization.name ?? x.organization.id}</Link>
                    </td>
                    <td>
                      <span className={`badge ${x.outcome === 'ok' ? 'good' : x.outcome === 'partial' ? 'warn' : 'bad'}`}>{x.outcome}</span>
                      <div className="muted">{x.results.map((a) => a.detail).join(' · ')}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Nothing yet.</p>
        )}
      </section>
    </SuperAdminFrame>
  );
}
