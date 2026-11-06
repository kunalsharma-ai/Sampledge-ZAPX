'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';

interface Governance {
  deploymentRegion: string | null;
  dataRegion: string | null;
  regionMatches: boolean | null;
  blockExternalProcessors: boolean;
  processors: Array<{ id: string; name: string; on: boolean; blockable: boolean }>;
  retention: { responsesDays?: number; capturesDays?: number; contactsDays?: number };
  captureRetentionDays: number | null;
}

const FIELDS = [
  {
    key: 'responsesDays',
    label: 'Erase interviews after (days)',
    help: 'Answers, link data, device and network ids, location, photos and recordings. Counts stay.',
  },
  { key: 'capturesDays', label: 'Delete photos and recordings after (days)', help: 'CAPI photos, audio and video, and transcripts.' },
  {
    key: 'contactsDays',
    label: 'Erase invitation contacts after (days)',
    help: 'Email, phone, name and columns. People who unsubscribed are kept so they are never invited again.',
  },
] as const;

/**
 * Blueprint phase 5: data residency and retention for the organization (administrators).
 * Residency is a control on what SampCode sends out, not a certification; it never moves data.
 */
export function DataGovernance() {
  const [g, setG] = useState<Governance | null>(null);
  const [region, setRegion] = useState('');
  const [days, setDays] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  // Only the fields a save touched are refreshed, so a save never wipes what is being typed elsewhere.
  const show = (x: Governance, only?: Record<string, unknown>) => {
    setG(x);
    if (!only || 'dataRegion' in only) setRegion(x.dataRegion ?? '');
    if (!only || 'retention' in only)
      setDays(Object.fromEntries(FIELDS.map((f) => [f.key, x.retention[f.key] ? String(x.retention[f.key]) : ''])));
  };
  useEffect(() => {
    void api<Governance>('/organization/governance').then((x) => show(x), setError);
  }, []);

  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    setSaved(false);
    try {
      show(await api<Governance>('/organization/governance', { method: 'PUT', body: patch }), patch);
      setSaved(true);
    } catch (e) {
      setError(e);
      // Put back what the server holds.
      void api<Governance>('/organization/governance').then(
        (x) => show(x, patch),
        () => undefined,
      );
    }
  };

  return (
    <section className="panel stack" data-testid="data-governance">
      <h2 className="row" style={{ gap: 8 }}>
        <ShieldCheck size={18} aria-hidden /> Data residency and retention
      </h2>
      <ErrorNote error={error} />
      {g ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            This deployment keeps data in region <strong>{g.deploymentRegion ?? 'not declared (set DATA_REGION)'}</strong>. SampCode does
            not move data between regions; it tells you when the two differ and can stop sending data to outside services.
          </p>
          <div className="row" style={{ gap: 8, alignItems: 'end' }}>
            <label>
              Our data must stay in
              <input
                aria-label="Data region"
                placeholder="e.g. eu"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                style={{ width: 120 }}
              />
            </label>
            <button onClick={() => void save({ dataRegion: region.trim() || null })}>Save region</button>
            {g.regionMatches === false ? (
              <span className="badge bad" data-testid="region-mismatch">
                Differs from this deployment
              </span>
            ) : g.regionMatches ? (
              <span className="badge good">Matches this deployment</span>
            ) : null}
          </div>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={g.blockExternalProcessors}
              onChange={(e) => {
                // Shown at once; the saved answer (or the old value, on an error) replaces it.
                const on = e.target.checked;
                setG({ ...g, blockExternalProcessors: on });
                void save({ blockExternalProcessors: on }).catch(() => undefined);
              }}
              data-testid="block-external"
            />
            Keep our data inside this deployment: turn off AI, transcription and network lookups (outside services)
          </label>
          <table className="table small">
            <thead>
              <tr>
                <th>Outside service</th>
                <th>Configured here</th>
                <th>For us</th>
              </tr>
            </thead>
            <tbody>
              {g.processors.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.on ? 'Yes' : 'No'}</td>
                  <td>
                    {!p.on
                      ? '—'
                      : p.blockable && g.blockExternalProcessors
                        ? 'Turned off'
                        : p.blockable
                          ? 'In use'
                          : 'In use (needed to deliver it)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ margin: 0 }}>Retention</h3>
          {FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                min={1}
                max={3650}
                aria-label={f.label}
                placeholder="Keep"
                value={days[f.key] ?? ''}
                onChange={(e) => setDays({ ...days, [f.key]: e.target.value })}
                style={{ width: 120 }}
              />
              <span className="small muted">{f.help}</span>
            </label>
          ))}
          {g.captureRetentionDays ? (
            <p className="small muted" style={{ margin: 0 }}>
              This deployment also deletes photos and recordings after {g.captureRetentionDays} days (CAPTURE_RETENTION_DAYS).
            </p>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <button
              className="primary"
              data-testid="save-retention"
              onClick={() =>
                void save({ retention: Object.fromEntries(FIELDS.map((f) => [f.key, days[f.key] ? Number(days[f.key]) : null])) })
              }
            >
              Save retention
            </button>
            {saved ? <span className="small muted">Saved. The policy is applied once an hour.</span> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
