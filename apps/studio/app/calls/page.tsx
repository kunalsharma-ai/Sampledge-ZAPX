'use client';
/**
 * The CATI calling screen (Milestone 9): pick a survey, take the next case (callbacks first), call
 * the number, run the interview in the respondent runtime, then record how the call ended.
 * Milestone 19: on surveys that use the dialer, Call rings the interviewer's phone and then the
 * respondent's, and the number stays hidden.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote, Shell } from '@/components/Shell';
import { PageHeader } from '@/components/neon/PageHeader';
import { PhoneCall } from 'lucide-react';
import { InfoTip } from '@/components/neon/InfoTip';

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
  phoneHint: string;
  data: Record<string, string>;
  attempts: number;
  maxAttempts: number;
  status: string;
  lastDisposition: string | null;
  calls: Array<{ disposition: string; note: string | null; callbackAt: string | null; endedAt: string }>;
  /** Milestone 19: the survey places calls through the dialer (the number is then hidden). */
  dialer: { record: boolean } | null;
}
interface Dial {
  id: string;
  status: string;
  respondentStatus: string | null;
  talkSeconds: number | null;
  record: boolean;
  recordingStatus: string;
  error: string | null;
}
interface Me {
  dialerAvailable: boolean;
  phoneHint: string | null;
}
const LIVE = new Set(['queued', 'initiated', 'ringing', 'in-progress']);
const YOUR_LEG: Record<string, string> = {
  queued: 'Ringing your phone…',
  initiated: 'Ringing your phone…',
  ringing: 'Ringing your phone…',
  'in-progress': 'Connected. Answer your phone; the respondent is being called.',
  completed: 'The call has ended.',
  busy: 'Your phone was busy.',
  'no-answer': 'Your phone was not answered.',
  failed: 'The call could not be placed.',
  canceled: 'The call was cancelled.',
};
const THEIR_LEG: Record<string, string> = {
  completed: 'the respondent answered',
  answered: 'the respondent answered',
  busy: 'the respondent was busy',
  'no-answer': 'the respondent did not answer',
  failed: 'the respondent could not be reached',
  canceled: 'the call to the respondent was cancelled',
};
/** The outcome to suggest from how the respondent's line behaved. */
const SUGGEST: Record<string, string> = { busy: 'busy', 'no-answer': 'no_answer', failed: 'wrong_number' };
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
  const [me, setMe] = useState<Me | null>(null);
  const [myPhone, setMyPhone] = useState('');
  const [dial, setDial] = useState<Dial | null>(null);

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
    void api<Me>('/cati/me').then(setMe, setError);
  }, [load]);

  // Follow the dialer call while it is live (Milestone 19).
  const caseId = current?.id;
  const liveDial = dial && LIVE.has(dial.status) ? dial.id : null;
  useEffect(() => {
    if (!caseId || !liveDial) return;
    const t = setInterval(() => {
      void api<{ dial: Dial | null }>(`/cati/cases/${caseId}/dial`).then(({ dial: d }) => {
        if (!d) return;
        setDial(d);
        const suggest = d.respondentStatus ? SUGGEST[d.respondentStatus] : undefined;
        if (suggest) setForm((f) => (f.disposition === 'no_answer' ? { ...f, disposition: suggest } : f));
      }, setError);
    }, 2000);
    return () => clearInterval(t);
  }, [caseId, liveDial]);

  const saveMyPhone = async (clear = false) => {
    setError(null);
    try {
      setMe(await api<Me>('/cati/me/phone', { method: 'PUT', body: { phone: clear ? null : myPhone } }));
      setMyPhone('');
    } catch (e) {
      setError(e);
    }
  };

  const placeCall = async () => {
    if (!current) return;
    setError(null);
    try {
      setDial(await api<Dial>(`/cati/cases/${current.id}/dial`, { method: 'POST' }));
    } catch (e) {
      setError(e);
    }
  };

  const hangUp = async () => {
    if (!dial) return;
    setError(null);
    try {
      setDial(await api<Dial>(`/cati/dials/${dial.id}/hangup`, { method: 'POST' }));
    } catch (e) {
      setError(e);
    }
  };

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
      setDial(c ? ((await api<{ dial: Dial | null }>(`/cati/cases/${c.id}/dial`)).dial ?? null) : null);
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
      setDial(null);
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
      setDial(null);
      setNote('The case is back in the queue.');
      await load();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Shell forInterviewers crumbs={<span>Calls</span>}>
      <PageHeader icon={PhoneCall} tone={3} eyebrow="Fieldwork" title="Calls" help="page.calls">
        Phone interviews assigned to you. Take the next case, call the respondent and record the outcome.
      </PageHeader>
      <div className="grid2">
        <section className="panel stack" data-testid="call-surveys">
          <h2 style={{ margin: 0 }}>
            Phone surveys
            <InfoTip k="section.phoneSurveys" />
          </h2>
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
          {empty ? (
            <p className="muted">
              Nobody is due to be called right now. Callbacks and retries come back when they are due, and cases wait while it is outside
              calling hours where the respondent lives.
            </p>
          ) : null}
          {me?.dialerAvailable ? (
            <div className="stack small" data-testid="my-phone" style={{ gap: 4 }}>
              <strong>Your phone for the dialer</strong>
              <span className="muted">
                {me.phoneHint
                  ? `The dialer rings your number ending ${me.phoneHint}.`
                  : 'Surveys that use the dialer ring your phone first. Add your number.'}
              </span>
              <div className="row">
                <label className="field">
                  Phone number
                  <input value={myPhone} placeholder="+44 7700 900123" onChange={(e) => setMyPhone(e.target.value)} />
                </label>
                <button disabled={!myPhone.trim()} onClick={() => void saveMyPhone()}>
                  Save my number
                </button>
                {me.phoneHint ? (
                  <button className="link" onClick={() => void saveMyPhone(true)}>
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <ErrorNote error={error} />
        </section>

        {current ? (
          <section className="panel stack" data-testid="call-case">
            <h2 style={{ margin: 0 }}>
              {current.name ?? current.code}
              <InfoTip k="section.currentCall" />
            </h2>
            <div className="small muted">
              Id {current.code} · attempt {current.attempts + 1} of {current.maxAttempts}
              {current.status === 'IN_CALL' && current.lastDisposition === 'callback' ? ' · callback' : ''}
            </div>
            {current.dialer ? (
              <div className="stack" data-testid="dialer" style={{ gap: 4 }}>
                <div className="row">
                  {dial && LIVE.has(dial.status) ? (
                    <button onClick={() => void hangUp()}>Hang up</button>
                  ) : (
                    <button className="primary" onClick={() => void placeCall()} disabled={!me?.phoneHint}>
                      {dial ? 'Call again' : 'Call the respondent'}
                    </button>
                  )}
                  <span className="small muted">Number {current.phoneHint}</span>
                </div>
                {!me?.phoneHint ? <span className="small warn-text">Add your phone number first (left).</span> : null}
                {current.dialer.record ? (
                  <span className="small muted">Calls on this survey are recorded; the respondent hears a notice.</span>
                ) : null}
                {dial ? (
                  <span className="small" role="status" data-testid="dial-status">
                    {YOUR_LEG[dial.status] ?? dial.status}
                    {dial.respondentStatus ? ` Then ${THEIR_LEG[dial.respondentStatus] ?? dial.respondentStatus}` : ''}
                    {dial.talkSeconds ? ` (${dial.talkSeconds} s)` : ''}
                    {dial.respondentStatus ? '.' : ''}
                    {dial.error ? ` ${dial.error}` : ''}
                  </span>
                ) : null}
              </div>
            ) : current.phone ? (
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
