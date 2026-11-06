'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, Play, Plus, Trash2, Workflow, X } from 'lucide-react';
import { Shell, ErrorNote } from '@/components/Shell';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useThemeModule } from '@/lib/theme/ThemeProvider';
import { PageHeader } from '@/components/neon/PageHeader';
import { useConfirm } from '@/components/neon/ConfirmDialog';
import { InfoTip } from '@/components/neon/InfoTip';

type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
interface Condition {
  field: string;
  op: Op;
  value: number | string;
}
type Action =
  | { type: 'notify'; to: Audience; message?: string }
  | { type: 'email'; to: Audience; message?: string }
  | { type: 'webhook' }
  | { type: 'set_survey_status'; status: 'LIVE' | 'PAUSED' | 'CLOSED' };
type Audience = 'admins' | 'project_team' | 'rule_owner';
interface Schedule {
  every: 'hour' | 'day' | 'week';
  at?: string;
  weekday?: number;
}
interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  surveyId: string | null;
  trigger: string;
  schedule: Schedule | null;
  conditions: Condition[];
  actions: Action[];
  requiresApproval: boolean;
  cooldownMinutes: number;
  description: string;
  nextRunAt: string | null;
  lastFiredAt: string | null;
  runs: Record<string, number>;
}
interface Run {
  id: string;
  ruleId: string;
  ruleName: string;
  event: string;
  summary: string;
  state: string;
  note: string | null;
  results: Array<{ type: string; ok: boolean; detail: string }> | null;
  createdAt: string;
}
interface SurveyOption {
  id: string;
  name: string;
  project: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  'response.finished': 'A respondent finishes',
  'response.review_decided': 'A quality review is decided',
  'quota.full': 'A quota fills up',
  'survey.published': 'A version is published',
  'survey.status_changed': 'The survey status changes',
  schedule: 'On a schedule',
};
const FIELDS: Array<{ value: string; label: string; numeric: boolean; events?: string[] }> = [
  { value: 'event.status', label: 'Finish status', numeric: false, events: ['response.finished', 'response.review_decided'] },
  { value: 'event.qualityScore', label: 'Quality score', numeric: true, events: ['response.finished', 'response.review_decided'] },
  { value: 'event.vendor', label: 'Source (vendor code)', numeric: false, events: ['response.finished'] },
  { value: 'event.mode', label: 'Mode (CAWI, CAPI, CATI)', numeric: false, events: ['response.finished'] },
  { value: 'event.quotaId', label: 'Quota id', numeric: false, events: ['quota.full'] },
  { value: 'event.to', label: 'New status', numeric: false, events: ['survey.status_changed'] },
  { value: 'metrics.completes', label: 'Completes', numeric: true },
  { value: 'metrics.completesToday', label: 'Completes today (UTC)', numeric: true },
  { value: 'metrics.incidence', label: 'Incidence %', numeric: true },
  { value: 'metrics.qualityFailRate', label: 'Quality fail rate %', numeric: true },
  { value: 'metrics.hoursSinceLastComplete', label: 'Hours since last complete', numeric: true },
];
const OPS: Array<{ value: Op; label: string }> = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'gt', label: 'is above' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is below' },
  { value: 'lte', label: 'is at most' },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATE_TONE: Record<string, string> = {
  done: 'good',
  skipped: '',
  awaiting_approval: 'warn',
  rejected: 'rejected',
  failed: 'bad',
  pending: '',
  running: '',
};

const blank = (): Omit<Rule, 'id' | 'description' | 'nextRunAt' | 'lastFiredAt' | 'runs'> => ({
  name: '',
  enabled: true,
  surveyId: null,
  trigger: 'quota.full',
  schedule: null,
  conditions: [],
  actions: [{ type: 'notify', to: 'admins' }],
  requiresApproval: false,
  cooldownMinutes: 0,
});

/**
 * Blueprint phase 5: automation rules. When a survey event happens (or on a schedule) and the
 * conditions hold, SampCode notifies people, emails them, sends a webhook or changes the survey's
 * status, optionally only after an administrator approves. Every run is logged here.
 */
export default function AutomationPage() {
  const confirm = useConfirm();
  const me = useMe();
  useThemeModule('settings');
  const canEdit = me?.role === 'ADMIN' || me?.role === 'PROGRAMMER';
  const isAdmin = me?.role === 'ADMIN';
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [surveys, setSurveys] = useState<SurveyOption[]>([]);
  const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dry, setDry] = useState<{ id: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, x] = await Promise.all([api<Rule[]>('/automation/rules'), api<Run[]>('/automation/runs')]);
      setRules(r);
      setRuns(x);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
    void api<SurveyOption[]>('/automation/surveys').then(setSurveys, () => undefined);
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('surveyId');
    if (sid) setDraft({ ...blank(), surveyId: sid });
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      if (editing) await api(`/automation/rules/${editing}`, { method: 'PATCH', body: draft });
      else await api('/automation/rules', { body: draft });
      setDraft(null);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const surveyName = (id: string | null) => (id ? (surveys.find((s) => s.id === id)?.name ?? 'A survey') : 'Every survey');
  const waiting = runs.filter((r) => r.state === 'awaiting_approval');

  return (
    <Shell crumbs={<span>Automation</span>}>
      <PageHeader
        icon={Workflow}
        tone={1}
        eyebrow="Rules & schedules"
        title="Automation"
        help="page.automation"
        actions={
          canEdit && !draft ? (
            <button className="primary" onClick={() => setDraft(blank())} data-testid="new-rule">
              <Plus size={15} aria-hidden /> New rule
            </button>
          ) : null
        }
      >
        Rules that act on survey events or on a schedule: notify the team, email them, send a webhook, or pause or close a survey. A rule
        can wait for an administrator to approve before it acts.
      </PageHeader>
      <ErrorNote error={error} />

      {waiting.length ? (
        <section className="panel" data-testid="approvals">
          <h2>
            Waiting for approval
            <InfoTip k="section.autoApprovals" />
          </h2>
          <ul className="nx-list">
            {waiting.map((r) => (
              <li key={r.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <span>
                  <strong>{r.ruleName}</strong>
                  <span className="muted small"> · {r.summary}</span>
                </span>
                {isAdmin ? (
                  <span className="row" style={{ gap: 6 }}>
                    <button
                      className="primary"
                      onClick={async () => {
                        await api(`/automation/runs/${r.id}/approve`, { method: 'POST' }).catch(setError);
                        await load();
                      }}
                    >
                      <Check size={14} aria-hidden /> Approve
                    </button>
                    <button
                      onClick={async () => {
                        await api(`/automation/runs/${r.id}/reject`, { method: 'POST' }).catch(setError);
                        await load();
                      }}
                    >
                      <X size={14} aria-hidden /> Reject
                    </button>
                  </span>
                ) : (
                  <span className="muted small">An administrator approves</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {draft ? (
        <RuleEditor
          draft={draft}
          setDraft={setDraft}
          surveys={surveys}
          onSave={save}
          onCancel={() => {
            setDraft(null);
            setEditing(null);
          }}
          editing={!!editing}
        />
      ) : null}

      <section className="panel">
        <h2>
          Rules
          <InfoTip k="section.autoRules" />
        </h2>
        {rules && !rules.length ? <p className="muted">No rules yet.</p> : null}
        <div className="nx-rule-list" data-testid="rules">
          {rules?.map((r) => (
            <article key={r.id} className="nx-rule" data-testid={`rule-${r.name}`}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>{r.name}</strong>
                <span className="row small" style={{ gap: 6 }}>
                  <span className={`badge ${r.enabled ? 'good' : ''}`}>{r.enabled ? 'On' : 'Off'}</span>
                  <span className="badge">{surveyName(r.surveyId)}</span>
                </span>
              </div>
              <p className="small" data-testid="rule-description">
                {r.description}
              </p>
              <div className="row small muted" style={{ gap: 12, flexWrap: 'wrap' }}>
                {r.nextRunAt ? <span>Next run {new Date(r.nextRunAt).toLocaleString()}</span> : null}
                {r.lastFiredAt ? <span>Last fired {new Date(r.lastFiredAt).toLocaleString()}</span> : <span>Not fired yet</span>}
                {Object.entries(r.runs).map(([k, n]) => (
                  <span key={k}>
                    {k.replace('_', ' ')}: {n}
                  </span>
                ))}
              </div>
              {dry?.id === r.id ? (
                <p className="small" data-testid="dry-run">
                  {dry.text}
                </p>
              ) : null}
              {canEdit ? (
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button
                    onClick={() => {
                      setEditing(r.id);
                      setDraft({
                        name: r.name,
                        enabled: r.enabled,
                        surveyId: r.surveyId,
                        trigger: r.trigger,
                        schedule: r.schedule,
                        conditions: r.conditions,
                        actions: r.actions,
                        requiresApproval: r.requiresApproval,
                        cooldownMinutes: r.cooldownMinutes,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      await api(`/automation/rules/${r.id}`, { method: 'PATCH', body: { enabled: !r.enabled } }).catch(setError);
                      await load();
                    }}
                  >
                    {r.enabled ? 'Switch off' : 'Switch on'}
                  </button>
                  <button
                    title="Check the conditions against the survey's numbers now, without acting"
                    onClick={async () => {
                      try {
                        const res = await api<{ wouldRun: boolean; conditions: Array<{ field: string; actual: unknown; ok: boolean }> }>(
                          `/automation/rules/${r.id}/dry-run`,
                          { body: {} },
                        );
                        const seen = res.conditions
                          .map((c) => `${c.field} = ${String(c.actual ?? 'none')}${c.ok ? '' : ' (no)'}`)
                          .join('; ');
                        setDry({ id: r.id, text: `${res.wouldRun ? 'Would run now' : 'Would not run now'}${seen ? `: ${seen}` : ''}.` });
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    <Play size={14} aria-hidden /> Check now
                  </button>
                  <button
                    aria-label={`Delete rule ${r.name}`}
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete the rule "${r.name}"?`, confirmLabel: 'Delete', tone: 'danger' }))) return;
                      await api(`/automation/rules/${r.id}`, { method: 'DELETE' }).catch(setError);
                      await load();
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>
          Recent runs
          <InfoTip k="section.autoRuns" />
        </h2>
        {!runs.length ? <p className="muted">Nothing has run yet.</p> : null}
        <table className="table" data-testid="runs">
          <thead>
            <tr>
              <th>When</th>
              <th>Rule</th>
              <th>What happened</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 50).map((r) => (
              <tr key={r.id}>
                <td className="small">{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.ruleName}</td>
                <td className="small">
                  {r.summary}
                  {r.note ? <div className="muted">{r.note}</div> : null}
                </td>
                <td className="small">
                  <span className={`badge ${STATE_TONE[r.state] ?? ''}`}>{r.state.replace('_', ' ')}</span>
                  {r.results?.map((x, i) => (
                    <div key={i} className={x.ok ? '' : 'error-text'}>
                      {x.detail}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Shell>
  );
}

function RuleEditor({
  draft,
  setDraft,
  surveys,
  onSave,
  onCancel,
  editing,
}: {
  draft: ReturnType<typeof blank>;
  setDraft: (d: ReturnType<typeof blank>) => void;
  surveys: SurveyOption[];
  onSave: () => void;
  onCancel: () => void;
  editing: boolean;
}) {
  const set = (patch: Partial<ReturnType<typeof blank>>) => setDraft({ ...draft, ...patch });
  const fields = FIELDS.filter((f) => (draft.trigger === 'schedule' ? !f.events : !f.events || f.events.includes(draft.trigger)));
  const setAction = (i: number, a: Action) => set({ actions: draft.actions.map((x, k) => (k === i ? a : x)) });
  return (
    <section className="panel" data-testid="rule-editor">
      <h2>
        {editing ? 'Edit rule' : 'New rule'}
        <InfoTip k="section.autoEditor" />
      </h2>
      <div className="grid2">
        <label>
          Name
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Pause when the quota fills" />
        </label>
        <label>
          Survey
          <select value={draft.surveyId ?? ''} onChange={(e) => set({ surveyId: e.target.value || null })} aria-label="Survey">
            <option value="">Every survey</option>
            {surveys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.project})
              </option>
            ))}
          </select>
        </label>
        <label>
          When
          <select
            aria-label="Trigger"
            value={draft.trigger}
            onChange={(e) =>
              set({
                trigger: e.target.value,
                schedule: e.target.value === 'schedule' ? (draft.schedule ?? { every: 'day', at: '09:00' }) : null,
                conditions: [],
              })
            }
          >
            {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {draft.schedule ? (
          <div className="row" style={{ gap: 8, alignItems: 'end' }}>
            <label>
              Every
              <select
                aria-label="Every"
                value={draft.schedule.every}
                onChange={(e) =>
                  set({
                    schedule: {
                      ...draft.schedule!,
                      every: e.target.value as Schedule['every'],
                      weekday: e.target.value === 'week' ? (draft.schedule!.weekday ?? 1) : undefined,
                    },
                  })
                }
              >
                <option value="hour">hour</option>
                <option value="day">day</option>
                <option value="week">week</option>
              </select>
            </label>
            {draft.schedule.every === 'week' ? (
              <label>
                On
                <select
                  aria-label="Weekday"
                  value={draft.schedule.weekday ?? 1}
                  onChange={(e) => set({ schedule: { ...draft.schedule!, weekday: Number(e.target.value) } })}
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              At (UTC)
              <input
                type="time"
                aria-label="Time"
                value={draft.schedule.at ?? '09:00'}
                onChange={(e) => set({ schedule: { ...draft.schedule!, at: e.target.value } })}
              />
            </label>
          </div>
        ) : null}
      </div>

      <h3>Only if</h3>
      {draft.conditions.map((c, i) => {
        const f = FIELDS.find((x) => x.value === c.field);
        return (
          <div key={i} className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            <select
              aria-label={`Condition ${i + 1} field`}
              value={c.field}
              onChange={(e) => set({ conditions: draft.conditions.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)) })}
            >
              {fields.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
            <select
              aria-label={`Condition ${i + 1} comparison`}
              value={c.op}
              onChange={(e) => set({ conditions: draft.conditions.map((x, k) => (k === i ? { ...x, op: e.target.value as Op } : x)) })}
            >
              {OPS.filter((o) => f?.numeric || o.value === 'eq' || o.value === 'ne').map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              aria-label={`Condition ${i + 1} value`}
              value={String(c.value)}
              onChange={(e) =>
                set({
                  conditions: draft.conditions.map((x, k) =>
                    k === i
                      ? {
                          ...x,
                          value:
                            f?.numeric && e.target.value.trim() !== '' && !Number.isNaN(Number(e.target.value))
                              ? Number(e.target.value)
                              : e.target.value,
                        }
                      : x,
                  ),
                })
              }
            />
            <button
              aria-label={`Remove condition ${i + 1}`}
              onClick={() => set({ conditions: draft.conditions.filter((_, k) => k !== i) })}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
      <button
        onClick={() =>
          set({ conditions: [...draft.conditions, { field: fields[0]!.value, op: fields[0]!.numeric ? 'gte' : 'eq', value: '' }] })
        }
      >
        <Plus size={14} aria-hidden /> Add condition
      </button>

      <h3>Then</h3>
      {draft.actions.map((a, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <select
            aria-label={`Action ${i + 1}`}
            value={a.type}
            onChange={(e) => {
              const t = e.target.value as Action['type'];
              setAction(
                i,
                t === 'webhook' ? { type: t } : t === 'set_survey_status' ? { type: t, status: 'PAUSED' } : { type: t, to: 'admins' },
              );
            }}
          >
            <option value="notify">Notify in SampCode</option>
            <option value="email">Email</option>
            <option value="webhook">Send the automation.fired webhook</option>
            <option value="set_survey_status">Change the survey status</option>
          </select>
          {a.type === 'notify' || a.type === 'email' ? (
            <>
              <select
                aria-label={`Action ${i + 1} recipients`}
                value={a.to}
                onChange={(e) => setAction(i, { ...a, to: e.target.value as Audience })}
              >
                <option value="admins">administrators</option>
                <option value="project_team">the project team</option>
                <option value="rule_owner">me (the rule owner)</option>
              </select>
              <input
                aria-label={`Action ${i + 1} message`}
                placeholder="Message (optional; the event is described otherwise)"
                value={a.message ?? ''}
                onChange={(e) => setAction(i, { ...a, message: e.target.value || undefined })}
                style={{ minWidth: 260 }}
              />
            </>
          ) : null}
          {a.type === 'set_survey_status' ? (
            <select
              aria-label={`Action ${i + 1} status`}
              value={a.status}
              onChange={(e) => setAction(i, { ...a, status: e.target.value as 'LIVE' | 'PAUSED' | 'CLOSED' })}
            >
              <option value="PAUSED">Pause</option>
              <option value="CLOSED">Close</option>
              <option value="LIVE">Go live</option>
            </select>
          ) : null}
          {draft.actions.length > 1 ? (
            <button aria-label={`Remove action ${i + 1}`} onClick={() => set({ actions: draft.actions.filter((_, k) => k !== i) })}>
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>
      ))}
      {draft.actions.length < 5 ? (
        <button onClick={() => set({ actions: [...draft.actions, { type: 'notify', to: 'admins' }] })}>
          <Plus size={14} aria-hidden /> Add action
        </button>
      ) : null}

      <div className="row" style={{ gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={draft.requiresApproval} onChange={(e) => set({ requiresApproval: e.target.checked })} />
          An administrator approves before it acts
        </label>
        <label className="row" style={{ gap: 6 }}>
          At most once every
          <input
            type="number"
            min={0}
            aria-label="Cooldown minutes"
            style={{ width: 80 }}
            value={draft.cooldownMinutes}
            onChange={(e) => set({ cooldownMinutes: Math.max(0, Number(e.target.value) || 0) })}
          />
          minutes (0: every time)
        </label>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="primary" onClick={onSave} data-testid="save-rule">
          Save rule
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
