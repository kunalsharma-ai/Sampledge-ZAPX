'use client';
/** CATI call list for a survey (Milestone 9): upload a sample, follow progress, reopen cases, erase numbers. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, upload } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { ErrorNote } from './Shell';

interface Summary {
  cases: Partial<Record<'PENDING' | 'CALLBACK' | 'IN_CALL' | 'DONE' | 'CLOSED', number>>;
  dueNow: number;
  dispositions: Record<string, number>;
  callsLast24h: Array<{ interviewer: string; calls: number }>;
}
interface CaseRow {
  id: string;
  code: string;
  name: string | null;
  phoneHint: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextCallAt: string;
  lastDisposition: string | null;
  closedReason: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'to call',
  CALLBACK: 'callback',
  IN_CALL: 'in a call',
  DONE: 'interviewed',
  CLOSED: 'closed',
};
const label = (s: string) => s.replace(/_/g, ' ');

export function CatiCalls({ surveyId, readOnly }: { surveyId: string; readOnly: boolean }) {
  const me = useMe();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [status, setStatus] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [maxAttempts, setMaxAttempts] = useState(6);
  const [result, setResult] = useState<{ added: number; skipped: Array<{ row: number; code: string; reason: string }> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        api<Summary>(`/surveys/${surveyId}/cati/summary`),
        api<CaseRow[]>(`/surveys/${surveyId}/cati/cases${status ? `?status=${status}` : ''}`),
      ]);
      setSummary(s);
      setCases(c);
    } catch (e) {
      setError(e);
    }
  }, [surveyId, status]);
  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (!file) return;
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('maxAttempts', String(maxAttempts));
      setResult(await upload(`/surveys/${surveyId}/cati/cases/upload`, form));
      setFile(null);
      if (input.current) input.current.value = '';
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const reopen = async (id: string) => {
    setError(null);
    try {
      await api(`/cati/cases/${id}/reopen`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const erase = async () => {
    if (!window.confirm('Erase the phone numbers of every interviewed or closed case? This cannot be undone. Call history is kept.'))
      return;
    setError(null);
    try {
      const r = await api<{ erased: number }>(`/surveys/${surveyId}/cati/erase-phones`, { method: 'POST' });
      setResult(null);
      window.alert(`Erased ${r.erased} phone numbers.`);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const total = summary ? Object.values(summary.cases).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <section className="panel stack" data-testid="cati-calls">
      <h2 style={{ margin: 0 }}>Phone interviews (CATI)</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Upload the people to call. Assigned interviewers work the list from Calls: callbacks come first, no answer and busy are retried
        later, and a case closes after the maximum attempts. Phone numbers are stored encrypted and shown only to the interviewer on the
        call.
      </p>
      {summary ? (
        <div className="row small" data-testid="cati-summary" style={{ flexWrap: 'wrap', gap: 12 }}>
          <span>
            <strong>{total}</strong> in the list
          </span>
          <span>
            <strong>{summary.dueNow}</strong> due now
          </span>
          {Object.entries(STATUS_LABEL).map(([k, l]) => (
            <span key={k}>
              <strong>{summary.cases[k as keyof Summary['cases']] ?? 0}</strong> {l}
            </span>
          ))}
          {summary.callsLast24h.length ? (
            <span className="muted">Calls in 24 h: {summary.callsLast24h.map((r) => `${r.interviewer} ${r.calls}`).join(', ')}</span>
          ) : null}
        </div>
      ) : null}
      {!readOnly ? (
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field">
            Call list (CSV with id and phone columns)
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              aria-label="Call list file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            Max attempts
            <input
              type="number"
              min={1}
              max={20}
              value={maxAttempts}
              style={{ width: 80 }}
              onChange={(e) => setMaxAttempts(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <button className="primary" disabled={!file} onClick={send}>
            Add to call list
          </button>
          {me?.role === 'ADMIN' ? (
            <button className="danger" onClick={erase}>
              Erase finished phone numbers
            </button>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div className="small" role="status" data-testid="cati-upload-result">
          Added {result.added}.{' '}
          {result.skipped.length
            ? `Skipped ${result.skipped.length}: ${result.skipped
                .slice(0, 5)
                .map((s) => `row ${s.row} (${s.reason})`)
                .join('; ')}`
            : ''}
        </div>
      ) : null}
      <ErrorNote error={error} />
      <div className="row">
        <label className="field">
          Show
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All cases</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {cases.length ? (
        <div className="scroll-x">
          <table className="data small" data-testid="cati-cases">
            <thead>
              <tr>
                <th>Id</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last outcome</th>
                <th>Next call</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td>{c.name ?? '—'}</td>
                  <td className="mono">{c.phoneHint}</td>
                  <td>
                    <span
                      className={`badge ${c.status === 'DONE' ? 'good' : c.status === 'CLOSED' ? 'bad' : c.status === 'CALLBACK' ? 'warn' : ''}`}
                    >
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td>
                    {c.attempts} / {c.maxAttempts}
                  </td>
                  <td>{c.closedReason ? label(c.closedReason) : c.lastDisposition ? label(c.lastDisposition) : '—'}</td>
                  <td>{c.status === 'PENDING' || c.status === 'CALLBACK' ? new Date(c.nextCallAt).toLocaleString() : '—'}</td>
                  <td>
                    {c.status === 'CLOSED' && !readOnly && c.phoneHint !== 'erased' ? (
                      <button className="link" onClick={() => reopen(c.id)}>
                        Reopen {c.code}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No cases{status ? ' with this status' : ' yet'}.</p>
      )}
    </section>
  );
}
