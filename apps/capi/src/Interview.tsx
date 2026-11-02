/**
 * One face-to-face interview, run entirely on the device with the same logic engine the server
 * uses. Answers are saved after every page. The outcome shown here is provisional: the server
 * replays the interview at sync and decides the outcome, the quotas and the quality score.
 */
import { useMemo, useRef, useState } from 'react';
import {
  firstMatchingTermination,
  localizeDefinition,
  localizeMessages,
  nextPageIndex,
  pageIsVisible,
  progressPercent,
  renderQuestion,
  validatePage,
} from '@zapx/logic-engine';
import { SurveyHeader, SurveyPage, answersToSubmit, defaultThemeCss, themeCss, type FieldErrors } from '@zapx/survey-renderer';
import { defaultPresentation, parsePresentation, parseSurveyDefinition, type AnswerValue, type Answers } from '@zapx/survey-schema';
import { interviews, type LocalInterview, type PackagedSurvey } from './store';

/** A page left open longer than this counts as this long (the interviewer stepped away). */
const MAX_PAGE_MS = 30 * 60 * 1000;

export function Interview({ survey, record, onExit }: { survey: PackagedSurvey; record: LocalInterview; onExit: () => void }) {
  const source = useMemo(() => {
    const p = parseSurveyDefinition(survey.version.definition);
    return p.ok ? p.definition : null;
  }, [survey]);
  const presentation = useMemo(() => {
    const p = parsePresentation(survey.version.presentation);
    return p.ok ? p.presentation : defaultPresentation();
  }, [survey]);
  const [current, setCurrent] = useState<LocalInterview>(record);
  const lang = presentation.languages.find((l) => l.enabled && l.tag === current.language);
  const def = useMemo(() => (source ? localizeDefinition(source, lang) : null), [source, lang]);
  const msg = useMemo(() => localizeMessages(presentation, lang), [presentation, lang]);
  const [pageAnswers, setPageAnswers] = useState<Answers>(() => pageAnswersOf(record));
  const [errors, setErrors] = useState<FieldErrors>({});
  const shownAt = useRef(Date.now());

  if (!def) return <p className="capi-card">This survey package could not be read. Update your surveys and try again.</p>;

  const page = current.pageIndex >= 0 ? def.pages[current.pageIndex] : undefined;
  const questions = page ? page.questions.map((q) => renderQuestion(q, def, current.answers, current.clientId)) : [];

  function pageAnswersOf(r: LocalInterview): Answers {
    const p = source?.pages[r.pageIndex];
    const out: Answers = {};
    for (const q of p?.questions ?? []) if (r.answers[q.id] !== undefined) out[q.id] = r.answers[q.id]!;
    return out;
  }

  const save = async (next: LocalInterview) => {
    await interviews.put(next);
    setCurrent(next);
  };

  const elapsed = () => {
    const ms = Math.min(MAX_PAGE_MS, Date.now() - shownAt.current);
    shownAt.current = Date.now();
    return ms;
  };

  const finish = (r: LocalInterview, outcome: string, endedEarly = false) =>
    save({ ...r, state: 'finished', finishedAt: new Date().toISOString(), localOutcome: outcome, endedEarly, pageIndex: -1 });

  const next = async () => {
    if (!page) return;
    const submitted = answersToSubmit(questions, pageAnswers, current.answers);
    const result = validatePage(def, page, current.answers, submitted, msg);
    if (!result.ok) {
      setErrors(Object.fromEntries(result.errors.map((e) => [e.questionId, e.message])));
      return;
    }
    const answers = { ...current.answers, ...result.answers };
    const moved = { ...current, answers, durationMs: current.durationMs + elapsed() };
    setErrors({});
    const t = firstMatchingTermination(def, answers);
    if (t) return finish(moved, t.status);
    const n = nextPageIndex(def, answers, current.pageIndex);
    if (n === -1) return finish(moved, 'complete');
    await save({ ...moved, pageIndex: n });
    setPageAnswers({});
    window.scrollTo({ top: 0 });
  };

  const back = async () => {
    for (let i = current.pageIndex - 1; i >= 0; i--) {
      if (pageIsVisible(def.pages[i]!, def, current.answers)) {
        const moved = { ...current, pageIndex: i, durationMs: current.durationMs + elapsed() };
        await save(moved);
        setPageAnswers(pageAnswersOf(moved));
        setErrors({});
        return;
      }
    }
  };

  const breakOff = async () => {
    if (!window.confirm('End this interview now? It is kept and synced as unfinished (partial).')) return;
    await finish({ ...current, durationMs: current.durationMs + elapsed() }, 'partial', true);
  };

  const languages = [
    { tag: source!.language, name: presentation.sourceLanguageName ?? source!.language },
    ...presentation.languages.filter((l) => l.enabled).map((l) => ({ tag: l.tag, name: l.name })),
  ];

  return (
    <div className="zx-root" lang={current.language}>
      <style>{defaultThemeCss}</style>
      <style>{themeCss(presentation.theme, presentation.devices)}</style>
      <div className="capi-bar">
        <button className="capi-link" onClick={onExit}>
          ← Interviews
        </button>
        <span className="capi-muted">
          {survey.name} · <span className="capi-mono">{current.clientId.slice(0, 8)}</span>
        </span>
        {languages.length > 1 && current.state === 'in_progress' ? (
          <select aria-label="Interview language" value={current.language} onChange={(e) => save({ ...current, language: e.target.value })}>
            {languages.map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="zx-shell">
        {current.state !== 'in_progress' ? (
          <div className="zx-card" data-testid="capi-finished">
            <h1 className="zx-title">Interview saved on this device</h1>
            <p>
              Result on this device: <strong>{current.localOutcome}</strong>. It is checked, counted toward quotas and scored for quality
              when you sync, so the final result can differ (for example quota full if the quota filled meanwhile).
            </p>
            <button className="zx-button" onClick={onExit}>
              Back to interviews
            </button>
          </div>
        ) : page ? (
          <form
            className="zx-card"
            key={page.id + current.language}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void next();
            }}
          >
            <SurveyHeader
              theme={presentation.theme}
              progress={def.settings.showProgress ? progressPercent(def, current.pageIndex) : undefined}
              progressLabel="Progress"
            />
            {page.title ? <h1 className="zx-title">{page.title}</h1> : null}
            <SurveyPage
              questions={questions}
              answers={pageAnswers}
              context={current.answers}
              errors={errors}
              onChange={(id: string, v: AnswerValue) => {
                setPageAnswers((a) => ({ ...a, [id]: v }));
                setErrors((e) => ({ ...e, [id]: undefined }));
              }}
            />
            <div className="zx-actions">
              {def.settings.allowBack && current.pageIndex > nextPageIndex(def, current.answers, -1) ? (
                <button type="button" className="zx-button zx-secondary" onClick={() => void back()}>
                  {msg.back}
                </button>
              ) : (
                <span />
              )}
              <button className="zx-button">{msg.next}</button>
            </div>
            <p style={{ marginTop: 16 }}>
              <button type="button" className="capi-link capi-danger" onClick={() => void breakOff()}>
                End interview early
              </button>
            </p>
          </form>
        ) : (
          <div className="zx-card">No page can be shown.</div>
        )}
      </div>
    </div>
  );
}
