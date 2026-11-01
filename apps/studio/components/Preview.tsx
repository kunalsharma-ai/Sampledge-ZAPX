'use client';
/**
 * Live preview: runs the unsaved draft entirely in the browser with the same logic engine the
 * server uses, so programmers can walk every route before publishing. Nothing is stored.
 */
import { useMemo, useState } from 'react';
import { firstMatchingTermination, matchingQuotas, nextPageIndex, renderQuestion, validatePage } from '@zapx/logic-engine';
import { SurveyPage, answersToSubmit, defaultThemeCss, type FieldErrors } from '@zapx/survey-renderer';
import type { AnswerValue, Answers, SurveyDefinition } from '@zapx/survey-schema';

export function Preview({ def }: { def: SurveyDefinition }) {
  const [seed, setSeed] = useState(() => Math.random().toString(36).slice(2));
  const [pageIndex, setPageIndex] = useState(() => nextPageIndex(def, {}, -1));
  const [answers, setAnswers] = useState<Answers>({});
  const [pageAnswers, setPageAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [outcome, setOutcome] = useState<string | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  const restart = () => {
    setSeed(Math.random().toString(36).slice(2));
    setPageIndex(nextPageIndex(def, {}, -1));
    setAnswers({});
    setPageAnswers({});
    setErrors({});
    setOutcome(null);
  };

  const page = pageIndex >= 0 ? def.pages[pageIndex] : undefined;
  const questions = useMemo(() => (page ? page.questions.map((q) => renderQuestion(q, def, answers, seed)) : []), [page, def, answers, seed]);

  const next = () => {
    if (!page) return;
    const submitted = answersToSubmit(questions, pageAnswers, answers);
    const r = validatePage(def, page, answers, submitted);
    if (!r.ok) return setErrors(Object.fromEntries(r.errors.map((e) => [e.questionId, e.message])));
    const merged = { ...answers, ...r.answers };
    setAnswers(merged);
    setPageAnswers({});
    setErrors({});
    const t = firstMatchingTermination(def, merged);
    if (t) return setOutcome(`${t.status} (rule ${t.id})`);
    const n = nextPageIndex(def, merged, pageIndex);
    if (n === -1) {
      const q = matchingQuotas(def, merged).map((x) => x.id);
      return setOutcome(`complete${q.length ? ` · counts toward ${q.join(', ')}` : ''}`);
    }
    setPageIndex(n);
  };

  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
      <div>
        <div className="row" style={{ marginBottom: 8 }}>
          <button aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
            Desktop
          </button>
          <button aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>
            Mobile (375px)
          </button>
          <button onClick={restart}>Restart</button>
          <span className="muted small">Preview runs your current, unsaved edits. Nothing is recorded.</span>
        </div>
        <div className="preview-frame" style={{ maxWidth: device === 'mobile' ? 375 : undefined }}>
          <div className="zx-root" style={{ minHeight: 400 }}>
            <style>{defaultThemeCss}</style>
            <div className="zx-shell">
              {outcome ? (
                <div className="zx-card" data-testid="preview-outcome">
                  <p>
                    Interview ended: <strong>{outcome}</strong>
                  </p>
                  <button className="zx-button" onClick={restart}>
                    Start again
                  </button>
                </div>
              ) : page ? (
                <form
                  className="zx-card"
                  onSubmit={(e) => {
                    e.preventDefault();
                    next();
                  }}
                  noValidate
                >
                  {page.title ? <h1 className="zx-title">{page.title}</h1> : null}
                  <SurveyPage
                    questions={questions}
                    answers={pageAnswers}
                    context={answers}
                    errors={errors}
                    onChange={(id: string, v: AnswerValue) => setPageAnswers((a) => ({ ...a, [id]: v }))}
                  />
                  <div className="zx-actions">
                    <span />
                    <button className="zx-button">Next</button>
                  </div>
                </form>
              ) : (
                <div className="zx-card">No page can be shown. Check the logic report.</div>
              )}
            </div>
          </div>
        </div>
      </div>
      <aside className="panel">
        <h3>Answers so far</h3>
        <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {JSON.stringify(answers, null, 1)}
        </pre>
      </aside>
    </div>
  );
}
