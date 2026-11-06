'use client';
/** Blueprint phase 4: MaxDiff scores and conjoint part-worths for the survey's choice questions. */
import { useState } from 'react';
import type { SurveyDefinition } from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { InfoTip } from '@/components/neon/InfoTip';

interface MaxDiffOut {
  type: 'maxdiff';
  total: number;
  result: { respondents: number; items: Array<{ code: number; label: string; shown: number; best: number; worst: number; score: number }> };
}
interface ConjointOut {
  type: 'conjoint';
  total: number;
  result: {
    respondents: number;
    choices: number;
    noneShare: number | null;
    noneUtility: number | null;
    pseudoR2: number;
    converged: boolean;
    attributes: Array<{
      id: string;
      label: string;
      importance: number;
      levels: Array<{ code: number; label: string; partWorth: number; share: number }>;
    }>;
  };
}

function Bar({ value, max, negative }: { value: number; max: number; negative?: boolean }) {
  const pct = max ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <span style={{ display: 'inline-block', width: 160, height: 10, background: 'var(--border)', borderRadius: 5, position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          insetBlock: 0,
          ...(negative
            ? { right: '50%', width: `${pct / 2}%` }
            : { left: negative === false ? '50%' : 0, width: negative === false ? `${pct / 2}%` : `${pct}%` }),
          background: value < 0 ? 'var(--danger, #ef4444)' : 'var(--accent, #7c3aed)',
          borderRadius: 5,
        }}
      />
    </span>
  );
}

export function ChoiceResults({ surveyId, def }: { surveyId: string; def: SurveyDefinition }) {
  const questions = def.pages.flatMap((p) => p.questions).filter((q) => q.type === 'maxdiff' || q.type === 'conjoint');
  const [pick, setPick] = useState(questions[0]?.id ?? '');
  const [out, setOut] = useState<MaxDiffOut | ConjointOut | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!questions.length) return null;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setOut(await api(`/surveys/${surveyId}/analysis/choice/${pick}`, { method: 'POST', body: {} }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack" data-testid="choice-results">
      <h2 style={{ margin: 0 }}>
        MaxDiff and conjoint
        <InfoTip k="section.choiceResults" />
      </h2>
      <div className="row">
        <label className="field">
          Choice question
          <select value={pick} onChange={(e) => (setPick(e.target.value), setOut(null))}>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.id} · {q.type === 'maxdiff' ? 'MaxDiff' : 'Conjoint'}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? 'Estimating…' : 'Estimate'}
        </button>
        <a className="btn secondary" href={`/api/surveys/${surveyId}/analysis/choice/${pick}/design.csv`}>
          Download design
        </a>
      </div>
      <ErrorNote error={error} />
      {out?.type === 'maxdiff' ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Counting scores from {out.result.respondents} completes: (times best − times worst) ÷ times shown, from −1 to 1. Hierarchical
            Bayes utilities are not estimated.
          </p>
          <table className="data" data-testid="maxdiff-scores">
            <thead>
              <tr>
                <th>Item</th>
                <th>Score</th>
                <th />
                <th>Best</th>
                <th>Worst</th>
                <th>Shown</th>
              </tr>
            </thead>
            <tbody>
              {out.result.items.map((i) => (
                <tr key={i.code}>
                  <td>{i.label}</td>
                  <td className="mono">{i.score.toFixed(2)}</td>
                  <td>
                    <Bar value={i.score} max={1} negative={i.score < 0 ? true : false} />
                  </td>
                  <td>{i.best}</td>
                  <td>{i.worst}</td>
                  <td>{i.shown}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {out?.type === 'conjoint' ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Aggregate multinomial logit (effects coded) on {out.result.choices} choices from {out.result.respondents} completes; McFadden R²{' '}
            {out.result.pseudoR2.toFixed(2)}
            {out.result.converged ? '' : ' (did not fully converge: collect more data)'}. One model for the whole sample; individual (HB)
            utilities are not estimated.
            {out.result.noneShare !== null ? ` "None" chosen in ${(out.result.noneShare * 100).toFixed(0)}% of tasks.` : ''}
          </p>
          <table className="data" data-testid="conjoint-importance">
            <thead>
              <tr>
                <th>Attribute</th>
                <th>Importance</th>
                <th>Level</th>
                <th>Part-worth</th>
                <th>Chosen when shown</th>
              </tr>
            </thead>
            <tbody>
              {out.result.attributes.flatMap((a) =>
                a.levels.map((l, k) => (
                  <tr key={`${a.id}-${l.code}`}>
                    {k === 0 ? (
                      <>
                        <td rowSpan={a.levels.length}>{a.label}</td>
                        <td rowSpan={a.levels.length}>
                          {a.importance.toFixed(1)}% <Bar value={a.importance} max={100} />
                        </td>
                      </>
                    ) : null}
                    <td>{l.label}</td>
                    <td className="mono">{l.partWorth.toFixed(2)}</td>
                    <td>{(l.share * 100).toFixed(0)}%</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
