/**
 * Respondent-facing question components, shared by the hosted runtime and the studio preview
 * (and later the CAPI app). Rendering only: routing and validation live in @zapx/logic-engine.
 *
 * All survey text is rendered as plain text (never as HTML), so questionnaire content and piped
 * answers cannot inject markup or scripts.
 */
import { useId } from 'react';
import { conditionHoldsFor } from '@zapx/logic-engine';
import type { AnswerValue, Answers, Option, Question } from '@zapx/survey-schema';

export type DisplayQuestion = Question & { renderedText?: string; condition?: string };

export interface FieldErrors {
  [questionId: string]: string | undefined;
}

/** Questions to show right now, re-evaluating same-page conditions as answers change. */
export function visibleOnPage(questions: DisplayQuestion[], answers: Answers, context: Answers = {}): DisplayQuestion[] {
  return questions.filter((q) => conditionHoldsFor(q.condition, { ...context, ...answers }));
}

/** Keep only answers to visible questions (hidden ones are not submitted). */
export function answersToSubmit(questions: DisplayQuestion[], answers: Answers, context: Answers = {}): Answers {
  const visible = visibleOnPage(questions, answers, context);
  const out: Answers = {};
  for (const q of visible) if (q.type !== 'info' && answers[q.id] !== undefined) out[q.id] = answers[q.id]!;
  return out;
}

export interface SurveyPageProps {
  questions: DisplayQuestion[];
  answers: Answers;
  context?: Answers;
  errors?: FieldErrors;
  disabled?: boolean;
  onChange: (questionId: string, value: AnswerValue) => void;
}

export function SurveyPage({ questions, answers, context, errors = {}, disabled, onChange }: SurveyPageProps) {
  const visible = visibleOnPage(questions, answers, context);
  return (
    <div className="zx-page">
      {visible.map((q) => (
        <QuestionView key={q.id} question={q} value={answers[q.id] ?? null} error={errors[q.id]} disabled={disabled} onChange={(v) => onChange(q.id, v)} />
      ))}
    </div>
  );
}

interface QuestionViewProps {
  question: DisplayQuestion;
  value: AnswerValue;
  error?: string;
  disabled?: boolean;
  onChange: (v: AnswerValue) => void;
}

export function QuestionView({ question: q, value, error, disabled, onChange }: QuestionViewProps) {
  const id = useId();
  const text = q.renderedText ?? q.text;
  if (q.type === 'info') {
    return (
      <section className="zx-question zx-info" data-question={q.id}>
        <p className="zx-text">{text}</p>
      </section>
    );
  }
  const errId = `${id}-err`;
  const helpId = `${id}-help`;
  const describedBy = [q.help ? helpId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className={`zx-question zx-${q.type}${error ? ' zx-has-error' : ''}`} data-question={q.id} aria-describedby={describedBy} aria-invalid={!!error} disabled={disabled}>
      <legend className="zx-text">
        {text}
        {q.required ? <span className="zx-required" aria-hidden="true"> *</span> : null}
        {q.required ? <span className="zx-sr-only"> (required)</span> : null}
      </legend>
      {q.help ? (
        <p className="zx-help" id={helpId}>
          {q.help}
        </p>
      ) : null}
      {q.type === 'single' ? <ChoiceList name={id} options={q.options} multiple={false} value={value} onChange={onChange} /> : null}
      {q.type === 'multi' ? <ChoiceList name={id} options={q.options} multiple value={value} onChange={onChange} /> : null}
      {q.type === 'open' ? (
        q.multiline ? (
          <textarea
            className="zx-input zx-textarea"
            aria-label={text}
            maxLength={q.maxLength}
            rows={4}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            className="zx-input"
            type="text"
            aria-label={text}
            maxLength={q.maxLength}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      ) : null}
      {q.type === 'numeric' ? (
        <div className="zx-numeric">
          <input
            className="zx-input"
            type="number"
            inputMode={q.integer ? 'numeric' : 'decimal'}
            aria-label={text}
            min={q.min}
            max={q.max}
            step={q.integer ? 1 : 'any'}
            value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as unknown as number))}
          />
          {q.unit ? <span className="zx-unit">{q.unit}</span> : null}
        </div>
      ) : null}
      {q.type === 'grid' ? <Grid question={q} name={id} value={value} onChange={onChange} /> : null}
      {error ? (
        <p className="zx-error" id={errId} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function ChoiceList({
  name,
  options,
  multiple,
  value,
  onChange,
}: {
  name: string;
  options: Option[];
  multiple: boolean;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  const selected = new Set<number>(Array.isArray(value) ? value : typeof value === 'number' ? [value] : []);
  const toggle = (o: Option) => {
    if (!multiple) return onChange(o.code);
    const next = new Set(selected);
    if (next.has(o.code)) next.delete(o.code);
    else {
      if (o.exclusive) next.clear();
      else for (const x of options) if (x.exclusive) next.delete(x.code);
      next.add(o.code);
    }
    onChange(next.size ? [...next] : null);
  };
  return (
    <div className="zx-options" role={multiple ? 'group' : 'radiogroup'}>
      {options.map((o) => (
        <label key={o.code} className={`zx-option${selected.has(o.code) ? ' zx-selected' : ''}`}>
          <input type={multiple ? 'checkbox' : 'radio'} name={name} value={o.code} checked={selected.has(o.code)} onChange={() => toggle(o)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function Grid({
  question,
  name,
  value,
  onChange,
}: {
  question: Extract<Question, { type: 'grid' }>;
  name: string;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  const current = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, number>) : {};
  return (
    <div className="zx-grid-wrap">
      <table className="zx-grid">
        <thead>
          <tr>
            <th scope="col">
              <span className="zx-sr-only">Item</span>
            </th>
            {question.columns.map((c) => (
              <th key={c.code} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {question.rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">{r.label}</th>
              {question.columns.map((c) => (
                <td key={c.code} data-label={c.label}>
                  <input
                    type="radio"
                    name={`${name}-${r.id}`}
                    aria-label={`${r.label}: ${c.label}`}
                    checked={current[r.id] === c.code}
                    onChange={() => onChange({ ...current, [r.id]: c.code })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Default respondent theme. Themes in later milestones replace these tokens, never the logic. */
export const defaultThemeCss = `
.zx-root{--zx-bg:#f6f7fb;--zx-card:#ffffff;--zx-text:#1b1f2a;--zx-muted:#5b6475;--zx-accent:#2f5bea;--zx-accent-soft:#e8eefe;--zx-border:#d9deea;--zx-error:#c62828;--zx-radius:12px;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--zx-text);background:var(--zx-bg);min-height:100vh;}
@media (prefers-color-scheme:dark){.zx-root{--zx-bg:#0f1219;--zx-card:#181c26;--zx-text:#e8ebf2;--zx-muted:#9aa3b5;--zx-accent:#7c9bff;--zx-accent-soft:#1f2a4a;--zx-border:#2c3344;--zx-error:#ff8a80;}}
.zx-shell{max-width:720px;margin:0 auto;padding:24px 16px 64px;}
.zx-card{background:var(--zx-card);border:1px solid var(--zx-border);border-radius:var(--zx-radius);padding:24px;}
.zx-title{font-size:1.1rem;font-weight:600;margin:0 0 16px;color:var(--zx-muted);}
.zx-welcome{color:var(--zx-muted);margin:0 0 16px;}
.zx-progress{height:6px;border-radius:3px;background:var(--zx-accent-soft);overflow:hidden;margin:0 0 20px;}
.zx-progress>div{height:100%;background:var(--zx-accent);transition:width .3s ease;}
.zx-page{display:flex;flex-direction:column;gap:20px;}
.zx-question{border:0;margin:0;padding:0;min-width:0;}
.zx-text{font-size:1.05rem;font-weight:600;line-height:1.4;padding:0;margin:0 0 10px;}
.zx-help{color:var(--zx-muted);margin:-4px 0 10px;font-size:.92rem;}
.zx-required{color:var(--zx-error);}
.zx-options{display:flex;flex-direction:column;gap:8px;}
.zx-option{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--zx-border);border-radius:10px;cursor:pointer;min-height:44px;transition:border-color .15s,background .15s;}
.zx-option:hover{border-color:var(--zx-accent);}
.zx-option.zx-selected{border-color:var(--zx-accent);background:var(--zx-accent-soft);}
.zx-option input{accent-color:var(--zx-accent);width:18px;height:18px;}
.zx-input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid var(--zx-border);border-radius:10px;background:var(--zx-card);color:var(--zx-text);}
.zx-input:focus,.zx-option:focus-within{outline:2px solid var(--zx-accent);outline-offset:2px;}
.zx-numeric{display:flex;align-items:center;gap:8px;max-width:240px;}
.zx-unit{color:var(--zx-muted);}
.zx-grid-wrap{overflow-x:auto;}
.zx-grid{border-collapse:collapse;width:100%;}
.zx-grid th,.zx-grid td{padding:10px 8px;text-align:center;border-bottom:1px solid var(--zx-border);font-weight:400;}
.zx-grid tbody th{text-align:left;}
.zx-grid input{width:20px;height:20px;accent-color:var(--zx-accent);}
.zx-error{color:var(--zx-error);margin:8px 0 0;font-size:.92rem;}
.zx-has-error .zx-option,.zx-has-error .zx-input{border-color:var(--zx-error);}
.zx-actions{display:flex;justify-content:space-between;gap:12px;margin-top:24px;}
.zx-button{font:inherit;font-weight:600;padding:12px 22px;border-radius:10px;border:1px solid var(--zx-accent);background:var(--zx-accent);color:#fff;cursor:pointer;min-height:44px;}
.zx-button.zx-secondary{background:transparent;color:var(--zx-accent);}
.zx-button:disabled{opacity:.6;cursor:default;}
.zx-test-banner{background:#fff4d6;color:#5c4400;border-radius:8px;padding:6px 10px;font-size:.85rem;margin:0 0 12px;}
.zx-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
@media (max-width:560px){
  .zx-card{padding:18px;}
  .zx-grid thead{display:none;}
  .zx-grid tr{display:block;border-bottom:1px solid var(--zx-border);padding:8px 0;}
  .zx-grid tbody th{display:block;border:0;padding:4px 0;font-weight:600;}
  .zx-grid td{display:flex;align-items:center;gap:10px;border:0;text-align:left;padding:6px 0;}
  .zx-grid td::after{content:attr(data-label);}
}
@media (prefers-reduced-motion:reduce){.zx-root *{transition:none!important;animation:none!important;}}
`;
