'use client';
/** Outbound webhooks (administrators): subscribe a URL to events, see deliveries, test and redeliver. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CopyField, ErrorNote } from './Shell';
import { useConfirm } from '@/components/neon/ConfirmDialog';

interface Hook {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  createdAt: string;
  counts: Record<string, number>;
}

interface Delivery {
  id: string;
  event: string;
  state: 'PENDING' | 'DELIVERED' | 'FAILED' | 'DEAD';
  attempts: number;
  lastHttpStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

const EVENT_HELP: Record<string, string> = {
  'response.finished': 'a respondent or CAPI interview reaches an outcome',
  'response.review_decided': 'a complete is accepted or rejected in quality review',
  'survey.published': 'a new survey version is published',
  'survey.status_changed': 'a survey goes live, is paused or closed',
};

const STATE_CLASS: Record<Delivery['state'], string> = { DELIVERED: 'good', PENDING: 'warn', FAILED: 'bad', DEAD: 'bad' };

export function Webhooks() {
  const confirm = useConfirm();
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [form, setForm] = useState({ url: '', description: '', events: ['response.finished'] as string[] });
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setHooks(await api<Hook[]>('/webhooks'));
      setEvents(await api<string[]>('/webhook-events'));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const showDeliveries = useCallback(async (id: string) => {
    setOpen(id);
    setDeliveries(await api<Delivery[]>(`/webhooks/${id}/deliveries`));
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      if (open) await showDeliveries(open);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="panel stack wide" data-testid="webhooks">
      <h2>Webhooks</h2>
      <p className="muted small" style={{ margin: 0 }}>
        ZAPX sends a signed JSON POST for each event (header <span className="mono">X-Zapx-Signature</span>). Payloads carry ids, statuses
        and scores, never respondents&apos; answers. Failed deliveries are retried with backoff for about an hour.
      </p>
      {secret ? (
        <div className="callout stack" style={{ gap: 6 }} data-testid="webhook-secret">
          <strong>Signing secret for {secret.url}. Copy it now; it is not shown again.</strong>
          <CopyField label="Signing secret" value={secret.secret} />
          <button className="link" onClick={() => setSecret(null)}>
            I have stored it
          </button>
        </div>
      ) : null}
      {hooks.map((h) => (
        <div key={h.id} className="webhook-card stack" data-testid="webhook">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="mono small">{h.url}</span>
            <span className={`badge ${h.active ? 'good' : 'warn'}`}>{h.active ? 'active' : 'paused'}</span>
            <span className="muted small">
              {h.counts.DELIVERED ?? 0} delivered · {h.counts.PENDING ?? 0} waiting · {(h.counts.FAILED ?? 0) + (h.counts.DEAD ?? 0)} failed
            </span>
          </div>
          {h.description ? <span className="small">{h.description}</span> : null}
          <span className="small muted">Events: {h.events.join(', ')}</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button onClick={() => act(() => api(`/webhooks/${h.id}/test`, { method: 'POST' }))}>Send test event</button>
            <button onClick={() => void showDeliveries(h.id).catch(setError)}>Show deliveries</button>
            <button onClick={() => act(() => api(`/webhooks/${h.id}`, { method: 'PATCH', body: { active: !h.active } }))}>
              {h.active ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={() =>
                act(async () => {
                  if (
                    !(await confirm({
                      title: 'Rotate the signing secret?',
                      message: 'The receiver must switch to the new secret.',
                      confirmLabel: 'Rotate secret',
                      tone: 'danger',
                    }))
                  )
                    return;
                  setSecret({ url: h.url, ...(await api<{ secret: string }>(`/webhooks/${h.id}/rotate-secret`, { method: 'POST' })) });
                })
              }
            >
              Rotate secret
            </button>
            <button
              className="link"
              onClick={() =>
                act(async () => {
                  if (
                    !(await confirm({
                      title: 'Delete this webhook?',
                      message: `Events stop being sent to ${h.url}.`,
                      confirmLabel: 'Delete',
                      tone: 'danger',
                    }))
                  )
                    return;
                  await api(`/webhooks/${h.id}`, { method: 'DELETE' });
                  if (open === h.id) setOpen(null);
                })
              }
            >
              Delete
            </button>
          </div>
          {open === h.id ? (
            <table className="data small" data-testid="webhook-deliveries">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>State</th>
                  <th>Attempts</th>
                  <th>Last result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deliveries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No deliveries yet.
                    </td>
                  </tr>
                ) : null}
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.createdAt).toLocaleString()}</td>
                    <td className="mono">{d.event}</td>
                    <td>
                      <span className={`badge ${STATE_CLASS[d.state]}`}>{d.state.toLowerCase()}</span>
                    </td>
                    <td>{d.attempts}</td>
                    <td>{d.lastHttpStatus ? `HTTP ${d.lastHttpStatus}` : (d.lastError ?? '')}</td>
                    <td>
                      {d.state === 'FAILED' || d.state === 'DEAD' ? (
                        <button
                          className="link"
                          onClick={() => act(() => api(`/webhook-deliveries/${d.id}/redeliver`, { method: 'POST' }))}
                        >
                          Redeliver
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ))}
      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const h = await api<Hook & { secret: string }>('/webhooks', {
              body: { url: form.url, events: form.events, ...(form.description ? { description: form.description } : {}) },
            });
            setSecret({ url: h.url, secret: h.secret });
            setForm({ url: '', description: '', events: ['response.finished'] });
            await load();
          } catch (err) {
            setError(err);
          }
        }}
      >
        <strong className="small">Add a webhook</strong>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 2 }}>
            Endpoint URL
            <input
              required
              type="url"
              placeholder="https://example.com/zapx"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Description
            <input maxLength={200} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
        </div>
        {events.map((ev) => (
          <label key={ev} className="check">
            <input
              type="checkbox"
              checked={form.events.includes(ev)}
              onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter((x) => x !== ev) })}
            />
            <span className="mono small">{ev}</span> <span className="muted small">{EVENT_HELP[ev] ?? ''}</span>
          </label>
        ))}
        <div className="row">
          <button className="primary" disabled={form.events.length === 0}>
            Add webhook
          </button>
        </div>
      </form>
      <ErrorNote error={error} />
    </section>
  );
}
