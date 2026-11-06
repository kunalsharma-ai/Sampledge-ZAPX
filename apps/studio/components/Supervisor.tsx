'use client';
/**
 * Blueprint phase 3: the supervisor's view of face-to-face fieldwork. Productivity and quality per
 * interviewer, exceptions, a map of where interviews started, back-checks and appeals.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { InfoTip } from '@/components/neon/InfoTip';

interface InterviewerRow {
  id: string;
  name: string;
  active: boolean;
  target: number | null;
  interviews: number;
  completes: number;
  partials: number;
  qualityFails: number;
  pendingReview: number;
  medianLoiMs: number | null;
  completesPerDay: number | null;
  averageQuality: number | null;
  exceptions: number;
  outsideArea: number;
  interruptionsPerInterview: number | null;
  backChecks: { pending: number; verified: number; failed: number; unreachable: number };
  lastSyncAt: string | null;
}
interface Fence {
  label: string;
  lat: number;
  lon: number;
  radiusM: number;
}
interface Dashboard {
  totals: {
    interviews: number;
    completes: number;
    target: number | null;
    exceptions: number;
    openAppeals: number;
    pendingBackChecks: number;
  };
  interviewers: InterviewerRow[];
  exceptions: Array<{
    responseId: string;
    uid: string;
    interviewer: string | null;
    status: string;
    completedAt: string | null;
    flags: Array<{ code: string; detail: string }>;
  }>;
  map: { points: Array<{ lat: number; lon: number; status: string; interviewer: string | null; uid: string }>; fences: Fence[] };
  daily: Array<{ day: string; completes: number }>;
}
interface BackCheck {
  id: string;
  responseId: string;
  uid: string | null;
  interviewer: string | null;
  completedAt: string | null;
  durationMs: number | null;
  responseStatus: string | null;
  method: 'phone' | 'visit' | 'recording';
  state: 'pending' | 'verified' | 'failed' | 'unreachable';
  mismatches: string[];
  note: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
}
interface Appeal {
  id: string;
  uid: string | null;
  responseStatus: string | null;
  reason: string | null;
  qualityScore: number | null;
  flags: string[];
  reviewNote: string | null;
  raisedBy: string | null;
  message: string;
  state: 'open' | 'upheld' | 'overturned';
  decisionNote: string | null;
  decidedBy: string | null;
  createdAt: string;
}

const minutes = (ms: number | null) => (ms === null ? '–' : `${(ms / 60_000).toFixed(1)} min`);
const STATUS_COLOR: Record<string, string> = {
  complete: 'var(--ok, #22c55e)',
  quality_fail: 'var(--danger, #ef4444)',
  partial: 'var(--warn, #f59e0b)',
};

export function Supervisor({ surveyId, readOnly }: { surveyId: string; readOnly: boolean }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setD(await api(`/surveys/${surveyId}/supervisor`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="panel stack" data-testid="supervisor">
      <div className="row">
        <h2 style={{ margin: 0 }}>
          Supervisor dashboard
          <InfoTip k="section.supervisor" />
        </h2>
        <span className="muted small">Face-to-face interviews, from what interviewers have synced.</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <ErrorNote error={error} />
      {d ? (
        <>
          <dl className="stats">
            {(
              [
                ['Completes', d.totals.target ? `${d.totals.completes} / ${d.totals.target}` : String(d.totals.completes)],
                ['Interviews synced', String(d.totals.interviews)],
                ['Exceptions', String(d.totals.exceptions)],
                ['Back-checks to do', String(d.totals.pendingBackChecks)],
                ['Open appeals', String(d.totals.openAppeals)],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <DailyBars daily={d.daily} />
          <div style={{ overflowX: 'auto' }}>
            <table className="data" data-testid="productivity">
              <thead>
                <tr>
                  <th>Interviewer</th>
                  <th>Completes</th>
                  <th>Per day</th>
                  <th>Median length</th>
                  <th>Quality</th>
                  <th>Exceptions</th>
                  <th>Interruptions</th>
                  <th>Back-checks</th>
                  <th>Last sync</th>
                </tr>
              </thead>
              <tbody>
                {d.interviewers.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name}
                      {!i.active ? <span className="muted small"> (not assigned)</span> : null}
                    </td>
                    <td>
                      {i.completes}
                      {i.target ? <span className="muted"> / {i.target}</span> : null}
                      {i.partials || i.qualityFails ? (
                        <div className="muted small">
                          {i.partials} partial · {i.qualityFails} rejected
                        </div>
                      ) : null}
                    </td>
                    <td>{i.completesPerDay ?? '–'}</td>
                    <td>{minutes(i.medianLoiMs)}</td>
                    <td>
                      {i.averageQuality ?? '–'}
                      {i.pendingReview ? <div className="muted small">{i.pendingReview} to review</div> : null}
                    </td>
                    <td>
                      {i.exceptions}
                      {i.outsideArea ? <div className="muted small">{i.outsideArea} outside area</div> : null}
                    </td>
                    <td>{i.interruptionsPerInterview ?? '–'}</td>
                    <td className="small">
                      {i.backChecks.verified} ok · {i.backChecks.failed} failed
                      {i.backChecks.pending ? ` · ${i.backChecks.pending} to do` : ''}
                    </td>
                    <td className="small">{i.lastSyncAt ? new Date(i.lastSyncAt).toLocaleString() : '–'}</td>
                  </tr>
                ))}
                {!d.interviewers.length ? (
                  <tr>
                    <td colSpan={9} className="muted">
                      No interviewers yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <FieldMap points={d.map.points} fences={d.map.fences} />
          <h3 style={{ margin: 0 }}>Exceptions</h3>
          {d.exceptions.length ? (
            <table className="data" data-testid="exceptions">
              <thead>
                <tr>
                  <th>Interview</th>
                  <th>Interviewer</th>
                  <th>Result</th>
                  <th>What was found</th>
                </tr>
              </thead>
              <tbody>
                {d.exceptions.map((x) => (
                  <tr key={x.responseId}>
                    <td className="mono">{x.uid.slice(0, 8)}</td>
                    <td>{x.interviewer ?? '–'}</td>
                    <td>{x.status.replace('_', ' ')}</td>
                    <td className="small">{x.flags.map((f) => f.detail || f.code).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              No interview was flagged for location, timing, interruptions or overlaps.
            </p>
          )}
        </>
      ) : null}
      <BackChecks surveyId={surveyId} readOnly={readOnly} onChanged={load} />
      <Appeals surveyId={surveyId} readOnly={readOnly} onChanged={load} />
    </section>
  );
}

function DailyBars({ daily }: { daily: Dashboard['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.completes));
  return (
    <figure className="stack" style={{ margin: 0, gap: 4 }}>
      <figcaption className="muted small">Completes per day, last 14 days</figcaption>
      <svg
        viewBox={`0 0 ${daily.length * 24} 64`}
        width="100%"
        height={64}
        role="img"
        aria-label="Completes per day"
        preserveAspectRatio="none"
      >
        {daily.map((d, i) => {
          const h = Math.round((d.completes / max) * 56);
          return (
            <rect
              key={d.day}
              x={i * 24 + 4}
              y={60 - h}
              width={16}
              height={Math.max(h, 1)}
              rx={3}
              fill="var(--accent, #7c3aed)"
              opacity={h ? 1 : 0.25}
            >
              <title>{`${d.day}: ${d.completes}`}</title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}

/**
 * Where interviews started, plotted on their own coordinates (no map tiles are loaded, so nothing is
 * sent to a map provider). Circles are the survey's interview areas.
 */
function FieldMap({ points, fences }: Dashboard['map']) {
  if (!points.length && !fences.length) return <p className="muted small">No interview locations yet. Turn on locations under Quality.</p>;
  const all = [
    ...points,
    ...fences.flatMap((f) => [f, { lat: f.lat + f.radiusM / 111_000, lon: f.lon }, { lat: f.lat - f.radiusM / 111_000, lon: f.lon }]),
  ];
  const lat0 = Math.min(...all.map((p) => p.lat));
  const lat1 = Math.max(...all.map((p) => p.lat));
  const midLat = (lat0 + lat1) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const lonR = fences.map((f) => f.radiusM / (111_000 * k));
  const lon0 = Math.min(...points.map((p) => p.lon), ...fences.map((f, i) => f.lon - lonR[i]!));
  const lon1 = Math.max(...points.map((p) => p.lon), ...fences.map((f, i) => f.lon + lonR[i]!));
  const W = 640;
  const H = 320;
  const spanX = Math.max((lon1 - lon0) * k, 1e-4);
  const spanY = Math.max(lat1 - lat0, 1e-4);
  const scale = Math.min((W - 40) / spanX, (H - 40) / spanY);
  const x = (lon: number) => 20 + (lon - lon0) * k * scale + (W - 40 - spanX * scale) / 2;
  const y = (lat: number) => H - 20 - (lat - lat0) * scale - (H - 40 - spanY * scale) / 2;
  return (
    <figure className="stack" style={{ margin: 0, gap: 4 }}>
      <figcaption className="muted small">
        Interview start locations ({points.length}) and interview areas ({fences.length}). Plotted to scale; no map tiles are loaded.
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, border: '1px solid var(--border)', borderRadius: 12 }}
        role="img"
        aria-label="Map of interview locations"
        data-testid="field-map"
      >
        {fences.map((f) => (
          <g key={f.label}>
            <circle
              cx={x(f.lon)}
              cy={y(f.lat)}
              r={(f.radiusM / 111_000) * scale}
              fill="var(--accent, #7c3aed)"
              fillOpacity={0.08}
              stroke="var(--accent, #7c3aed)"
              strokeDasharray="6 4"
            />
            <text x={x(f.lon)} y={y(f.lat)} textAnchor="middle" fontSize={12} fill="currentColor" opacity={0.7}>
              {f.label}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(p.lon)}
            cy={y(p.lat)}
            r={4}
            fill={STATUS_COLOR[p.status] ?? 'var(--muted, #94a3b8)'}
            stroke="var(--bg, #000)"
            strokeWidth={1}
          >
            <title>{`${p.interviewer ?? ''} · ${p.uid.slice(0, 8)} · ${p.status}`}</title>
          </circle>
        ))}
      </svg>
      <span className="muted small">
        <span style={{ color: STATUS_COLOR.complete }}>●</span> complete <span style={{ color: STATUS_COLOR.partial }}>●</span> partial{' '}
        <span style={{ color: STATUS_COLOR.quality_fail }}>●</span> rejected
      </span>
    </figure>
  );
}

function BackChecks({ surveyId, readOnly, onChanged }: { surveyId: string; readOnly: boolean; onChanged: () => void }) {
  const [data, setData] = useState<{ counts: Record<string, number>; items: BackCheck[] } | null>(null);
  const [percent, setPercent] = useState('10');
  const [min, setMin] = useState('1');
  const [method, setMethod] = useState('PHONE');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setData(await api(`/surveys/${surveyId}/backchecks`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
  }, [load]);

  const sample = async () => {
    setError(null);
    try {
      const r = await api<{ drawn: number; eligible: number }>(`/surveys/${surveyId}/backchecks/sample`, {
        method: 'POST',
        body: { percent: Number(percent), minPerInterviewer: Number(min) || 0, method },
      });
      setNote(`Drew ${r.drawn} of ${r.eligible} completed interviews not checked before.`);
      await load();
      onChanged();
    } catch (e) {
      setError(e);
    }
  };
  const record = async (b: BackCheck, state: 'VERIFIED' | 'FAILED' | 'UNREACHABLE') => {
    let why: string | undefined;
    let mismatches: string[] = [];
    if (state === 'FAILED') {
      why = window.prompt('Why did the back-check fail? (shown to the interviewer if they appeal)') ?? undefined;
      if (!why?.trim()) return;
      mismatches = (window.prompt('Questions whose answer did not match (ids, comma separated; optional)') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    try {
      await api(`/surveys/${surveyId}/backchecks/${b.id}`, { method: 'PUT', body: { state, mismatches, ...(why ? { note: why } : {}) } });
      await load();
      onChanged();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="stack" data-testid="backchecks">
      <h3 style={{ margin: 0 }}>Back-checks</h3>
      <p className="muted small" style={{ margin: 0 }}>
        A random share of each interviewer&apos;s completed interviews is drawn for a supervisor to verify: call the respondent, visit, or
        listen to the recording. A failed back-check rejects the interview (its quota place is released).
      </p>
      {!readOnly ? (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field">
            Share to check (%)
            <input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} />
          </label>
          <label className="field">
            At least per interviewer
            <input type="number" min={0} max={100} value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
          <label className="field">
            How
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="PHONE">Phone call</option>
              <option value="VISIT">Visit</option>
              <option value="RECORDING">Listen to the recording</option>
            </select>
          </label>
          <button type="button" onClick={() => void sample()}>
            Draw back-checks
          </button>
        </div>
      ) : null}
      {note ? <p className="small">{note}</p> : null}
      <ErrorNote error={error} />
      {data?.items.length ? (
        <table className="data">
          <thead>
            <tr>
              <th>Interview</th>
              <th>Interviewer</th>
              <th>How</th>
              <th>Result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.uid?.slice(0, 8) ?? '–'}</td>
                <td>{b.interviewer ?? '–'}</td>
                <td>{b.method}</td>
                <td>
                  <span className={`badge ${b.state === 'failed' ? 'bad' : b.state === 'verified' ? 'good' : 'warn'}`}>{b.state}</span>
                  {b.note ? <div className="muted small">{b.note}</div> : null}
                  {b.mismatches.length ? <div className="muted small">Did not match: {b.mismatches.join(', ')}</div> : null}
                </td>
                <td>
                  {!readOnly && b.state === 'pending' ? (
                    <span className="row" style={{ gap: 6 }}>
                      <button type="button" className="secondary" onClick={() => void record(b, 'VERIFIED')}>
                        Verified
                      </button>
                      <button type="button" className="secondary" onClick={() => void record(b, 'UNREACHABLE')}>
                        Unreachable
                      </button>
                      <button type="button" className="danger" onClick={() => void record(b, 'FAILED')}>
                        Failed
                      </button>
                    </span>
                  ) : b.checkedBy ? (
                    <span className="muted small">by {b.checkedBy}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          No back-checks drawn yet.
        </p>
      )}
    </div>
  );
}

function Appeals({ surveyId, readOnly, onChanged }: { surveyId: string; readOnly: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<Appeal[]>([]);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setItems(await api(`/surveys/${surveyId}/appeals`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
  }, [load]);
  const decide = async (a: Appeal, decision: 'uphold' | 'overturn') => {
    const note = window.prompt(decision === 'overturn' ? 'Why is the interview reinstated?' : 'Why does the rejection stand?');
    if (!note?.trim()) return;
    try {
      await api(`/surveys/${surveyId}/appeals/${a.id}`, { method: 'PUT', body: { decision, note } });
      await load();
      onChanged();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="stack" data-testid="appeals">
      <h3 style={{ margin: 0 }}>Appeals</h3>
      <p className="muted small" style={{ margin: 0 }}>
        Interviewers can appeal a rejected interview from the interviewer app. Overturning reinstates it as a complete when its quotas have
        room.
      </p>
      <ErrorNote error={error} />
      {items.length ? (
        <table className="data">
          <thead>
            <tr>
              <th>Interview</th>
              <th>From</th>
              <th>Why it was rejected</th>
              <th>Appeal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td className="mono">{a.uid?.slice(0, 8)}</td>
                <td>{a.raisedBy}</td>
                <td className="small">{a.reviewNote ?? (a.flags.join(' · ') || a.reason)}</td>
                <td className="small">
                  {a.message}
                  {a.decisionNote ? (
                    <div className="muted">
                      {a.state} by {a.decidedBy}: {a.decisionNote}
                    </div>
                  ) : null}
                </td>
                <td>
                  {!readOnly && a.state === 'open' ? (
                    <span className="row" style={{ gap: 6 }}>
                      <button type="button" className="secondary" onClick={() => void decide(a, 'uphold')}>
                        Keep rejected
                      </button>
                      <button type="button" onClick={() => void decide(a, 'overturn')}>
                        Reinstate
                      </button>
                    </span>
                  ) : (
                    <span className={`badge ${a.state === 'overturned' ? 'good' : ''}`}>{a.state}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          No appeals.
        </p>
      )}
    </div>
  );
}
