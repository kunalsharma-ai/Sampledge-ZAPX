'use client';
/**
 * Saved QA test cases (blueprint phase 2): answers plus what must happen, run against the saved
 * draft as a regression suite. Cases are saved from the Programmer debugger, or (blueprint phase 4)
 * picked from suggestions: simulated respondents chosen so every ending, page and quota is covered.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  firstMatchingTermination,
  prepareSurvey,
  suggestTestCases,
  traceRoute,
  type SuggestedCase,
  type TestCaseResult,
} from '@zapx/logic-engine';
import type { Answers, QaTestCaseInput, SurveyDefinition } from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';

interface StoredCase {
  id: string;
  name: string;
  answers: Record<string, unknown>;
  expect: { outcome?: string; shows: string[]; skips: string[] };
}

/** A test case that pins down today's behaviour for these answers: route and ending. */
export function caseFromAnswers(def: SurveyDefinition, answers: Answers, name: string): QaTestCaseInput {
  const route = traceRoute(def, answers);
  const t = firstMatchingTermination(prepareSurvey(def), answers);
  return {
    name,
    answers,
    expect: {
      outcome: t ? `${t.status}:${t.id}` : 'complete',
      shows: route.steps.filter((s) => s.shown).map((s) => s.pageId),
      skips: route.steps.filter((s) => !s.shown).map((s) => s.pageId),
    },
  };
}

export function SaveTestCase({ surveyId, def, answers }: { surveyId: string; def: SurveyDefinition; answers: Answers }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    const name = window.prompt('Name this test case', 'Route for these answers');
    if (!name?.trim()) return;
    setState('saving');
    setError(null);
    try {
      await api(`/surveys/${surveyId}/test-cases`, { body: caseFromAnswers(def, answers, name.trim()) });
      setState('saved');
    } catch (e) {
      setError(e);
      setState('idle');
    }
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" onClick={() => void save()} disabled={state === 'saving'}>
        Save as test case
      </button>
      {state === 'saved' ? <span className="muted small">Saved. Run it any time from the QA lab.</span> : null}
      <ErrorNote error={error} />
    </div>
  );
}

interface RunResult {
  version: number;
  ranAt: string;
  passed: number;
  failed: number;
  results: Array<TestCaseResult & { id: string }>;
}

export function TestCases({ surveyId, readOnly, dirty }: { surveyId: string; readOnly: boolean; dirty: boolean }) {
  const [cases, setCases] = useState<StoredCase[] | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setCases(await api<StoredCase[]>(`/surveys/${surveyId}/test-cases`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
  }, [load]);

  const runAll = async () => {
    setBusy(true);
    setError(null);
    try {
      setRun(await api<RunResult>(`/surveys/${surveyId}/test-cases/run`, { method: 'POST' }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: StoredCase) => {
    if (!window.confirm(`Delete the test case "${c.name}"?`)) return;
    try {
      await api(`/surveys/${surveyId}/test-cases/${c.id}`, { method: 'DELETE' });
      setRun(null);
      await load();
    } catch (e) {
      setError(e);
    }
  };
  const resultOf = (id: string) => run?.results.find((r) => r.id === id);

  const [suggested, setSuggested] = useState<Array<SuggestedCase & { saved?: boolean }> | null>(null);
  const suggest = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ version: { definition: SurveyDefinition } }>(`/surveys/${surveyId}/draft`);
      // Runs in the browser with the same engine as the server; nothing is saved until you choose.
      setSuggested(suggestTestCases(d.version.definition, { respondents: 400, seed: `s${Date.now().toString(36)}` }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const keep = async (i: number) => {
    const s = suggested?.[i];
    if (!s) return;
    try {
      await api(`/surveys/${surveyId}/test-cases`, { body: s.case });
      setSuggested((xs) => xs?.map((x, j) => (j === i ? { ...x, saved: true } : x)) ?? null);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="panel stack" data-testid="test-cases">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Test cases</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Saved answers with the route and ending they must produce. Run them after every change to catch logic regressions. Save new ones
            from Programmer → Debugger.
          </p>
        </div>
        {!readOnly ? (
          <button onClick={() => void suggest()} disabled={busy || dirty} title={dirty ? 'Save the draft first' : ''}>
            Suggest test cases
          </button>
        ) : null}
        {!readOnly ? (
          <button
            className="primary"
            onClick={() => void runAll()}
            disabled={busy || dirty || !cases?.length}
            title={dirty ? 'Save the draft first' : ''}
          >
            {busy ? 'Running…' : 'Run test cases'}
          </button>
        ) : null}
      </div>
      {run ? (
        <p className={run.failed ? 'error-text' : 'ok-text'} data-testid="test-case-summary">
          Draft v{run.version}: {run.passed} passed, {run.failed} failed.
        </p>
      ) : null}
      <ErrorNote error={error} />
      {suggested ? (
        <div className="flow-card stack" data-testid="suggested-cases">
          <p className="small" style={{ margin: 0 }}>
            {suggested.length
              ? `${suggested.length} suggested case${suggested.length === 1 ? '' : 's'} from 400 simulated respondents, chosen so every ending, page and quota they reached is covered. Each one passes today; save the ones you want to keep.`
              : 'The simulation found nothing to suggest (no respondent got through). Check the QA report.'}
          </p>
          {suggested.map((s, i) => (
            <div key={i} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span className="small">
                <strong>{s.case.name}</strong> <span className="muted">· covers {s.covers.join(', ')}</span>
              </span>
              <button className="small" disabled={s.saved} onClick={() => void keep(i)} aria-label={`Save ${s.case.name}`}>
                {s.saved ? 'Saved' : 'Save'}
              </button>
            </div>
          ))}
          <div>
            <button className="link small" onClick={() => setSuggested(null)}>
              Close suggestions
            </button>
          </div>
        </div>
      ) : null}
      {cases && cases.length === 0 ? <p className="muted small">No test cases yet.</p> : null}
      {cases?.length ? (
        <table className="data small">
          <thead>
            <tr>
              <th>Case</th>
              <th>Expects</th>
              <th>Result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const r = resultOf(c.id);
              return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="small">
                    {c.expect.outcome ? `ends ${c.expect.outcome}` : ''}
                    {c.expect.shows.length ? ` · shows ${c.expect.shows.join(', ')}` : ''}
                    {c.expect.skips.length ? ` · skips ${c.expect.skips.join(', ')}` : ''}
                  </td>
                  <td>
                    {r ? (
                      r.passed ? (
                        <span className="badge good">passed</span>
                      ) : (
                        <>
                          <span className="badge bad">failed</span>
                          <ul className="small" style={{ margin: '4px 0 0', paddingInlineStart: 16 }}>
                            {r.checks
                              .filter((x) => !x.passed)
                              .map((x, i) => (
                                <li key={i}>
                                  Expected {x.label}; got {x.actual}
                                </li>
                              ))}
                          </ul>
                        </>
                      )
                    ) : (
                      <span className="muted">not run</span>
                    )}
                  </td>
                  <td>
                    {!readOnly ? (
                      <button className="link small danger" onClick={() => void remove(c)} aria-label={`Delete test case ${c.name}`}>
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
