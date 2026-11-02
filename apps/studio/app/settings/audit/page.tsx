'use client';
/** The organization's audit trail (administrators): filter, page through and export as CSV. */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { ErrorNote, Shell } from '@/components/Shell';

interface Event {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  actor: { id: string; name: string; email: string | null } | null;
}

interface Member {
  id: string;
  name: string;
}

const ENTITY_TYPES = ['project', 'survey', 'vendor', 'response', 'user', 'api_key', 'webhook', 'tenant', 'device'];

function query(f: Record<string, string>, extra: Record<string, string> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) q.set(k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v);
  return q.toString();
}

export default function AuditPage() {
  const me = useMe();
  const [filter, setFilter] = useState({ action: '', entityType: '', actorId: '', from: '', to: '' });
  const [items, setItems] = useState<Event[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (f: typeof filter, after?: string) => {
    setError(null);
    try {
      const page = await api<{ items: Event[]; next: string | null }>(`/audit?${query(f, { take: '50', ...(after ? { after } : {}) })}`);
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setNext(page.next);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    if (me?.role !== 'ADMIN') return;
    void load(filter);
    api<string[]>('/audit/actions').then(setActions).catch(setError);
    api<Member[]>('/users').then(setTeam).catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, load]);

  const crumbs = (
    <>
      <Link href="/">Projects</Link> / <Link href="/settings">Settings</Link>
    </>
  );
  if (me && me.role !== 'ADMIN')
    return (
      <Shell crumbs={crumbs}>
        <p className="muted">Only administrators can see the audit log.</p>
      </Shell>
    );

  const set = (k: keyof typeof filter, v: string) => setFilter({ ...filter, [k]: v });

  return (
    <Shell crumbs={crumbs}>
      <h1>Audit log</h1>
      <p className="muted">Every change in the organization, newest first. Audit events cannot be edited or deleted.</p>
      <form
        className="panel audit-filters"
        data-testid="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load(filter);
        }}
      >
        <label className="field">
          Action
          <select value={filter.action} onChange={(e) => set('action', e.target.value)}>
            <option value="">Any action</option>
            {[...new Set(actions.map((a) => `${a.split('.')[0]}.`))].map((g) => (
              <option key={g} value={g}>
                {g}* (all)
              </option>
            ))}
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Entity type
          <select value={filter.entityType} onChange={(e) => set('entityType', e.target.value)}>
            <option value="">Any</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Who
          <select value={filter.actorId} onChange={(e) => set('actorId', e.target.value)}>
            <option value="">Anyone</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <input type="datetime-local" value={filter.from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="field">
          To
          <input type="datetime-local" value={filter.to} onChange={(e) => set('to', e.target.value)} />
        </label>
        <button className="primary">Apply filters</button>
        <a className="btn" href={`/api/audit/export.csv?${query(filter)}`} download>
          Download CSV
        </a>
      </form>
      <ErrorNote error={error} />
      <table className="data small" style={{ marginTop: 16 }} data-testid="audit-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Who</th>
            <th>Action</th>
            <th>On</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No events match these filters.
              </td>
            </tr>
          ) : null}
          {items.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
              <td>
                {e.actor ? e.actor.name : <span className="muted">system</span>}
                {e.data.viaApiKey ? <div className="muted">via API key</div> : null}
              </td>
              <td className="mono">{e.action}</td>
              <td>
                {e.entityType} <span className="mono muted">{e.entityId.slice(0, 10)}</span>
              </td>
              <td className="audit-details">{Object.keys(e.data).length ? JSON.stringify(e.data).slice(0, 400) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {next ? (
        <p>
          <button onClick={() => void load(filter, next)}>Load more</button>
        </p>
      ) : null}
    </Shell>
  );
}
