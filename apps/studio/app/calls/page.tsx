'use client';
/**
 * The CATI calling screen (Milestone 9): pick a survey, take the next case (callbacks first), call
 * the number, run the interview in the respondent runtime, then record how the call ended.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote, Shell } from '@/components/Shell';

interface CallSurvey {
  id: string;
  name: string;
  dueNow: number;
  mine: number;
}
interface Case {
  id: string;
  code: string;
  name: string | null;
  phone: string | null;
  data: Record<string, string>;
  attempts: number;
  maxAttempts: number;
  status: string;
  lastDisposition: string | null;
  calls: Array<{ disposition: string; note: string | null; callbackAt: string | null; endedAt: string }>;
}
interface Disposition {
  code: string;
  label: string;
}

/** datetime-local value for one hour from now, in the interviewer's time zone. */
function inOneHour() {
  const d = new Date(Date.now() + 3_600_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function CallsPage() {
  const [surveys, setSurveys] = useState<CallSurvey[] | null>(null);
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Case | null>(null);
  const [openedAt, setOpenedAt] = useState<string>('');
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [form, setForm] = useState({ disposition: 'no_answer', note: '', callbackAt: inOneHour() });
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSurveys(await api<CallSurvey[]>('/cati/surveys'));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
    void api<Disposition[]>('/cati/dispositions').then(setDispositions, setError);
  }, [load]);

  const label = (code: string) => dispositions.find((d) => d.code === code)?.label ?? code;

  const take = async (id: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    setEmpty(false);
    try {
      const { case: c } = await api<{ case: Case | null }>(`/cati/surveys/${id}/next`, { method: 'POST' });
      setSurveyId(id);
      setCurrent(c);
      setEmpty(!c);
      setInterviewOpen(false);
      setOpenedAt(new Date().toISOString());
      setForm({ disposition: 'no_answer', note: '', callbackAt: inOneHour() });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const startInterview = async () => {
    if (!current) return;
    setError(null);
    // Open the window first (inside the click), so pop-up blockers allow it.
    const win = window.open('about:blank', '_blank');
    try {
      const { runtimeUrl } = await api<{ runtimeUrl: string }>(`/cati/cases/${current.id}/interview`, { method: 'POST' });
      if (win) win.location.href = runtimeUrl;
      else window.location.assign(runtimeUrl);
      setInterviewOpen(true);
      setForm((f) => ({ ...f, disposition: 'interviewed' }));
    } catch (e) {
      win?.close();
      setError(e);
    }
  };

  const save = async () => {
    if (!current || !surveyId) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        disposition: form.disposition,
        openedAt,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      };
      if (form.disposition === 'callback') body.callbackAt = new Date(form.callbackAt).toISOString();
      const r = await api<{ status: string; lastDisposition: string }>(`/cati/cases/${current.id}/disposition`, { method: 'POST', body });
      setNote(`Saved: ${label(r.lastDisposition)} (${r.status.toLowerCase()}).`);
      setCurrent(null);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const giveBack = async () => {
    if (!current) return;
    setError(null);
    try {
      await api(`/cati/cases/${current.id}/release`, { method: 'POST' });
      setCurrent(null);
      setNote('The case is back in the queue.');
      await load();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Shell forInterviewers crumbs={<span>Calls</span>}>
      <div className="grid2">
        <section className="panel stack" data-testid="call-surveys">
          <h1 style={{ margin: 0 }}>Calls</h1>
          {surveys === null ? null : surveys.length === 0 ? (
            <p className="muted">No phone surveys are assigned to you, or none is live.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Survey</th>
                  <th>Due now</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {surveys.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.dueNow + s.mine}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="primary" disabled={busy || !!current} onClick={() => take(s.id)}>
                        {s.mine ? `Continue ${s.name}` : `Next case for ${s.name}`}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {note ? (
            <p className="ok-text small" role="status" style={{ margin: 0 }}>
              {note}
            </p>
          ) : null}
          {empty ? <p className="muted">Nobody is due to be called right now. Callbacks and retries come back when they are due.</p> : null}
          <ErrorNote error={error} />
        </section>

        {current ? (
          <section className="panel stack" data-testid="call-case">
            <h2 style={{ margin: 0 }}>{current.name ?? current.code}</h2>
            <div className="small muted">
              Id {current.code} · attempt {current.attempts + 1} of {current.maxAttempts}
              {current.status === 'IN_CALL' && current.lastDisposition === 'callback' ? ' · callback' : ''}
            </div>
            {current.phone ? (
              <a className="btn primary call-number" href={`tel:${current.phone}`} data-testid="call-number">
                Call {current.phone}
              </a>
            ) : null}
            {Object.keys(current.data).length ? (
              <dl className="case-data small">
                {Object.entries(current.data).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {current.calls.length ? (
              <div className="small" data-testid="call-history">
                <strong>Earlier calls</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {current.calls.map((k, i) => (
                    <li key={i}>
                      {new Date(k.endedAt).toLocaleString()}: {label(k.disposition)}
                      {k.callbackAt ? ` (for ${new Date(k.callbackAt).toLocaleString()})` : ''}
                      {k.note ? ` — ${k.note}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="row">
              <button onClick={startInterview}>{interviewOpen ? 'Reopen the interview' : 'Start interview'}</button>
              {interviewOpen ? <span className="small muted">The interview is open in another tab. Read each question aloud.</span> : null}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <label className="field">
                How did the call end?
                <select value={form.disposition} onChange={(e) => setForm({ ...form, disposition: e.target.value })}>
                  {dispositions.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              {form.disposition === 'callback' ? (
                <label className="field">
                  Call back at
                  <input type="datetime-local" value={form.callbackAt} onChange={(e) => setForm({ ...form, callbackAt: e.target.value })} />
                </label>
              ) : null}
              <label className="field">
                Note (optional)
                <input value={form.note} maxLength={1000} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
              <div className="row">
                <button className="primary" disabled={busy} onClick={save}>
                  Save call outcome
                </button>
                <button className="link" onClick={giveBack}>
                  Give the case back
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
