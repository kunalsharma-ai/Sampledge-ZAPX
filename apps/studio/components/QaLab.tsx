'use client';
import { useCallback, useEffect, useState } from 'react';
import type { QaReport } from '@zapx/logic-engine';
import { TestCases } from './TestCases';
import { api, waitForJob, type Job } from '@/lib/api';
import { JobProgress } from './ExportJobs';
import { ErrorNote } from './Shell';
import { InfoTip } from '@/components/neon/InfoTip';

/** Runs up to this size answer in the request; larger runs go to the background job worker. */
const DIRECT_MAX = 2000;
const JOB_MAX = 10000;

interface RunSummary {
  id: string;
  version: number;
  respondents: number;
  seed: string;
  passed: boolean;
  coverage: number;
  createdAt: string;
}

const OUTCOME_LABELS: Array<[keyof QaReport['outcomes'], string]> = [
  ['complete', 'Complete'],
  ['terminate', 'Terminate'],
  ['quality_fail', 'Quality fail'],
  ['quota_full', 'Over quota'],
  ['stuck', 'Stuck'],
  ['error', 'Engine error'],
];

/** QA Laboratory: run synthetic respondents through the survey and review coverage and defects. */
export function QaLab({ surveyId, readOnly, dirty, hasLive }: { surveyId: string; readOnly: boolean; dirty: boolean; hasLive: boolean }) {
  const [respondents, setRespondents] = useState(500);
  const [seed, setSeed] = useState('');
  const [target, setTarget] = useState<'draft' | 'live'>('draft');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [current, setCurrent] = useState<{ version: number; report: QaReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job<unknown> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await api<RunSummary[]>(`/surveys/${surveyId}/qa/runs`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { respondents, target, ...(seed.trim() ? { seed: seed.trim() } : {}) };
      if (respondents > DIRECT_MAX) {
        const queued = await api<Job<{ runId: string }>>(`/surveys/${surveyId}/jobs/qa`, { method: 'POST', body });
        setJob(queued);
        const done = await waitForJob<{ runId: string }>(queued.id, setJob);
        await open(done.result!.runId);
      } else {
        setCurrent(await api<{ version: number; report: QaReport }>(`/surveys/${surveyId}/qa/run`, { method: 'POST', body }));
      }
      await loadRuns();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setJob(null);
    }
  };

  const open = async (id: string) => {
    setError(null);
    try {
      const r = await api<{ version: number; report: QaReport }>(`/qa/runs/${id}`);
      setCurrent({ version: r.version, report: r.report });
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="editor" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
      <div className="stack">
        <div className="panel stack">
          <h2>
            QA Laboratory
            <InfoTip k="section.qaLab" />
          </h2>
          <p className="muted small">
            Sends synthetic respondents through the survey with the same logic engine live interviews use. They try every option, boundary
            values around your conditions, and skip optional questions, then report what was never reached. Nothing is saved as a response
            and quotas are not touched.
          </p>
          {!readOnly ? (
            <div className="row">
              <label className="field">
                Respondents
                <input
                  type="number"
                  min={1}
                  max={JOB_MAX}
                  value={respondents}
                  onChange={(e) => setRespondents(Math.max(1, Math.min(JOB_MAX, Number(e.target.value) || 1)))}
                  style={{ width: 110 }}
                />
              </label>
              <label className="field">
                Seed (optional)
                <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" style={{ width: 120 }} />
              </label>
              <label className="field">
                Version
                <select value={target} onChange={(e) => setTarget(e.target.value as 'draft' | 'live')}>
                  <option value="draft">Saved draft</option>
                  <option value="live" disabled={!hasLive}>
                    Live version
                  </option>
                </select>
              </label>
              <button className="primary" onClick={run} disabled={busy} style={{ alignSelf: 'flex-end' }}>
                {busy ? 'Running…' : 'Run QA'}
              </button>
            </div>
          ) : null}
          {!readOnly && respondents > DIRECT_MAX ? (
            <p className="small muted">
              Runs above {DIRECT_MAX.toLocaleString()} respondents go to the background worker. You can leave this page while it runs.
            </p>
          ) : null}
          {job ? <JobProgress job={job} /> : null}
          {dirty && target === 'draft' ? (
            <p className="small" style={{ color: 'var(--warn)' }}>
              You have unsaved edits. QA runs on the saved draft, so save first to test them.
            </p>
          ) : null}
          <ErrorNote error={error} />
        </div>
        {current ? <QaResult version={current.version} report={current.report} /> : <p className="muted">Run QA to see a report.</p>}
        <TestCases surveyId={surveyId} readOnly={readOnly} dirty={dirty} />
      </div>
      <aside className="panel">
        <h2>
          Past runs
          <InfoTip k="section.qaRuns" />
        </h2>
        {runs.length === 0 ? <p className="muted small">No runs yet.</p> : null}
        <div className="stack" style={{ gap: 6 }}>
          {runs.map((r) => (
            <button key={r.id} className="item" style={{ textAlign: 'left', fontWeight: 400 }} onClick={() => open(r.id)}>
              <span className={`badge ${r.passed ? 'good' : 'bad'}`}>{r.passed ? 'passed' : 'failed'}</span> v{r.version} · {r.respondents}{' '}
              resp · {Math.round(r.coverage)}% covered
              <div className="muted small">
                {new Date(r.createdAt).toLocaleString()} · seed {r.seed}
              </div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function QaResult({ version, report }: { version: number; report: QaReport }) {
  const uncovered = report.items.filter((i) => i.hits === 0);
  return (
    <div className="panel stack" data-testid="qa-report">
      <div className="row">
        <h2 style={{ margin: 0 }}>
          Report for v{version}{' '}
          <span className={`badge ${report.passed ? 'good' : 'bad'}`} data-testid="qa-verdict">
            {report.passed ? 'passed' : 'failed'}
          </span>
          <InfoTip k="section.qaReport" />
        </h2>
        <span className="muted small">
          {report.respondents} respondents · seed {report.seed} · {report.uniquePaths} distinct paths · {report.durationMs} ms
        </span>
      </div>
      <div className="row">
        <strong data-testid="qa-coverage">{report.coverage.percent}% coverage</strong>
        <div className="bar" style={{ flex: 1 }}>
          <div style={{ width: `${report.coverage.percent}%` }} />
        </div>
        <span className="muted small">
          {report.coverage.covered} of {report.coverage.total} pages, questions, options, branches and outcomes reached
        </span>
      </div>
      <table className="data">
        <thead>
          <tr>
            {OUTCOME_LABELS.map(([, l]) => (
              <th key={l}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {OUTCOME_LABELS.map(([k]) => (
              <td key={k}>
                {report.outcomes[k]}{' '}
                <span className="muted small">({Math.round((report.outcomes[k] / Math.max(1, report.respondents)) * 100)}%)</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <h3>Defects ({report.defects.length})</h3>
      {report.defects.length === 0 ? <p className="ok-text">No defects found.</p> : null}
      {report.defects.map((d, n) => (
        <div key={n} className={`issue ${d.severity}`}>
          <div>{d.message}</div>
          <div className="loc">
            {d.code} · {d.location}
          </div>
          {d.example ? (
            <details className="small">
              <summary>Example respondent #{d.example.index + 1}</summary>
              <div className="mono">Pages: {d.example.pages.join(' → ') || '(none)'}</div>
              {d.example.detail ? <div>{d.example.detail}</div> : null}
              <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(d.example.answers, null, 1)}
              </pre>
            </details>
          ) : null}
        </div>
      ))}

      {report.staticAnalysis.issues.length ? (
        <>
          <h3>Logic check</h3>
          {report.staticAnalysis.issues.map((i, n) => (
            <div key={n} className={`issue ${i.severity}`}>
              <div>{i.message}</div>
              <div className="loc">
                {i.code} · {i.location}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {uncovered.length ? (
        <details>
          <summary>Not reached ({uncovered.length})</summary>
          <table className="data small">
            <tbody>
              {uncovered.map((i) => (
                <tr key={`${i.kind}:${i.id}`}>
                  <td className="mono">{i.kind}</td>
                  <td>{i.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      <details>
        <summary>Sample interviews ({report.samples.length})</summary>
        <table className="data small">
          <thead>
            <tr>
              <th>#</th>
              <th>Outcome</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            {report.samples.map((s) => (
              <tr key={s.index}>
                <td>{s.index + 1}</td>
                <td>
                  <span className={`badge ${s.outcome}`}>{s.outcome}</span> {s.reason ? <span className="muted">{s.reason}</span> : null}
                </td>
                <td className="mono">{s.pages.join(' → ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
