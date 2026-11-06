'use client';
/**
 * CATI call list for a survey (Milestone 9): upload a sample, follow progress, reopen cases, erase numbers.
 * Milestone 18: calling hours in the respondent's time zone, and the organization's do-not-call list.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, upload } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { ErrorNote } from './Shell';
import { useConfirm } from '@/components/neon/ConfirmDialog';
import { InfoTip } from '@/components/neon/InfoTip';

interface Summary {
  cases: Partial<Record<'PENDING' | 'CALLBACK' | 'IN_CALL' | 'DONE' | 'CLOSED', number>>;
  dueNow: number;
  dispositions: Record<string, number>;
  callsLast24h: Array<{ interviewer: string; calls: number }>;
  doNotCall: number;
  callingHours: { timeZone: string; from: string; until: string; days: number[] } | null;
  withinHoursNow: boolean;
}
interface Hours {
  set: boolean;
  timeZone: string;
  from: string;
  until: string;
  days: number[];
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Africa/Johannesburg',
];
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
  const confirm = useConfirm();
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
    if (
      !(await confirm({
        title: 'Erase the phone numbers of every interviewed or closed case?',
        message: 'This cannot be undone. Call history is kept.',
        confirmLabel: 'Erase numbers',
        tone: 'danger',
      }))
    )
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
      <h2 style={{ margin: 0 }}>
        Phone interviews (CATI)
        <InfoTip k="section.cati" />
      </h2>
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
          {summary.doNotCall ? (
            <span className="warn-text" data-testid="cati-dnc-count">
              <strong>{summary.doNotCall}</strong> on the do-not-call list (never offered)
            </span>
          ) : null}
          {summary.callsLast24h.length ? (
            <span className="muted">Calls in 24 h: {summary.callsLast24h.map((r) => `${r.interviewer} ${r.calls}`).join(', ')}</span>
          ) : null}
        </div>
      ) : null}
      <CallingHours surveyId={surveyId} readOnly={readOnly} onSaved={load} withinNow={summary?.withinHoursNow ?? true} />
      <DialerSettings surveyId={surveyId} readOnly={readOnly} />
      {!readOnly ? (
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field">
            Call list (CSV with id and phone columns, optional timezone)
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

/** When cases may be called, in each respondent's local time (Milestone 18). */
function CallingHours({
  surveyId,
  readOnly,
  onSaved,
  withinNow,
}: {
  surveyId: string;
  readOnly: boolean;
  onSaved: () => Promise<void>;
  withinNow: boolean;
}) {
  const [h, setH] = useState<Hours | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    void api<Hours>(`/surveys/${surveyId}/cati/hours`).then(setH, setError);
  }, [surveyId]);
  if (!h) return error ? <ErrorNote error={error} /> : null;
  const save = async (clear = false) => {
    setError(null);
    setSaved(null);
    try {
      const next = await api<Hours>(`/surveys/${surveyId}/cati/hours`, {
        method: 'PUT',
        body: clear ? { clear: true } : { timeZone: h.timeZone, from: h.from, until: h.until, days: h.days },
      });
      setH(next);
      setSaved(clear ? 'Calling hours removed: cases can be called at any time.' : 'Calling hours saved.');
      await onSaved();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <fieldset className="plain stack" data-testid="cati-hours">
      <legend>
        <strong>Calling hours</strong>{' '}
        {h.set ? (
          <span className="small muted">
            {h.from} to {h.until}, {h.days.map((d) => DAYS[d - 1]).join(' ')}, in each respondent&apos;s time zone (else {h.timeZone})
            {withinNow ? '' : ' · outside calling hours now'}
          </span>
        ) : (
          <span className="small warn-text">Not set: cases can be called at any time.</span>
        )}
      </legend>
      <p className="small muted" style={{ margin: 0 }}>
        Cases are only offered inside these hours in the respondent&apos;s local time: the <span className="mono">timezone</span> column of
        the call list (for example Asia/Kolkata), or the zone below. Callbacks a respondent agreed to are called at their time.
      </p>
      {!readOnly ? (
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field">
            Time zone
            <input list="cati-zones" value={h.timeZone} onChange={(e) => setH({ ...h, timeZone: e.target.value })} style={{ width: 180 }} />
            <datalist id="cati-zones">
              {ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </label>
          <label className="field">
            From
            <input type="time" value={h.from} onChange={(e) => setH({ ...h, from: e.target.value })} />
          </label>
          <label className="field">
            Until
            <input type="time" value={h.until} onChange={(e) => setH({ ...h, until: e.target.value })} />
          </label>
          <span className="row" role="group" aria-label="Days" style={{ gap: 4 }}>
            {DAYS.map((d, i) => (
              <label key={d} className="check small">
                <input
                  type="checkbox"
                  checked={h.days.includes(i + 1)}
                  onChange={() =>
                    setH({
                      ...h,
                      days: h.days.includes(i + 1) ? h.days.filter((x) => x !== i + 1) : [...h.days, i + 1].sort((a, b) => a - b),
                    })
                  }
                />
                {d}
              </label>
            ))}
          </span>
          <button onClick={() => void save()} disabled={!h.days.length}>
            Save calling hours
          </button>
          {h.set ? (
            <button className="link" onClick={() => void save(true)}>
              Remove
            </button>
          ) : null}
          {saved ? (
            <span role="status" className="ok-text small">
              {saved}
            </span>
          ) : null}
        </div>
      ) : null}
      <ErrorNote error={error} />
    </fieldset>
  );
}

interface Dialer {
  available: boolean;
  enabled: boolean;
  recordCalls: boolean;
  recordingNotice: string;
}

/** Milestone 19: place calls through the telephony provider instead of interviewers dialling by hand. */
function DialerSettings({ surveyId, readOnly }: { surveyId: string; readOnly: boolean }) {
  const [d, setD] = useState<Dialer | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    void api<Dialer>(`/surveys/${surveyId}/cati/dialer`).then(setD, setError);
  }, [surveyId]);
  if (!d) return error ? <ErrorNote error={error} /> : null;
  const save = async () => {
    setError(null);
    setSaved(null);
    try {
      setD(
        await api<Dialer>(`/surveys/${surveyId}/cati/dialer`, {
          method: 'PUT',
          body: { enabled: d.enabled, recordCalls: d.recordCalls, recordingNotice: d.recordingNotice },
        }),
      );
      setSaved('Dialer settings saved.');
    } catch (e) {
      setError(e);
    }
  };
  return (
    <fieldset className="plain stack" data-testid="cati-dialer">
      <legend>
        <strong>Phone dialer</strong>{' '}
        <span className="small muted">
          {!d.available
            ? 'Not set up for this installation: interviewers dial by hand.'
            : d.enabled
              ? `On${d.recordCalls ? ', calls are recorded' : ''}. Interviewers do not see numbers.`
              : 'Off: interviewers dial by hand.'}
        </span>
      </legend>
      {d.available && !readOnly ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            With the dialer, the interviewer&apos;s own phone rings first and the respondent is called from your organization&apos;s number,
            so interviewers never see respondents&apos; numbers.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="check">
              <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
              Use the dialer
            </label>
            <label className="check">
              <input type="checkbox" checked={d.recordCalls} onChange={(e) => setD({ ...d, recordCalls: e.target.checked })} />
              Record calls
            </label>
          </div>
          {d.recordCalls ? (
            <label className="field">
              Read to the respondent before the call is connected
              <input value={d.recordingNotice} maxLength={300} onChange={(e) => setD({ ...d, recordingNotice: e.target.value })} />
            </label>
          ) : null}
          <div className="row">
            <button onClick={() => void save()}>Save dialer settings</button>
            {saved ? (
              <span role="status" className="ok-text small">
                {saved}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
      <ErrorNote error={error} />
    </fieldset>
  );
}

interface DncList {
  count: number;
  latest: Array<{ id: string; hint: string; source: string; note: string | null; createdAt: string }>;
}
const DNC_SOURCE: Record<string, string> = { respondent: 'asked on a call', upload: 'uploaded', manual: 'added by hand' };

/** The organization's do-not-call list (Milestone 18): numbers are kept as keyed hashes only. */
export function DoNotCallList() {
  const confirm = useConfirm();
  const me = useMe();
  const [list, setList] = useState<DncList | null>(null);
  const [phones, setPhones] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      setList(await api<DncList>('/cati/do-not-call'));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const report = (r: { added: number; alreadyListed: number; invalidCount: number }) =>
    setResult(
      `Added ${r.added}.${r.alreadyListed ? ` ${r.alreadyListed} already listed.` : ''}${r.invalidCount ? ` ${r.invalidCount} not a phone number.` : ''}`,
    );
  const add = async () => {
    setError(null);
    try {
      report(await api(`/cati/do-not-call`, { body: { phones: phones.split(/[\n,;]+/).filter((p) => p.trim()) } }));
      setPhones('');
      await load();
    } catch (e) {
      setError(e);
    }
  };
  const uploadFile = async (f: File) => {
    setError(null);
    try {
      const form = new FormData();
      form.append('file', f);
      report(await upload('/cati/do-not-call/upload', form));
      if (file.current) file.current.value = '';
      await load();
    } catch (e) {
      setError(e);
    }
  };
  const remove = async (id: string, hint: string) => {
    if (
      !(await confirm({
        title: `Take the number ending ${hint} off the do-not-call list?`,
        message: 'It may be called again.',
        confirmLabel: 'Remove from list',
        tone: 'danger',
      }))
    )
      return;
    try {
      await api(`/cati/do-not-call/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e);
    }
  };
  if (!list) return error ? <ErrorNote error={error} /> : null;
  return (
    <section className="panel stack" data-testid="do-not-call">
      <h2 style={{ margin: 0 }}>
        Do-not-call list
        <InfoTip k="section.dnc" />
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        {list.count} number{list.count === 1 ? '' : 's'}. No survey of your organization offers these numbers to interviewers. A respondent
        who says &ldquo;do not call again&rdquo; on a call is added automatically. Numbers are kept as keyed hashes, never in clear.
      </p>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field">
          Add numbers
          <input value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="+44 7700 900123, …" style={{ width: 260 }} />
        </label>
        <button onClick={() => void add()} disabled={!phones.trim()}>
          Add
        </button>
        <label className="field">
          Or upload a CSV
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            aria-label="Do-not-call file"
            onChange={(e) => e.target.files?.[0] && void uploadFile(e.target.files[0])}
          />
        </label>
        {result ? (
          <span role="status" className="small ok-text">
            {result}
          </span>
        ) : null}
      </div>
      {list.latest.length ? (
        <table className="data small">
          <thead>
            <tr>
              <th>Number</th>
              <th>How</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.latest.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.hint}</td>
                <td>{DNC_SOURCE[d.source] ?? d.source}</td>
                <td>{new Date(d.createdAt).toLocaleString()}</td>
                <td>
                  {me?.role === 'ADMIN' ? (
                    <button className="link danger" onClick={() => void remove(d.id, d.hint)}>
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <ErrorNote error={error} />
    </section>
  );
}
