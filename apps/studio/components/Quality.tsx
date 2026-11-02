'use client';
/**
 * Quality & fieldwork tab: the live fieldwork dashboard, the human review queue for flagged
 * completes, and the survey's quality settings (part of the draft, published like any logic).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_RECORDING_CONSENT,
  capiSettingsOf,
  qualitySettingsOf,
  type CapiSettings,
  type QualityCheck,
  type QualitySettings,
  type SurveyDefinition,
} from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
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
  modes: { cawi: number; capi: number; cati?: number };
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
  mode: 'CAWI' | 'CAPI' | 'CATI';
  qualityScore: number | null;
  qualityFlags: Flag[];
  reviewState: string;
  reviewNote: string | null;
  durationMs: number | null;
  completedAt: string | null;
  vendor: { code: string } | null;
  interviewer: { name: string } | null;
  openEnds: Array<{ questionId: string; text: string }>;
  photos: Array<Capture & { questionId: string }>;
  recording: Capture | null;
  location: { start?: Point | null; end?: Point | null; audio?: 'recorded' | 'declined' | 'unavailable' } | null;
}
interface Capture {
  id: string;
  kind: 'photo' | 'audio';
  url: string;
  size: number;
}
interface Point {
  lat: number;
  lon: number;
  accuracy: number | null;
  at: string | null;
}

/** Great-circle distance in metres (same formula as the server's gps_moved check). */
function metres(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const coords = (p: Point) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${p.accuracy !== null ? ` (±${p.accuracy} m)` : ''}`;
const AUDIO_WORDS = { recorded: 'recorded with consent', declined: 'respondent declined recording', unavailable: 'no microphone' };
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
      <CaptureSettingsEditor def={def} readOnly={readOnly} onChange={onChange} />
      <CapturesPanel surveyId={surveyId} />
      <BlockList />
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
            <Tile
              label="Starts"
              value={t.starts}
              note={
                f!.modes.capi || f!.modes.cati ? `${f!.modes.cawi} online · ${f!.modes.capi} CAPI · ${f!.modes.cati ?? 0} CATI` : undefined
              }
            />
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
  const [block, setBlock] = useState(false);
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
      const r = await api<{ accepted: number; rejected: number; skipped: number; blocked: number }>(
        `/surveys/${surveyId}/quality/decisions`,
        {
          body: {
            responseIds: [...selected],
            decision,
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(decision === 'reject' && block ? { block: true } : {}),
          },
        },
      );
      setResult(
        decision === 'accept'
          ? `Accepted ${r.accepted}${r.skipped ? `, ${r.skipped} skipped` : ''}`
          : `Rejected ${r.rejected}${r.skipped ? `, ${r.skipped} skipped` : ''}${r.blocked ? `; blocked ${r.blocked} device or network entries` : ''}`,
      );
      setNote('');
      setBlock(false);
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
              <span className="muted small">
                {i.vendor ? `vid=${i.vendor.code}` : i.interviewer ? `${i.mode} · ${i.interviewer.name}` : ''}
              </span>
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
            <Evidence item={i} />
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
          <label className="check small" title="Future completes from them are flagged in every survey of your organization">
            <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> When rejecting, also block their device
            and network
          </label>
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

/** Photos, the recording and the location of an interview, for the reviewer. Opening them is audited. */
function Evidence({ item: i }: { item: Item }) {
  const start = i.location?.start;
  const end = i.location?.end;
  if (!i.photos.length && !i.recording && !i.location) return null;
  return (
    <div className="evidence small" data-testid="evidence">
      {i.location ? (
        <div>
          <span className="muted">Location: </span>
          {start ? `started at ${coords(start)}` : 'no start location'}
          {start && end ? `, ended ${Math.round(metres(start, end))} m away` : end ? `, ended at ${coords(end)}` : ', no end location'}
          {i.location.audio ? <span className="muted"> · audio: {AUDIO_WORDS[i.location.audio]}</span> : null}
        </div>
      ) : null}
      {i.recording ? (
        <div className="row" style={{ gap: 8 }}>
          <span className="muted">Recording:</span>
          <audio controls preload="none" src={i.recording.url} aria-label={`Recording of interview ${i.uid}`} />
        </div>
      ) : null}
      {i.photos.length ? (
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          {i.photos.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="evidence-photo">
              <img src={p.url} alt={`Photo answer ${p.questionId} of ${i.uid}`} loading="lazy" />
              <span className="mono muted">{p.questionId}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CaptureSettingsEditor({
  def,
  readOnly,
  onChange,
}: {
  def: SurveyDefinition;
  readOnly: boolean;
  onChange: (d: SurveyDefinition) => void;
}) {
  const c = capiSettingsOf(def);
  const set = (patch: Partial<CapiSettings>) => onChange({ ...def, settings: { ...def.settings, capi: { ...c, ...patch } } });
  return (
    <section className="panel stack" data-testid="capture-settings">
      <div className="row">
        <h2 style={{ margin: 0 }}>Face-to-face capture</h2>
        <span className="muted small">For interviews in the ZAPX Interviewer app. Part of the draft.</span>
      </div>
      <fieldset disabled={readOnly} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="field">
            Record the interview location
            <select value={c.gps} onChange={(e) => set({ gps: e.target.value as CapiSettings['gps'] })}>
              <option value="off">No</option>
              <option value="optional">When the device allows it</option>
              <option value="required">Required: no interview without a location</option>
            </select>
          </label>
          <label className="field">
            Record the interview audio
            <select value={c.audio} onChange={(e) => set({ audio: e.target.value as CapiSettings['audio'] })}>
              <option value="off">No</option>
              <option value="consent">After the respondent agrees</option>
            </select>
          </label>
        </div>
        {c.audio === 'consent' ? (
          <label className="field">
            What the interviewer reads out to ask for consent
            <textarea
              rows={2}
              value={c.consentText ?? ''}
              placeholder={DEFAULT_RECORDING_CONSENT}
              onChange={(e) => set({ consentText: e.target.value || undefined })}
            />
          </label>
        ) : null}
        <p className="muted small" style={{ margin: 0 }}>
          The location is taken when an interview starts and ends, rounded to about a metre, and checked: an interview that ends more than 1
          km from its start, or that overlaps another interview by the same interviewer, goes to review. Recordings start only after the
          interviewer records the respondent&apos;s answer, and are never made silently.
        </p>
      </fieldset>
    </section>
  );
}

function CapturesPanel({ surveyId }: { surveyId: string }) {
  const me = useMe();
  const [s, setS] = useState<{ photos: number; recordings: number; bytes: number; retentionDays: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setS(await api(`/surveys/${surveyId}/captures`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!s || (s.photos === 0 && s.recordings === 0)) return null;
  const erase = async () => {
    if (!window.confirm(`Erase all ${s.photos} photos and ${s.recordings} recordings of this survey? This cannot be undone.`)) return;
    try {
      const r = await api<{ erased: number }>(`/surveys/${surveyId}/captures/erase`, { method: 'POST' });
      window.alert(`Erased ${r.erased} files.`);
      await load();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section className="panel row" data-testid="captures" style={{ flexWrap: 'wrap' }}>
      <div style={{ flex: 1 }}>
        <strong>Photos and recordings</strong>{' '}
        <span className="small">
          {s.photos} photo{s.photos === 1 ? '' : 's'}, {s.recordings} recording{s.recordings === 1 ? '' : 's'} (
          {(s.bytes / 1024 / 1024).toFixed(1)} MB).
        </span>{' '}
        <span className="muted small">
          {s.retentionDays ? `Deleted automatically ${s.retentionDays} days after upload.` : 'Kept until erased.'} Only your team can open
          them, and every view is recorded in the audit log.
        </span>
      </div>
      {me?.role === 'ADMIN' ? (
        <button className="danger" onClick={erase}>
          Erase all
        </button>
      ) : null}
      <ErrorNote error={error} />
    </section>
  );
}

interface Block {
  id: string;
  kind: 'device' | 'network';
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  from: { uid: string; survey: string } | null;
}

/** The organization's block list (administrators). Only keyed hashes are stored, so entries show where they came from. */
function BlockList() {
  const me = useMe();
  const [rows, setRows] = useState<Block[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setRows(await api<Block[]>('/quality/blocks'));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    if (me?.role === 'ADMIN') void load();
  }, [me, load]);
  if (me?.role !== 'ADMIN' || !rows) return null;
  return (
    <section className="panel stack" data-testid="block-list">
      <div className="row">
        <h2 style={{ margin: 0 }}>Blocked devices and networks</h2>
        <span className="muted small">For your whole organization. Completes from them are flagged in every survey and go to review.</span>
      </div>
      <ErrorNote error={error} />
      {rows.length === 0 ? (
        <p className="muted small">Nothing is blocked. Tick “also block” when rejecting a complete to add its device and network here.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>What</th>
              <th>From</th>
              <th>Note</th>
              <th>Blocked</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{b.kind}</td>
                <td>{b.from ? `${b.from.uid} in ${b.from.survey}` : '—'}</td>
                <td>{b.note ?? ''}</td>
                <td className="small">
                  {new Date(b.createdAt).toLocaleDateString()}
                  {b.createdBy ? ` by ${b.createdBy}` : ''}
                </td>
                <td>
                  <button
                    className="link"
                    onClick={async () => {
                      try {
                        await api(`/quality/blocks/${b.id}`, { method: 'DELETE' });
                        await load();
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Unblock
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CountriesField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <label className="field" style={{ maxWidth: 560 }}>
      Expected countries (two-letter codes, comma separated; empty uses the vendor&apos;s cc parameter). Checked only when your deployment
      reports respondents&apos; countries (GEO_COUNTRY_HEADER).
      <input
        value={text}
        placeholder="e.g. GB, IE"
        onChange={(e) => {
          setText(e.target.value);
          onChange([
            ...new Set(
              e.target.value
                .toUpperCase()
                .split(/[^A-Z]+/)
                .filter((x) => x.length === 2),
            ),
          ]);
        }}
      />
    </label>
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
        <label className="check">
          <input type="checkbox" checked={q.fraud} onChange={(e) => set({ fraud: e.target.checked })} /> Fraud checks: automated browsers, a
          hidden field only bots fill in, pages answered without any keyboard, mouse or touch input, pasted open answers, the same device as
          another complete, and blocked devices or networks
        </label>
        <CountriesField value={q.countries} onChange={(countries) => set({ countries })} />
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
