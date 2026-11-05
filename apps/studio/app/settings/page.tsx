'use client';
/**
 * Organization settings (administrators): AI permissions, limits and usage, redirect defaults, the
 * team, API keys, webhooks and the audit log. Programmers see only their own API keys here.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useThemeModule } from '@/lib/theme/ThemeProvider';
import { ErrorNote, Shell } from '@/components/Shell';
import { LayerEditor, emptyLayer, type Layer } from '@/components/RedirectRules';
import { Team } from '@/components/Team';
import { ApiKeys } from '@/components/ApiKeys';
import { Webhooks } from '@/components/Webhooks';
import { DataGovernance } from '@/components/DataGovernance';
import { Billing, PlanUsage, ScimSettings, SsoSettings } from '@/components/Identity';

type Task = 'architect' | 'translate' | 'insights';
const TASK_NAMES: Record<Task, string> = {
  architect: 'AI Survey Architect (build and edit surveys)',
  translate: 'AI translation',
  insights: 'AI research assistant (reads computed tables)',
};

interface Policy {
  enabled: boolean;
  allowedTasks: Task[];
  requestsPerMinute: number;
  requestsPerDay: number;
  monthlyBudgetUsd: number;
  redactPii: boolean;
  isDefault: boolean;
}

interface AiSettings {
  policy: Policy;
  tasks: Task[];
  status: { configured: boolean; provider: string; tasks: Record<Task, { model: string | null; permitted: boolean }> };
}

interface Usage {
  totalCostUsd: number;
  totalCalls: number;
  groups: Array<{
    task: string;
    model: string;
    outcome: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  recent: Array<{
    id: string;
    createdAt: string;
    task: string;
    model: string;
    outcome: string;
    latencyMs: number;
    costUsd: number;
    redactions: number;
  }>;
}

const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export default function SettingsPage() {
  const me = useMe();
  useThemeModule('settings');
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (me?.role !== 'ADMIN') return;
    try {
      const s = await api<AiSettings>('/organization/ai');
      setAi(s);
      setPolicy(s.policy);
      setUsage(await api<Usage>('/organization/ai/usage'));
      setLayer({ ...emptyLayer(), ...(await api<Layer>('/organization/redirect-defaults')) });
    } catch (e) {
      setError(e);
    }
  }, [me]);
  useEffect(() => {
    void load();
  }, [load]);

  if (me && me.role === 'PROGRAMMER') {
    return (
      <Shell crumbs={<Link href="/">Dashboard</Link>}>
        <h1>API keys</h1>
        <ApiKeys isAdmin={false} />
      </Shell>
    );
  }
  if (me && me.role !== 'ADMIN') {
    return (
      <Shell crumbs={<Link href="/">Dashboard</Link>}>
        <p className="muted">Only administrators can change organization settings.</p>
      </Shell>
    );
  }

  const savePolicy = async () => {
    if (!policy) return;
    setError(null);
    setSaved(false);
    try {
      const { isDefault: _isDefault, ...body } = policy;
      const s = await api<AiSettings>('/organization/ai', { method: 'PUT', body });
      setAi(s);
      setPolicy(s.policy);
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Shell crumbs={<Link href="/">Dashboard</Link>}>
      <div className="row">
        <h1 style={{ margin: 0 }}>Organization settings</h1>
        <div style={{ flex: 1 }} />
        <Link href="/settings/audit" className="btn">
          Audit log
        </Link>
      </div>
      <ErrorNote error={error} />
      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="panel stack" data-testid="ai-settings">
          <h2>AI</h2>
          {ai ? (
            <p className="small muted" style={{ margin: 0 }}>
              {ai.status.configured
                ? `Provider: ${ai.status.provider}. Models: ${ai.tasks.map((t) => `${t} → ${ai.status.tasks[t].model}`).join(', ')}.`
                : 'AI is not configured on this server (ANTHROPIC_API_KEY and AI_MODEL). These settings apply once it is.'}
            </p>
          ) : null}
          {policy ? (
            <>
              <label className="check">
                <input type="checkbox" checked={policy.enabled} onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })} />
                Allow AI features in this organization
              </label>
              {(ai?.tasks ?? []).map((t) => (
                <label key={t} className="check" style={{ marginLeft: 20 }}>
                  <input
                    type="checkbox"
                    disabled={!policy.enabled}
                    checked={policy.allowedTasks.includes(t)}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        allowedTasks: e.target.checked ? [...policy.allowedTasks, t] : policy.allowedTasks.filter((x) => x !== t),
                      })
                    }
                  />
                  {TASK_NAMES[t]}
                </label>
              ))}
              <div className="row">
                <label className="field">
                  Requests per minute
                  <input
                    type="number"
                    min={0}
                    value={policy.requestsPerMinute}
                    onChange={(e) => setPolicy({ ...policy, requestsPerMinute: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  />
                </label>
                <label className="field">
                  Requests per day
                  <input
                    type="number"
                    min={0}
                    value={policy.requestsPerDay}
                    onChange={(e) => setPolicy({ ...policy, requestsPerDay: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  />
                </label>
                <label className="field">
                  Monthly budget (USD, 0 = no cap)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={policy.monthlyBudgetUsd}
                    onChange={(e) => setPolicy({ ...policy, monthlyBudgetUsd: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={policy.redactPii} onChange={(e) => setPolicy({ ...policy, redactPii: e.target.checked })} />
                Remove e-mail addresses, phone, card and IBAN numbers from briefs and text documents before they are sent (PDFs are sent as
                they are)
              </label>
              <p className="muted small" style={{ margin: 0 }}>
                AI never changes a survey by itself: proposals and machine translations wait for a person to review them. 0 means no limit.
              </p>
              <div className="row">
                <button className="primary" onClick={savePolicy}>
                  Save AI settings
                </button>
                {saved ? <span className="ok-text small">Saved</span> : null}
                {policy.isDefault ? <span className="muted small">Using server defaults until you save.</span> : null}
              </div>
            </>
          ) : null}
          <h3 style={{ marginTop: 12 }}>Usage this month</h3>
          {usage ? (
            <>
              <p className="small" data-testid="ai-usage-total">
                {usage.totalCalls} calls · {money(usage.totalCostUsd)} estimated
              </p>
              {usage.groups.length ? (
                <table className="data small">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Model</th>
                      <th>Outcome</th>
                      <th>Calls</th>
                      <th>Tokens in / out</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.groups.map((g) => (
                      <tr key={`${g.task}-${g.model}-${g.outcome}`}>
                        <td>{g.task}</td>
                        <td className="mono">{g.model}</td>
                        <td>{g.outcome.replace('_', ' ')}</td>
                        <td>{g.calls}</td>
                        <td>
                          {g.inputTokens.toLocaleString()} / {g.outputTokens.toLocaleString()}
                        </td>
                        <td>{money(g.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">No AI calls yet.</p>
              )}
              <p className="muted small">
                Costs use the price list the server is configured with (AI_PRICING) and are estimates, not an invoice.
              </p>
            </>
          ) : null}
        </section>

        <section className="panel stack" data-testid="org-redirect-defaults">
          <h2>Organization redirect defaults</h2>
          <p className="muted small" style={{ margin: 0 }}>
            The last fallback for direct vendors, after vendor + country, vendor, project + country and project settings.
          </p>
          {layer ? (
            <LayerEditor
              scope="organization"
              initial={layer}
              onSave={async (l) => {
                setLayer(await api<Layer>('/organization/redirect-defaults', { method: 'PUT', body: l }));
              }}
            />
          ) : null}
        </section>

        <DataGovernance />
        <PlanUsage />
        <Billing />
        <Team />
        <SsoSettings />
        <ScimSettings />
        <ApiKeys isAdmin />
        <Webhooks />
      </div>
    </Shell>
  );
}
