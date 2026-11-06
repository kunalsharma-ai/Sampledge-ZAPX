'use client';
/**
 * SAMPLEON audiences for a survey (docs/modules/sampleon.md).
 *
 * Two ways in: a survey run for a PROJEXA project is connected here and its launch link is pasted
 * into PROJEXA, which sends the audience request; an independent survey asks SAMPLEON for an
 * audience directly. Either way a supply approver approves the audience in SAMPLEON before anyone
 * is invited, and respondents' outcomes go back to SAMPLEON through the SAMPLEON vendor.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CopyField, ErrorNote } from './Shell';

interface RequestRow {
  id: string;
  audienceRequestId: string;
  sourcePlatform: string;
  status: string;
  title: string | null;
  countries: string[];
  requiredCompletes: number;
  completes: number;
  remaining: number | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  createdAt: string;
}
interface Overview {
  configured: boolean;
  launchUrl: string;
  requests: RequestRow[];
}

const TONE: Record<string, string> = {
  live: 'live',
  soft_launch: 'live',
  approved: 'good',
  paused: 'paused',
  submitted: 'pending',
  feasibility_ready: 'pending',
  closed: 'closed',
  rejected: 'bad',
};
const label = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ');
const today = (plusDays = 0) => new Date(Date.now() + plusDays * 86_400_000).toISOString().slice(0, 10);

export function Sampleon({
  surveyId,
  surveyName,
  readOnly,
  live,
}: {
  surveyId: string;
  surveyName: string;
  readOnly: boolean;
  live: boolean;
}) {
  const [view, setView] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<Overview>(`/surveys/${surveyId}/sampleon`).then(setView).catch(setError), [surveyId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!view) return error ? <ErrorNote error={error} /> : <p className="muted">Loading SAMPLEON…</p>;
  if (!view.configured) {
    return (
      <section className="panel stack">
        <h2>SAMPLEON audiences</h2>
        <p className="muted small">
          SAMPLEON is not connected. An administrator sets SAMPLEON_URL, SAMPLEON_CLIENT_SECRET and SAMPLEON_OUTCOME_SECRET for the API, and
          registers ZAPX as a survey host in SAMPLEON.
        </p>
      </section>
    );
  }
  return (
    <section className="panel stack">
      <h2>SAMPLEON audiences</h2>
      <p className="muted small">
        Get respondents from the SUPPLY360 panels. SAMPLEON checks feasibility, a supply approver approves the audience before any
        invitation goes out, and outcomes go back to SAMPLEON automatically.
      </p>
      {!live ? (
        <p className="small" style={{ color: 'var(--q-warn)' }}>
          Publish the survey before the audience is launched; invited respondents open the live version.
        </p>
      ) : null}
      <div className="grid2">
        <ForProjexa surveyId={surveyId} launchUrl={view.launchUrl} readOnly={readOnly} />
        <NewRequest surveyId={surveyId} surveyName={surveyName} readOnly={readOnly} onSent={load} />
      </div>
      <Requests rows={view.requests} />
    </section>
  );
}

function ForProjexa({ surveyId, launchUrl, readOnly }: { surveyId: string; launchUrl: string; readOnly: boolean }) {
  const [connected, setConnected] = useState<{ launchUrl: string; vendorCode: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      setConnected(await api<{ launchUrl: string; vendorCode: string }>(`/surveys/${surveyId}/sampleon/connect`, { body: {} }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <h3>For a PROJEXA project</h3>
      <p className="muted small">
        Connect the survey, then paste the launch link and the survey ID into the project&apos;s SAMPLEON tab in PROJEXA. PROJEXA sends the
        request with the project&apos;s targets and quotas.
      </p>
      <div>
        <button onClick={connect} disabled={readOnly || busy}>
          {busy ? 'Connecting…' : connected ? 'Connected' : 'Connect to SAMPLEON'}
        </button>
      </div>
      <ErrorNote error={error} />
      {connected ? (
        <p className="small muted">Outcomes go back to SAMPLEON through the {connected.vendorCode} vendor of this project.</p>
      ) : null}
      <CopyField label="Survey ID" value={surveyId} />
      <CopyField label="Launch link" value={connected?.launchUrl ?? launchUrl} />
    </div>
  );
}

function NewRequest({
  surveyId,
  surveyName,
  readOnly,
  onSent,
}: {
  surveyId: string;
  surveyName: string;
  readOnly: boolean;
  onSent: () => void;
}) {
  const [f, setF] = useState({
    title: surveyName,
    countries: 'US',
    requiredCompletes: '100',
    audience: '',
    incidence: '30',
    loi: '15',
    points: '500',
    start: today(),
    end: today(14),
    language: 'en',
    allowRouting: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const countries = f.countries
    .split(/[\s,]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const countriesOk = countries.length > 0 && countries.every((c) => /^[A-Z]{2}$/.test(c));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const r = await api<{ record: RequestRow }>(`/surveys/${surveyId}/sampleon/audience-requests`, {
        body: {
          title: f.title.trim() || undefined,
          countries: [...new Set(countries)],
          requiredCompletes: Number(f.requiredCompletes),
          targeting: { naturalLanguage: f.audience.trim() },
          expectedIncidence: Math.min(1, Math.max(0.01, Number(f.incidence) / 100)),
          loiMinutes: Number(f.loi),
          reward: { points: Number(f.points) },
          fieldwork: { start: f.start, end: f.end },
          language: f.language.trim() || 'en',
          allowRouting: f.allowRouting,
        },
      });
      setSent(r.record.audienceRequestId);
      set('audience', '');
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <h3>For this survey on its own</h3>
      <label className="field">
        Who should take part
        <textarea
          required
          minLength={3}
          maxLength={2000}
          rows={3}
          value={f.audience}
          onChange={(e) => set('audience', e.target.value)}
          placeholder="Cardiologists in the US and UK with at least five years of professional experience"
        />
      </label>
      <div className="row">
        <label className="field">
          Countries
          <input
            required
            value={f.countries}
            onChange={(e) => set('countries', e.target.value)}
            placeholder="US, GB"
            style={{ width: 120 }}
          />
        </label>
        <label className="field">
          Completes
          <input
            required
            type="number"
            min={1}
            step={1}
            value={f.requiredCompletes}
            onChange={(e) => set('requiredCompletes', e.target.value)}
            style={{ width: 100 }}
          />
        </label>
        <label className="field">
          Incidence %
          <input
            required
            type="number"
            min={1}
            max={100}
            value={f.incidence}
            onChange={(e) => set('incidence', e.target.value)}
            style={{ width: 80 }}
          />
        </label>
        <label className="field">
          LOI (min)
          <input
            required
            type="number"
            min={1}
            max={180}
            step={1}
            value={f.loi}
            onChange={(e) => set('loi', e.target.value)}
            style={{ width: 80 }}
          />
        </label>
      </div>
      <div className="row">
        <label className="field">
          Reward (points)
          <input
            required
            type="number"
            min={0}
            step={1}
            value={f.points}
            onChange={(e) => set('points', e.target.value)}
            style={{ width: 110 }}
          />
        </label>
        <label className="field">
          Field start
          <input required type="date" value={f.start} onChange={(e) => set('start', e.target.value)} />
        </label>
        <label className="field">
          Field end
          <input required type="date" min={f.start} value={f.end} onChange={(e) => set('end', e.target.value)} />
        </label>
        <label className="field">
          Language
          <input value={f.language} onChange={(e) => set('language', e.target.value)} style={{ width: 70 }} />
        </label>
      </div>
      <label className="row small">
        <input type="checkbox" checked={f.allowRouting} onChange={(e) => set('allowRouting', e.target.checked)} /> Offer screened-out
        respondents another survey
      </label>
      {!countriesOk && f.countries ? (
        <span className="small" style={{ color: 'var(--q-warn)' }}>
          Use two-letter country codes, e.g. US, GB, DE.
        </span>
      ) : null}
      <ErrorNote error={error} />
      {sent ? (
        <p className="small" style={{ color: 'var(--q-good)' }}>
          Sent as <span className="mono">{sent}</span>. A supply approver reviews it in SAMPLEON before anyone is invited.
        </p>
      ) : null}
      <div>
        <button className="primary" disabled={readOnly || busy || !countriesOk}>
          {busy ? 'Sending…' : 'Send to SAMPLEON'}
        </button>
      </div>
    </form>
  );
}

function Requests({ rows }: { rows: RequestRow[] }) {
  if (!rows.length) return <p className="muted small">No audience requests for this survey yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data">
        <thead>
          <tr>
            <th>Request</th>
            <th>From</th>
            <th>Status</th>
            <th>Countries</th>
            <th>Completes</th>
            <th>Last update</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono small" style={{ whiteSpace: 'nowrap' }}>
                {r.audienceRequestId}
              </td>
              <td>{r.sourcePlatform === 'PROJEXA' ? 'PROJEXA project' : 'This survey'}</td>
              <td>
                <span className={`badge ${TONE[r.status] ?? ''}`}>{label(r.status)}</span>
              </td>
              <td>{r.countries.join(', ')}</td>
              <td className="mono">
                {r.completes} / {r.requiredCompletes}
              </td>
              <td className="small muted">
                {r.lastEventType
                  ? `${r.lastEventType.replace(/[._]/g, ' ')} · ${new Date(r.lastEventAt!).toLocaleString()}`
                  : 'Waiting for SAMPLEON'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
