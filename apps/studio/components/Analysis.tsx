'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Crosstab, Frequency, RakeResult, Variable } from '@zapx/analysis-core';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';

type Status = 'COMPLETE' | 'TERMINATE' | 'QUOTA_FULL' | 'QUALITY_FAIL' | 'PARTIAL' | 'IN_PROGRESS';
type Mode = 'CAWI' | 'CAPI' | 'CATI';
interface Filters {
  statuses: Status[];
  includeTest: boolean;
  includeRejected: boolean;
  modes?: Mode[];
  from?: string;
  to?: string;
}
interface Weighting {
  dimensions: Array<{ variable: string; targets: Array<{ code: number | string; pct: number }> }>;
  minWeight: number;
  maxWeight: number;
}
type WeightingSummary = Omit<RakeResult, 'weights'>;
type ReportConfig =
  | { type: 'frequencies'; filters: Filters; weighting?: Weighting; variables?: string[] }
  | { type: 'crosstab'; filters: Filters; weighting?: Weighting; banner: string; stubs: string[]; confidence: 0.9 | 0.95 | 0.99 };
interface Report {
  id: string;
  name: string;
  config: ReportConfig;
  updatedAt: string;
}
type Result =
  | { total: number; weighting: WeightingSummary | null; frequencies: Frequency[] }
  | { total: number; weighting: WeightingSummary | null; tables: Crosstab[] };
const NO_WEIGHTING: Weighting = { dimensions: [], minWeight: 0.2, maxWeight: 5 };

const STATUS_OPTIONS: Array<[Status, string]> = [
  ['COMPLETE', 'Completes'],
  ['TERMINATE', 'Terminates'],
  ['QUOTA_FULL', 'Quota full'],
  ['QUALITY_FAIL', 'Quality fails'],
  ['PARTIAL', 'Partials'],
  ['IN_PROGRESS', 'In progress'],
];
const MODE_LABEL: Record<Mode, string> = { CAWI: 'Online', CAPI: 'Face to face', CATI: 'Phone' };
const DEFAULT_FILTERS: Filters = { statuses: ['COMPLETE'], includeTest: false, includeRejected: false };

const fmt = (n: number, d = 1) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/** Strips empty optional filters so saved reports stay small and readable. */
function cleanFilters(f: Filters): Filters {
  return {
    statuses: f.statuses,
    includeTest: f.includeTest,
    includeRejected: f.includeRejected,
    ...(f.modes?.length ? { modes: f.modes } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: `${f.to}${f.to.length === 10 ? 'T23:59:59.999Z' : ''}` } : {}),
  };
}

/**
 * Analysis (Milestone 10): frequencies and crosstabs on the live data, with column significance
 * letters, plus saved reports that anyone on the team can rerun or download as Excel.
 */
export function Analysis({ surveyId, readOnly }: { surveyId: string; readOnly: boolean }) {
  const [vars, setVars] = useState<Variable[] | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [kind, setKind] = useState<'frequencies' | 'crosstab'>('frequencies');
  const [picked, setPicked] = useState<string[]>([]);
  const [banner, setBanner] = useState('');
  const [confidence, setConfidence] = useState<0.9 | 0.95 | 0.99>(0.95);
  const [result, setResult] = useState<Result | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [openReport, setOpenReport] = useState<Report | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [weighting, setWeighting] = useState<Weighting>(NO_WEIGHTING);

  const loadReports = useCallback(async () => setReports(await api<Report[]>(`/surveys/${surveyId}/reports`)), [surveyId]);
  useEffect(() => {
    void (async () => {
      try {
        const v = await api<{ variables: Variable[] }>(`/surveys/${surveyId}/analysis/variables`);
        setVars(v.variables);
        setBanner(v.variables.find((x) => x.kind === 'single' && x.source === 'question')?.id ?? '');
        await loadReports();
      } catch (e) {
        setError(e);
      }
    })();
  }, [surveyId, loadReports]);

  const bannerOptions = useMemo(() => (vars ?? []).filter((v) => v.kind === 'single' || v.kind === 'multi' || v.kind === 'scale'), [vars]);
  const stubOptions = useMemo(
    () => (vars ?? []).filter((v) => (kind === 'crosstab' ? v.kind !== 'open' && v.id !== banner : true)),
    [vars, kind, banner],
  );

  const activeWeighting = weighting.dimensions.length ? { weighting } : {};
  const config = (): ReportConfig =>
    kind === 'crosstab'
      ? {
          type: 'crosstab',
          filters: cleanFilters(filters),
          ...activeWeighting,
          banner,
          stubs: picked.length ? picked.filter((p) => p !== banner) : stubOptions.filter((v) => v.source !== 'system').map((v) => v.id),
          confidence,
        }
      : { type: 'frequencies', filters: cleanFilters(filters), ...activeWeighting, ...(picked.length ? { variables: picked } : {}) };

  const run = async (cfg = config()) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const path = cfg.type === 'crosstab' ? 'crosstab' : 'frequencies';
      const { type: _t, ...body } = cfg;
      setResult(await api<Result>(`/surveys/${surveyId}/analysis/${path}`, { body }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const apply = (r: Report) => {
    const c = r.config;
    setOpenReport(r);
    setName(r.name);
    setKind(c.type);
    setFilters({
      ...DEFAULT_FILTERS,
      ...c.filters,
      from: c.filters.from?.slice(0, 10),
      to: c.filters.to?.slice(0, 10),
    });
    setWeighting(c.weighting ?? NO_WEIGHTING);
    if (c.type === 'crosstab') {
      setBanner(c.banner);
      setPicked(c.stubs);
      setConfidence(c.confidence);
    } else setPicked(c.variables ?? []);
    void run(c);
  };

  const save = async (asNew: boolean) => {
    setError(null);
    try {
      const body = { name: name.trim(), config: config() };
      const r =
        openReport && !asNew
          ? await api<Report>(`/reports/${openReport.id}`, { method: 'PUT', body })
          : await api<Report>(`/surveys/${surveyId}/reports`, { body });
      setOpenReport(r);
      setNotice(`Saved “${r.name}”.`);
      await loadReports();
    } catch (e) {
      setError(e);
    }
  };

  const remove = async (r: Report) => {
    if (!window.confirm(`Delete the report “${r.name}”?`)) return;
    try {
      await api(`/reports/${r.id}`, { method: 'DELETE' });
      if (openReport?.id === r.id) setOpenReport(null);
      await loadReports();
    } catch (e) {
      setError(e);
    }
  };

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (!vars) return error ? <ErrorNote error={error} /> : <p className="muted">Loading variables…</p>;

  return (
    <div className="analysis">
      <aside className="stack">
        <section className="panel stack" aria-label="Saved reports" data-testid="saved-reports">
          <h2>Saved reports</h2>
          {reports.length ? (
            <ul className="report-list">
              {reports.map((r) => (
                <li key={r.id} className={openReport?.id === r.id ? 'selected' : ''}>
                  <button className="link" onClick={() => apply(r)}>
                    {r.name}
                  </button>
                  <span className="small muted">{r.config.type === 'crosstab' ? 'Crosstab' : 'Frequencies'}</span>
                  <span className="row" style={{ gap: 4 }}>
                    <a className="small" href={`/api/reports/${r.id}/export.xlsx`} aria-label={`Download ${r.name} as Excel`}>
                      Excel
                    </a>
                    {!readOnly ? (
                      <button className="link danger small" onClick={() => void remove(r)} aria-label={`Delete ${r.name}`}>
                        Delete
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No saved reports yet.{readOnly ? '' : ' Set up a table and save it to rerun it later.'}</p>
          )}
        </section>

        <section className="panel stack" aria-label="Filters">
          <h2>Who to include</h2>
          <fieldset className="plain">
            <legend className="small muted">Interview status</legend>
            {STATUS_OPTIONS.map(([s, label]) => (
              <label key={s} className="check">
                <input
                  type="checkbox"
                  checked={filters.statuses.includes(s)}
                  onChange={() => setFilters((f) => ({ ...f, statuses: toggle(f.statuses, s) as Status[] }))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="plain">
            <legend className="small muted">Mode</legend>
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <label key={m} className="check">
                <input
                  type="checkbox"
                  checked={!!filters.modes?.includes(m)}
                  onChange={() => setFilters((f) => ({ ...f, modes: toggle(f.modes ?? [], m) as Mode[] }))}
                />
                {MODE_LABEL[m]}
              </label>
            ))}
            <span className="small muted">None ticked means all modes.</span>
          </fieldset>
          <div className="row">
            <label className="field">
              Started from
              <input
                type="date"
                value={filters.from ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))}
              />
            </label>
            <label className="field">
              to
              <input
                type="date"
                value={filters.to ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.includeTest}
              onChange={(e) => setFilters((f) => ({ ...f, includeTest: e.target.checked }))}
            />
            Include test interviews
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.includeRejected}
              onChange={(e) => setFilters((f) => ({ ...f, includeRejected: e.target.checked }))}
            />
            Include interviews rejected in quality review
          </label>
        </section>

        <WeightingPanel surveyId={surveyId} vars={vars} filters={filters} weighting={weighting} onChange={setWeighting} />
      </aside>

      <div className="stack" style={{ minWidth: 0 }}>
        <section className="panel stack" aria-label="Table setup">
          <div className="row">
            <div className="segmented" role="radiogroup" aria-label="Table type">
              {(
                [
                  ['frequencies', 'Frequencies'],
                  ['crosstab', 'Crosstab'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
            {kind === 'crosstab' ? (
              <>
                <label className="field">
                  Banner (columns)
                  <select value={banner} onChange={(e) => setBanner(e.target.value)}>
                    {bannerOptions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.id}: {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Significance
                  <select value={confidence} onChange={(e) => setConfidence(Number(e.target.value) as 0.9 | 0.95 | 0.99)}>
                    <option value={0.9}>90% confidence</option>
                    <option value={0.95}>95% confidence</option>
                    <option value={0.99}>99% confidence</option>
                  </select>
                </label>
              </>
            ) : null}
          </div>
          <fieldset className="plain">
            <legend className="small muted">
              {kind === 'crosstab' ? 'Rows (stubs)' : 'Questions'}: {picked.length ? `${picked.length} chosen` : 'all questions'}
              {picked.length ? (
                <button className="link small" onClick={() => setPicked([])}>
                  Clear
                </button>
              ) : null}
            </legend>
            <div className="var-picker">
              {stubOptions.map((v) => (
                <label key={v.id} className="check" title={v.label}>
                  <input type="checkbox" checked={picked.includes(v.id)} onChange={() => setPicked((p) => toggle(p, v.id))} />
                  <span className="mono small">{v.id}</span>
                  <span className="ellipsis">{v.label}</span>
                  {v.source === 'derived' ? <span className="badge small">derived</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="row">
            <button
              className="primary"
              disabled={busy || !filters.statuses.length || (kind === 'crosstab' && !banner)}
              onClick={() => void run()}
            >
              {busy ? 'Running…' : 'Run'}
            </button>
            {!readOnly ? (
              <>
                <input
                  aria-label="Report name"
                  placeholder="Report name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
                <button disabled={!name.trim()} onClick={() => void save(false)}>
                  {openReport ? 'Save changes' : 'Save report'}
                </button>
                {openReport ? (
                  <button disabled={!name.trim()} onClick={() => void save(true)}>
                    Save as new
                  </button>
                ) : null}
              </>
            ) : null}
            {notice ? (
              <span role="status" className="ok-text">
                {notice}
              </span>
            ) : null}
          </div>
          <ErrorNote error={error} />
        </section>

        {result ? (
          <section aria-label="Results" className="stack" data-testid="analysis-results">
            <p className="muted small">
              {result.total.toLocaleString()} interviews ·{' '}
              {result.weighting ? (
                <strong data-testid="weighted-note">
                  weighted by {result.weighting.dimensions.map((d) => d.variable).join(', ')} (efficiency{' '}
                  {fmt(result.weighting.efficiency, 0)}%, effective base {fmt(result.weighting.effectiveBase, 0)}
                  {result.weighting.converged ? '' : ', targets not fully met'})
                </strong>
              ) : (
                'unweighted'
              )}
              {'tables' in result && result.tables[0]
                ? ` · letters mark a column significantly higher than the column with that letter, at ${Math.round(result.tables[0].confidence * 100)}% confidence; columns with a base under ${result.tables[0].minBase} are not tested`
                : ''}
            </p>
            {result.total === 0 ? <p className="panel muted">No interviews match these filters yet.</p> : null}
            {result.total > 0 && 'frequencies' in result
              ? result.frequencies.map((f) => <FrequencyCard key={f.variable.id} f={f} />)
              : null}
            {result.total > 0 && 'tables' in result ? result.tables.map((t) => <CrosstabTable key={t.stub.id} t={t} />) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Where a derived variable comes from: recode source or formula, then what that uses. */
function Lineage({ v }: { v: Variable }) {
  if (v.source !== 'derived' || !v.derivation) return null;
  return (
    <p className="small muted" data-testid={`lineage-${v.id}`}>
      {v.derivation.kind === 'recode' ? (
        `Recode of ${v.derivation.from}`
      ) : (
        <>
          Calculated: <code>{v.derivation.expr}</code>
        </>
      )}
      {v.lineage?.length ? ` · from ${v.lineage.join(' ← ')}` : ''}
    </p>
  );
}

function FrequencyCard({ f }: { f: Frequency }) {
  const max = Math.max(1, ...f.rows.map((r) => r.pct));
  return (
    <article className="panel" data-testid={`freq-${f.variable.id}`}>
      <h3>
        <span className="mono">{f.variable.id}</span> {f.variable.label}
      </h3>
      <p className="small muted">
        Base: {f.unweightedBase.toLocaleString()} answered
        {f.base !== f.unweightedBase ? ` (weighted ${fmt(f.base)}, effective ${fmt(f.effectiveBase, 0)})` : ''}
        {f.variable.kind === 'multi' ? ' · more than one answer allowed, so shares can add up to more than 100%' : ''}
      </p>
      <Lineage v={f.variable} />
      {f.nps ? (
        <p className="nps" data-testid={`nps-${f.variable.id}`}>
          <span className="nps-score">{fmt(f.nps.score)}</span> Net Promoter Score
          <span className="small muted">
            {' '}
            · promoters {fmt(f.nps.promoters)}%, passives {fmt(f.nps.passives)}%, detractors {fmt(f.nps.detractors)}% of{' '}
            {f.nps.base.toLocaleString()} who gave a score
          </span>
        </p>
      ) : null}
      {f.stats ? (
        <dl className="stats">
          {(
            [
              ['Mean', f.stats.mean],
              ['Median', f.stats.median],
              ['Std. dev.', f.stats.sd],
              ['Min', f.stats.min],
              ['Max', f.stats.max],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{Number.isInteger(v) && k !== 'Mean' && k !== 'Std. dev.' ? v.toLocaleString() : fmt(v, 2)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {f.samples ? (
        f.samples.length ? (
          <ul className="samples">
            {f.samples.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No answers yet.</p>
        )
      ) : null}
      {f.rows.length ? (
        <table className="data freq">
          <thead>
            <tr>
              <th>Answer</th>
              <th className="num">Count</th>
              <th className="num">%</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {f.rows.map((r) => (
              <tr key={String(r.code)}>
                <td>{r.label}</td>
                <td className="num">{Number.isInteger(r.count) ? r.count.toLocaleString() : fmt(r.count)}</td>
                <td className="num">{fmt(r.pct)}%</td>
                <td className="bar-cell" aria-hidden="true">
                  {r.count ? <div className="hbar" style={{ width: `${(r.pct / max) * 100}%` }} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}

function CrosstabTable({ t }: { t: Crosstab }) {
  const sig = (letters: string[]) => (letters.length ? <span className="sig">{letters.join('')}</span> : null);
  return (
    <article className="panel" data-testid={`xtab-${t.stub.id}`}>
      <h3>
        <span className="mono">{t.stub.id}</span> {t.stub.label} <span className="muted">by {t.banner.label}</span>
      </h3>
      {t.testNote ? <p className="small warn-text">{t.testNote}</p> : null}
      <div className="scroll-x">
        <table className="data xtab">
          <thead>
            <tr>
              <th />
              {t.columns.map((c) => (
                <th key={c.key} className="num">
                  {c.label}
                  {c.letter ? <span className="col-letter">({c.letter})</span> : null}
                </th>
              ))}
            </tr>
            <tr className="base">
              <th>Base</th>
              {t.columns.map((c) => (
                <td key={c.key} className="num">
                  {c.unweightedBase.toLocaleString()}
                  {c.base !== c.unweightedBase ? <span className="small muted"> (w {fmt(c.base, 0)})</span> : null}
                  {c.lowBase && c.unweightedBase > 0 ? <span className="small warn-text"> low</span> : null}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={String(r.code)}>
                <th>{r.label}</th>
                {r.cells.map((c, i) => (
                  <td key={i} className="num" title={`${fmt(c.count)} of ${fmt(t.columns[i]!.base)}`}>
                    {t.columns[i]!.base ? `${fmt(c.pct)}%` : '–'} {sig(c.higherThan)}
                  </td>
                ))}
              </tr>
            ))}
            {t.means ? (
              <tr className="mean-row">
                <th>Mean</th>
                {t.means.map((m, i) => (
                  <td key={i} className="num">
                    {m.stats ? fmt(m.stats.mean, 2) : '–'} {sig(m.higherThan)}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

/**
 * Weighting (Milestone 15): rim weighting to target shares on one or more single-answer variables.
 * "Check weights" rakes the current selection and shows how well the targets were met and what the
 * weighting costs (efficiency, effective base); Run then applies the same weights to the tables.
 */
function WeightingPanel({
  surveyId,
  vars,
  filters,
  weighting,
  onChange,
}: {
  surveyId: string;
  vars: Variable[];
  filters: Filters;
  weighting: Weighting;
  onChange: (w: Weighting) => void;
}) {
  const options = vars.filter((v) => (v.kind === 'single' || v.kind === 'scale') && v.categories.length > 1);
  const unused = options.filter((v) => !weighting.dimensions.some((d) => d.variable === v.id));
  const [add, setAdd] = useState('');
  const [check, setCheck] = useState<WeightingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const byId = (id: string) => vars.find((v) => v.id === id);

  const set = (w: Weighting) => {
    setCheck(null);
    onChange(w);
  };
  const addDimension = () => {
    const v = byId(add || unused[0]?.id || '');
    if (!v) return;
    const even = Math.round((100 / v.categories.length) * 10) / 10;
    set({
      ...weighting,
      dimensions: [...weighting.dimensions, { variable: v.id, targets: v.categories.map((c) => ({ code: c.code, pct: even })) }],
    });
    setAdd('');
  };
  const setTarget = (i: number, code: number | string, pct: number) =>
    set({
      ...weighting,
      dimensions: weighting.dimensions.map((d, j) =>
        j === i ? { ...d, targets: d.targets.map((t) => (String(t.code) === String(code) ? { ...t, pct } : t)) } : d,
      ),
    });
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ weighting: WeightingSummary }>(`/surveys/${surveyId}/analysis/weights`, {
        body: { filters: cleanFilters(filters), weighting },
      });
      setCheck(r.weighting);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack" aria-label="Weighting" data-testid="weighting">
      <h2>Weighting</h2>
      {!weighting.dimensions.length ? (
        <p className="small muted">Results are unweighted. Add a variable to weight the sample to known shares, e.g. gender and age.</p>
      ) : null}
      {weighting.dimensions.map((d, i) => {
        const v = byId(d.variable);
        const sum = d.targets.reduce((a, t) => a + (Number.isFinite(t.pct) ? t.pct : 0), 0);
        const achieved = check?.dimensions.find((x) => x.variable === d.variable);
        return (
          <fieldset key={d.variable} className="plain stack" data-testid={`weight-dim-${d.variable}`}>
            <legend className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
              <span>
                <span className="mono small">{d.variable}</span> {v?.label ?? ''}
              </span>
              <button
                className="link danger small"
                onClick={() => set({ ...weighting, dimensions: weighting.dimensions.filter((_, j) => j !== i) })}
                aria-label={`Remove weighting by ${d.variable}`}
              >
                Remove
              </button>
            </legend>
            <table className="data weight-targets">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Target %</th>
                  {achieved ? (
                    <>
                      <th className="num">Sample</th>
                      <th className="num">Weighted</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {d.targets.map((t) => {
                  const label = v?.categories.find((c) => String(c.code) === String(t.code))?.label ?? String(t.code);
                  const a = achieved?.categories.find((c) => String(c.code) === String(t.code));
                  return (
                    <tr key={String(t.code)}>
                      <td>{label}</td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          aria-label={`Target for ${label}`}
                          value={Number.isFinite(t.pct) ? t.pct : ''}
                          onChange={(e) => setTarget(i, t.code, e.target.value === '' ? 0 : Number(e.target.value))}
                          style={{ width: '5.5em' }}
                        />
                      </td>
                      {a ? (
                        <>
                          <td className="num">{fmt(a.unweighted)}%</td>
                          <td className="num">{fmt(a.weighted)}%</td>
                        </>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <span className={`small ${Math.abs(sum - 100) > 0.05 ? 'warn-text' : 'muted'}`}>
              Targets add up to {fmt(sum)}%{Math.abs(sum - 100) > 0.05 ? '; they will be rescaled to 100%.' : '.'}
            </span>
          </fieldset>
        );
      })}
      {unused.length ? (
        <div className="row">
          <select aria-label="Variable to weight by" value={add} onChange={(e) => setAdd(e.target.value)}>
            {unused.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}: {v.label}
              </option>
            ))}
          </select>
          <button onClick={addDimension} disabled={weighting.dimensions.length >= 10}>
            Add
          </button>
        </div>
      ) : null}
      {weighting.dimensions.length ? (
        <>
          <div className="row">
            <label className="field">
              Lowest weight
              <input
                type="number"
                min={0.01}
                max={1}
                step={0.05}
                value={weighting.minWeight}
                onChange={(e) => set({ ...weighting, minWeight: Number(e.target.value) })}
                style={{ width: '5em' }}
              />
            </label>
            <label className="field">
              Highest weight
              <input
                type="number"
                min={1}
                max={50}
                step={0.5}
                value={weighting.maxWeight}
                onChange={(e) => set({ ...weighting, maxWeight: Number(e.target.value) })}
                style={{ width: '5em' }}
              />
            </label>
          </div>
          <button onClick={() => void run()} disabled={busy || !filters.statuses.length}>
            {busy ? 'Checking…' : 'Check weights'}
          </button>
          {check ? (
            <div className="small stack" role="status" data-testid="weight-check">
              <span className={check.converged ? 'ok-text' : 'warn-text'}>
                {check.converged ? `Targets met after ${check.iterations} passes.` : 'Targets not fully met.'}
              </span>
              <span>
                Efficiency {fmt(check.efficiency, 0)}% · effective base {fmt(check.effectiveBase, 0)} · weights {fmt(check.minWeight, 2)} to{' '}
                {fmt(check.maxWeight, 2)}
                {check.capped ? ` · ${check.capped} at a cap` : ''}
              </span>
              {check.warnings.map((w) => (
                <span key={w} className="warn-text">
                  {w}
                </span>
              ))}
            </div>
          ) : (
            <span className="small muted">Run uses these weights. Check weights first to see how well they fit.</span>
          )}
        </>
      ) : null}
      <ErrorNote error={error} />
    </section>
  );
}
