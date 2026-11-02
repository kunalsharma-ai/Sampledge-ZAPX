'use client';
/**
 * Quality & fieldwork tab: the live fieldwork dashboard, the human review queue for flagged
 * completes, and the survey's quality settings (part of the draft, published like any logic).
 */
import { useCallback, useEffect, useState } from 'react';
import { qualitySettingsOf, type QualityCheck, type QualitySettings, type SurveyDefinition } from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';

interface Summary {
  starts: number;
  counts: Record<string, number>;
  incidence: number | null;
  completionRate: number | null;
  medianLoiSeconds: number | null;
  averageQualityScore: number | null;
  pendingReview: number;
  rejectedInReview: number;
}
interface Fieldwork {
  total: Summary;
  vendors: Array<{ vendor: string; summary: Summary }>;
  dropOff: Array<{ pageId: string; count: number }>;
  modes: { cawi: number; capi: number };
}
interface Flag {
  code: string;
  ref?: string;
  penalty: number;
  detail: string;
}
interface Item {
  id: string;
  uid: string;
  status: string;
  mode: 'CAWI' | 'CAPI';
  qualityScore: number | null;
  qualityFlags: Flag[];
  reviewState: string;
  reviewNote: string | null;
  durationMs: number | null;
  completedAt: string | null;
  vendor: { code: string } | null;
  interviewer: { name: string } | null;
  openEnds: Array<{ questionId: string; text: string }>;
}
type Filter = 'pending' | 'flagged' | 'accepted' | 'rejected';

const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
const loi = (s: number | null) => (s === null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

export function Quality({
  surveyId,
  def,
  readOnly,
  onChange,
}: {
  surveyId: string;
  def: SurveyDefinition;
  readOnly: boolean;
  onChange: (d: SurveyDefinition) => void;
}) {
  return (
    <div className="stack">
      <FieldworkPanel surveyId={surveyId} />
      <ReviewQueue surveyId={surveyId} readOnly={readOnly} />
      <QualitySettingsEditor def={def} readOnly={readOnly} onChange={onChange} />
    </div>
  );
}

function FieldworkPanel({ surveyId }: { surveyId: string }) {
  const [f, setF] = useState<Fieldwork | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setF(await api<Fieldwork>(`/surveys/${surveyId}/fieldwork`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
  }, [load]);
  const t = f?.total;
  return (
    <section className="panel stack" data-testid="fieldwork">
      <div className="row">
        <h2 style={{ margin: 0 }}>Fieldwork</h2>
        <span className="muted small">Live interviews only (test links excluded).</span>
        <div style={{ flex: 1 }} />
        <button onClick={load}>Refresh</button>
      </div>
      <ErrorNote error={error} />
      {t ? (
        <>
          <div className="tiles">
            <Tile label="Starts" value={t.starts} note={f!.modes.capi ? `${f!.modes.cawi} online · ${f!.modes.capi} CAPI` : undefined} />
            <Tile label="Completes" value={t.counts.complete ?? 0} />
            <Tile label="Incidence" value={pct(t.incidence)} note="completes ÷ (completes + screen-outs)" />
            <Tile label="Median length" value={loi(t.medianLoiSeconds)} />
            <Tile label="Average quality" value={t.averageQualityScore ?? '—'} note="of completes, 0–100" />
            <Tile label="Awaiting review" value={t.pendingReview} />
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Source</th>
                <th>Starts</th>
                <th>Complete</th>
                <th>Terminate</th>
                <th>Quota full</th>
                <th>Quality fail</th>
                <th>Partial</th>
                <th>Incidence</th>
                <th>Median length</th>
                <th>Avg quality</th>
              </tr>
            </thead>
            <tbody>
              {f!.vendors.map((v) => (
                <tr key={v.vendor}>
                  <td>{v.vendor}</td>
                  <td>{v.summary.starts}</td>
                  <td>{v.summary.counts.complete}</td>
                  <td>{v.summary.counts.terminate}</td>
                  <td>{v.summary.counts.quota_full}</td>
                  <td>{v.summary.counts.quality_fail}</td>
                  <td>{(v.summary.counts.partial ?? 0) + (v.summary.counts.in_progress ?? 0)}</td>
                  <td>{pct(v.summary.incidence)}</td>
                  <td>{loi(v.summary.medianLoiSeconds)}</td>
                  <td>{v.summary.averageQualityScore ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {f!.dropOff.length ? (
            <p className="small" data-testid="drop-off">
              <strong>Where unfinished interviews stopped:</strong>{' '}
              {f!.dropOff.map((d) => (
                <span key={d.pageId} className="badge" style={{ marginRight: 4 }}>
                  {d.pageId}: {d.count}
                </span>
              ))}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="tile" role="group" aria-label={label}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note ? <div className="label">{note}</div> : null}
    </div>
  );
}

function ReviewQueue({ surveyId, readOnly }: { surveyId: string; readOnly: boolean }) {
  const [filter, setFilter] = useState<Filter>('pending');
  const [data, setData] = useState<{ counts: Record<string, number>; items: Item[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/surveys/${surveyId}/quality?filter=${filter}`));
      setSelected(new Set());
    } catch (e) {
      setError(e);
    }
  }, [surveyId, filter]);
  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (decision: 'accept' | 'reject') => {
    if (
      decision === 'reject' &&
      !window.confirm(
        `Reject ${selected.size} complete(s)? Their quota places are released and vendors are told quality fail. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ accepted: number; rejected: number; skipped: number }>(`/surveys/${surveyId}/quality/decisions`, {
        body: { responseIds: [...selected], decision, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      setResult(
        decision === 'accept'
          ? `Accepted ${r.accepted}${r.skipped ? `, ${r.skipped} skipped` : ''}`
          : `Rejected ${r.rejected}${r.skipped ? `, ${r.skipped} skipped` : ''}`,
      );
      setNote('');
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const decidable = filter === 'pending' || filter === 'flagged';
  return (
    <section className="panel stack" data-testid="review-queue">
      <div className="row">
        <h2 style={{ margin: 0 }}>Quality review</h2>
        <span className="muted small">
          Completes scoring below the review threshold wait here. People decide; nothing is rejected silently.
        </span>
      </div>
      <div className="tabs" role="tablist" aria-label="Review filter">
        {(
          [
            ['pending', `Awaiting review (${data?.counts.pending ?? 0})`],
            ['flagged', 'All flagged'],
            ['accepted', `Accepted (${data?.counts.accepted ?? 0})`],
            ['rejected', `Rejected (${data?.counts.rejected ?? 0})`],
          ] as Array<[Filter, string]>
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      {result ? <p className="ok-text small">{result}</p> : null}
      {data && data.items.length === 0 ? <p className="muted">Nothing here.</p> : null}
      {data?.items.map((i) => (
        <div className="review-item" key={i.id} data-testid="review-item">
          {readOnly || !decidable || i.status !== 'COMPLETE' ? (
            <span />
          ) : (
            <input
              type="checkbox"
              aria-label={`Select ${i.uid}`}
              checked={selected.has(i.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(i.id);
                else next.delete(i.id);
                setSelected(next);
              }}
            />
          )}
          <div>
            <div className="row" style={{ gap: 6 }}>
              <strong className="mono">{i.uid}</strong>
              <span className="muted small">{i.vendor ? `vid=${i.vendor.code}` : i.interviewer ? `CAPI · ${i.interviewer.name}` : ''}</span>
              <span className={`badge ${i.status.toLowerCase()}`}>{i.status.toLowerCase()}</span>
              {i.reviewState !== 'NONE' ? (
                <span className={`badge ${i.reviewState.toLowerCase()}`}>{i.reviewState.toLowerCase()}</span>
              ) : null}
              <span className="muted small">length {loi(i.durationMs === null ? null : Math.round(i.durationMs / 1000))}</span>
            </div>
            <ul className="small">
              {i.qualityFlags.map((f, n) => (
                <li key={n}>
                  {f.detail} <span className="muted">(−{f.penalty})</span>
                </li>
              ))}
            </ul>
            {i.openEnds.length ? (
              <div className="small" style={{ marginTop: 4 }}>
                {i.openEnds.map((o) => (
                  <div key={o.questionId}>
                    <span className="mono muted">{o.questionId}:</span> “{o.text}”
                  </div>
                ))}
              </div>
            ) : null}
            {i.reviewNote ? <div className="small muted">Note: {i.reviewNote}</div> : null}
          </div>
          <div
            className={`score ${(i.qualityScore ?? 100) < 50 ? 'low' : (i.qualityScore ?? 100) < 70 ? 'mid' : ''}`}
            title="Quality score"
          >
            {i.qualityScore ?? '—'}
          </div>
        </div>
      ))}
      {!readOnly && decidable && data?.items.length ? (
        <div className="row">
          <input
            aria-label="Review note"
            placeholder="Note (optional, kept in the audit log)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: 1 }}
          />
          <button disabled={busy || selected.size === 0} onClick={() => decide('accept')}>
            Accept selected
          </button>
          <button className="danger" disabled={busy || selected.size === 0} onClick={() => decide('reject')}>
            Reject selected
          </button>
        </div>
      ) : null}
    </section>
  );
}

function QualitySettingsEditor({
  def,
  readOnly,
  onChange,
}: {
  def: SurveyDefinition;
  readOnly: boolean;
  onChange: (d: SurveyDefinition) => void;
}) {
  const q = qualitySettingsOf(def);
  const set = (patch: Partial<QualitySettings>) => onChange({ ...def, settings: { ...def.settings, quality: { ...q, ...patch } } });
  const setCheck = (n: number, patch: Partial<QualityCheck>) => set({ checks: q.checks.map((c, i) => (i === n ? { ...c, ...patch } : c)) });
  const num = (v: string, fallback: number) => (v.trim() === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));
  return (
    <section className="panel stack" data-testid="quality-settings">
      <div className="row">
        <h2 style={{ margin: 0 }}>Quality settings</h2>
        <span className="muted small">Part of the draft: save and publish to apply them to respondents.</span>
      </div>
      <fieldset disabled={readOnly} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
        <label className="check">
          <input type="checkbox" checked={q.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Score every complete (0–100)
          and record the reasons
        </label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="field">
            Minimum length (seconds)
            <input
              type="number"
              min={0}
              value={q.minSeconds ?? ''}
              placeholder="none"
              onChange={(e) => set({ minSeconds: e.target.value === '' ? undefined : num(e.target.value, 0) })}
            />
          </label>
          <label className="field">
            Speeder: under this share of the median
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={q.speederRatio}
              onChange={(e) => set({ speederRatio: num(e.target.value, 0.4) })}
            />
          </label>
          <label className="field">
            Straightlining: grids with at least (rows)
            <input
              type="number"
              min={2}
              value={q.straightlineMinRows}
              onChange={(e) => set({ straightlineMinRows: num(e.target.value, 5) })}
            />
          </label>
          <label className="field">
            Review completes scoring below
            <input type="number" min={0} max={100} value={q.reviewBelow} onChange={(e) => set({ reviewBelow: num(e.target.value, 70) })} />
          </label>
          <label className="field">
            Reject in the survey below (0 = never)
            <input type="number" min={0} max={100} value={q.rejectBelow} onChange={(e) => set({ rejectBelow: num(e.target.value, 0) })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={q.openEnds} onChange={(e) => set({ openEnds: e.target.checked })} /> Check open answers
          (gibberish, very short, copied from another respondent)
        </label>
        <label className="check">
          <input type="checkbox" checked={q.sameNetwork} onChange={(e) => set({ sameNetwork: e.target.checked })} /> Flag several completes
          from the same network (a keyed hash of the address is kept, never the address)
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <strong className="small">Survey-specific checks</strong>
          <span className="muted small">
            A check fails when its condition is true for a complete, e.g. an attention check <span className="mono">ATTN != 3</span>. Uses
            the same logic language as conditions.
          </span>
          {q.checks.map((c, n) => (
            <div className="row" key={n} style={{ flexWrap: 'wrap' }}>
              <input
                aria-label={`Check ${n + 1} id`}
                className="mono"
                style={{ width: 120 }}
                value={c.id}
                onChange={(e) => setCheck(n, { id: e.target.value })}
              />
              <input
                aria-label={`Check ${n + 1} fails when`}
                className="mono"
                style={{ flex: 1, minWidth: 200 }}
                value={c.condition}
                onChange={(e) => setCheck(n, { condition: e.target.value })}
              />
              <input
                aria-label={`Check ${n + 1} label`}
                placeholder="Label"
                value={c.label ?? ''}
                onChange={(e) => setCheck(n, { label: e.target.value || undefined })}
              />
              <input
                aria-label={`Check ${n + 1} points`}
                type="number"
                min={1}
                max={100}
                style={{ width: 70 }}
                value={c.weight}
                onChange={(e) => setCheck(n, { weight: num(e.target.value, 20) })}
              />
              <button className="link" onClick={() => set({ checks: q.checks.filter((_, i) => i !== n) })}>
                Remove
              </button>
            </div>
          ))}
          <div>
            <button onClick={() => set({ checks: [...q.checks, { id: `QC${q.checks.length + 1}`, condition: '', weight: 20 }] })}>
              + Add check
            </button>
          </div>
        </div>
      </fieldset>
    </section>
  );
}
