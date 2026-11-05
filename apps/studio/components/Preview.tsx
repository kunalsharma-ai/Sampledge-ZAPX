'use client';
/**
 * Live preview: runs the unsaved draft entirely in the browser with the same logic engine the
 * server uses, in any of the survey's languages, with its theme, at desktop, tablet or phone width.
 * Nothing is stored.
 */
import { useMemo, useState } from 'react';
import {
  firstMatchingTermination,
  localizeDefinition,
  localizeMessages,
  matchingQuotas,
  hasNoOptions,
  nextPageIndex,
  prepareSurvey,
  progressPercent,
  renderQuestion,
  validatePage,
} from '@zapx/logic-engine';
import {
  SurveyHeader,
  SurveyPage,
  answersToSubmit,
  defaultThemeCss,
  pendingMedia,
  themeCss,
  type FieldErrors,
  type PhotoHandler,
} from '@zapx/survey-renderer';
import { defaultPresentation, type AnswerValue, type Answers, type Presentation, type SurveyDefinition } from '@zapx/survey-schema';

const WIDTHS = { desktop: undefined, tablet: 768, mobile: 375 } as const;
type Device = keyof typeof WIDTHS;

/** `compact`: the dashboard's small live preview (no answers panel, short toolbar, phone width first). */
export function Preview({
  def: sourceDef,
  presentation = defaultPresentation(),
  compact = false,
}: {
  def: SurveyDefinition;
  presentation?: Presentation;
  compact?: boolean;
}) {
  const [seed, setSeed] = useState(() => Math.random().toString(36).slice(2));
  const [language, setLanguage] = useState(sourceDef.language);
  const lang = presentation.languages.find((l) => l.tag === language);
  const def = useMemo(() => prepareSurvey(localizeDefinition(sourceDef, lang)), [sourceDef, lang]);
  const msg = useMemo(() => localizeMessages(presentation, lang), [presentation, lang]);
  const [pageIndex, setPageIndex] = useState(() => nextPageIndex(prepareSurvey(sourceDef), {}, -1, seed));
  const [answers, setAnswers] = useState<Answers>({});
  const [pageAnswers, setPageAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [outcome, setOutcome] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>(compact ? 'mobile' : 'desktop');
  const [played, setPlayed] = useState<ReadonlySet<string>>(new Set());
  // Preview photos stay in this browser tab; nothing is uploaded.
  const [shots] = useState(() => new Map<string, string>());
  const photos: PhotoHandler = {
    take: async (_q, photo) => {
      const ref = `preview-${Math.random().toString(36).slice(2, 12)}`;
      shots.set(ref, URL.createObjectURL(photo));
      return ref;
    },
    preview: (ref) => shots.get(ref),
  };

  const restart = () => {
    const fresh = Math.random().toString(36).slice(2);
    setSeed(fresh);
    setPageIndex(nextPageIndex(def, {}, -1, fresh));
    setAnswers({});
    setPageAnswers({});
    setErrors({});
    setOutcome(null);
  };

  const page = pageIndex >= 0 ? def.pages[pageIndex] : undefined;
  const questions = useMemo(
    () => (page ? page.questions.map((q) => renderQuestion(q, def, answers, seed)).filter((q) => !hasNoOptions(q)) : []),
    [page, def, answers, seed],
  );
  const blocked = !presentation.devices.allowed.includes(device);

  const next = () => {
    if (!page) return;
    const submitted = answersToSubmit(questions, pageAnswers, answers);
    const r = validatePage(def, page, answers, submitted, msg);
    if (!r.ok) return setErrors(Object.fromEntries(r.errors.map((e) => [e.questionId, e.message])));
    const merged = { ...answers, ...r.answers };
    setAnswers(merged);
    setPageAnswers({});
    setErrors({});
    setPlayed(new Set());
    const t = firstMatchingTermination(def, merged);
    if (t) return setOutcome(`${t.status} (rule ${t.id})`);
    const n = nextPageIndex(def, merged, pageIndex, seed);
    if (n === -1) {
      const q = matchingQuotas(def, merged).map((x) => x.id);
      return setOutcome(`complete${q.length ? ` · counts toward ${q.join(', ')}` : ''}`);
    }
    setPageIndex(n);
  };

  const languages = [
    { tag: sourceDef.language, name: presentation.sourceLanguageName ?? sourceDef.language },
    ...presentation.languages.map((l) => ({ tag: l.tag, name: `${l.name}${l.enabled ? '' : ' (not offered)'}` })),
  ];

  return (
    <div className={compact ? 'preview-compact' : 'grid2'} style={compact ? undefined : { gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
      <div>
        <div className="row" style={{ marginBottom: 8 }}>
          {(Object.keys(WIDTHS) as Device[]).map((d) => (
            <button key={d} aria-pressed={device === d} onClick={() => setDevice(d)} className={compact ? 'small' : undefined}>
              {d === 'desktop' ? 'Desktop' : d === 'tablet' ? (compact ? 'Tablet' : 'Tablet (768px)') : compact ? 'Phone' : 'Phone (375px)'}
            </button>
          ))}
          {languages.length > 1 ? (
            <select aria-label="Preview language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {languages.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : null}
          <button onClick={restart} className={compact ? 'small' : undefined}>
            Restart
          </button>
          {compact ? null : <span className="muted small">Preview runs your current, unsaved edits. Nothing is recorded.</span>}
        </div>
        <div
          className="preview-frame"
          style={{ maxWidth: WIDTHS[device], margin: device === 'desktop' ? undefined : '0 auto' }}
          data-testid="preview-frame"
        >
          <div className="zx-root" style={{ minHeight: compact ? 260 : 400 }} lang={language}>
            <style>{defaultThemeCss}</style>
            <style>{themeCss(presentation.theme, presentation.devices)}</style>
            <div className="zx-shell">
              {blocked ? (
                <div className="zx-card">
                  <p className="zx-help">Respondents on this device are screened out before the survey starts (see Design → Devices).</p>
                </div>
              ) : outcome ? (
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
                  key={`${page.id}-${language}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    next();
                  }}
                  noValidate
                >
                  <SurveyHeader
                    theme={presentation.theme}
                    progress={def.settings.showProgress ? progressPercent(def, pageIndex, seed) : undefined}
                    progressLabel="Progress"
                  />
                  {page.title ? <h1 className="zx-title">{page.title}</h1> : null}
                  <SurveyPage
                    questions={questions}
                    answers={pageAnswers}
                    context={answers}
                    errors={errors}
                    onChange={(id: string, v: AnswerValue) => setPageAnswers((a) => ({ ...a, [id]: v }))}
                    onMediaPlayed={(id) => setPlayed((p) => new Set(p).add(id))}
                    readAloud={presentation.readAloud}
                    language={def.language}
                    messages={msg}
                    photos={photos}
                  />
                  {questions.some((q) => q.type === 'photo') ? (
                    <p className="zx-media-wait">Preview: photos stay in this browser and are not uploaded.</p>
                  ) : null}
                  {pendingMedia(questions, pageAnswers, answers, played).length ? (
                    <p className="zx-media-wait">{msg.playToEnd} (Preview: you can continue without playing it.)</p>
                  ) : null}
                  <div className="zx-actions">
                    <span />
                    <button className="zx-button">{msg.next}</button>
                  </div>
                </form>
              ) : (
                <div className="zx-card">No page can be shown. Check the logic report.</div>
              )}
            </div>
          </div>
        </div>
      </div>
      {compact ? null : (
        <aside className="panel">
          <h3>Answers so far</h3>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {JSON.stringify(answers, null, 1)}
          </pre>
        </aside>
      )}
    </div>
  );
}
