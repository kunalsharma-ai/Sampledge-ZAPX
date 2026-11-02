/**
 * Respondent-facing question components, shared by the hosted runtime and the studio preview
 * (and later the CAPI app). Rendering only: routing and validation live in @zapx/logic-engine.
 *
 * All survey text is rendered as plain text (never as HTML), so questionnaire content and piped
 * answers cannot inject markup or scripts.
 */
import { useId } from 'react';
import { conditionHoldsFor } from '@zapx/logic-engine';
import type { AnswerValue, Answers, DeviceSettings, Option, Question, Theme } from '@zapx/survey-schema';

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
        <QuestionView
          key={q.id}
          question={q}
          value={answers[q.id] ?? null}
          error={errors[q.id]}
          disabled={disabled}
          onChange={(v) => onChange(q.id, v)}
        />
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
    <fieldset
      className={`zx-question zx-${q.type}${error ? ' zx-has-error' : ''}`}
      data-question={q.id}
      aria-describedby={describedBy}
      aria-invalid={!!error}
      disabled={disabled}
    >
      <legend className="zx-text">
        {text}
        {q.required ? (
          <span className="zx-required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
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
          <input
            type={multiple ? 'checkbox' : 'radio'}
            name={name}
            value={o.code}
            checked={selected.has(o.code)}
            onChange={() => toggle(o)}
          />
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
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--zx-text);background:var(--zx-bg);min-height:100vh;container:zx/inline-size;}
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
.zx-logo{display:block;max-height:48px;max-width:200px;margin:0 0 16px;}
.zx-progress-text{color:var(--zx-muted);font-size:.85rem;margin:0 0 12px;text-align:right;}
.zx-lang{display:flex;justify-content:flex-end;margin:0 0 8px;}
.zx-lang select{font:inherit;padding:4px 8px;border:1px solid var(--zx-border);border-radius:8px;background:var(--zx-card);color:var(--zx-text);}
.zx-test-banner{background:#fff4d6;color:#5c4400;border-radius:8px;padding:6px 10px;font-size:.85rem;margin:0 0 12px;}
.zx-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
@container zx (max-width:560px){
  .zx-card{padding:18px;}
  .zx-grid thead{display:none;}
  .zx-grid tr{display:block;border-bottom:1px solid var(--zx-border);padding:8px 0;}
  .zx-grid tbody th{display:block;border:0;padding:4px 0;font-weight:600;}
  .zx-grid td{display:flex;align-items:center;gap:10px;border:0;text-align:left;padding:6px 0;}
  .zx-grid td::after{content:attr(data-label);}
}
@media (prefers-reduced-motion:reduce){.zx-root *{transition:none!important;animation:none!important;}}
`;

// ---- Themes (Milestone 3) -------------------------------------------------------------------

/** Ready-made looks offered in the Experience Studio. Each is a partial theme. */
export const THEME_PRESETS: Record<string, { name: string; theme: Partial<Theme> }> = {
  zapx: {
    name: 'ZAPX',
    theme: { accent: '#2f5bea', background: '#f6f7fb', surface: '#ffffff', text: '#1b1f2a', font: 'system', radius: 12 },
  },
  clinical: {
    name: 'Clinical',
    theme: { accent: '#0f766e', background: '#f3f7f7', surface: '#ffffff', text: '#12201f', font: 'humanist', radius: 6, motion: 'none' },
  },
  warm: {
    name: 'Warm',
    theme: { accent: '#c2410c', background: '#fbf6f1', surface: '#fffdfa', text: '#2a1d14', font: 'rounded', radius: 18 },
  },
  editorial: {
    name: 'Editorial',
    theme: { accent: '#1f2937', background: '#f7f5f0', surface: '#ffffff', text: '#111111', font: 'serif', radius: 2, motion: 'subtle' },
  },
  vivid: {
    name: 'Vivid',
    theme: { accent: '#7c3aed', background: '#f5f3ff', surface: '#ffffff', text: '#1e1b2e', font: 'rounded', radius: 20, motion: 'lively' },
  },
  midnight: {
    name: 'Midnight',
    theme: {
      accent: '#38bdf8',
      background: '#0b1220',
      surface: '#121a2b',
      text: '#e6edf7',
      font: 'system',
      radius: 12,
      colorScheme: 'light',
    },
  },
};

const FONT_STACKS: Record<Theme['font'], string> = {
  system: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  humanist: '"Segoe UI","Gill Sans","Trebuchet MS",Candara,Optima,sans-serif',
  rounded: 'ui-rounded,"SF Pro Rounded","Nunito","Varela Round","Arial Rounded MT Bold",system-ui,sans-serif',
  serif: 'Charter,"Bitstream Charter","Sitka Text",Cambria,Georgia,serif',
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, weightOfA: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v * weightOfA + y[i]! * (1 - weightOfA)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** WCAG contrast ratio between two colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Accessibility warnings for a theme (text and button contrast below WCAG AA). */
export function themeWarnings(theme: Theme): string[] {
  const w: string[] = [];
  if (contrastRatio(theme.text, theme.surface) < 4.5)
    w.push('Question text does not stand out enough from the card colour (contrast below 4.5:1).');
  if (contrastRatio(theme.text, theme.background) < 4.5) w.push('Text on the page background is hard to read (contrast below 4.5:1).');
  const onAccent = contrastRatio('#ffffff', theme.accent) >= contrastRatio('#111111', theme.accent) ? '#ffffff' : '#111111';
  if (contrastRatio(onAccent, theme.accent) < 4.5) w.push('Button text is hard to read on the accent colour (contrast below 4.5:1).');
  return w;
}

/**
 * CSS for a theme, scoped to `.zx-root`. Only design tokens, fonts and motion change; markup and
 * behaviour are the same for every theme. Values come from the validated theme schema, so they
 * cannot inject CSS.
 */
export function themeCss(theme: Theme, devices?: DeviceSettings): string {
  const onAccent = contrastRatio('#ffffff', theme.accent) >= contrastRatio('#111111', theme.accent) ? '#ffffff' : '#111111';
  const vars = [
    `--zx-bg:${theme.background}`,
    `--zx-card:${theme.surface}`,
    `--zx-text:${theme.text}`,
    `--zx-muted:${mix(theme.text, theme.surface, 0.68)}`,
    `--zx-accent:${theme.accent}`,
    `--zx-on-accent:${onAccent}`,
    `--zx-accent-soft:${mix(theme.accent, theme.surface, 0.12)}`,
    `--zx-border:${mix(theme.text, theme.surface, 0.16)}`,
    `--zx-radius:${theme.radius}px`,
    `--zx-option-radius:${Math.max(0, Math.round(theme.radius * 0.8))}px`,
  ].join(';');
  const parts = [
    `.zx-root{font-family:${FONT_STACKS[theme.font]};--zx-radius:${theme.radius}px;--zx-option-radius:${Math.max(0, Math.round(theme.radius * 0.8))}px}`,
  ];
  // auto: the theme palette in light mode, the built-in dark palette for respondents in dark mode.
  parts.push(theme.colorScheme === 'light' ? `.zx-root{${vars}}` : `@media not all and (prefers-color-scheme:dark){.zx-root{${vars}}}`);
  if (theme.density === 'compact') {
    parts.push('.zx-root .zx-page{gap:12px}.zx-root .zx-option{padding:8px 12px;min-height:40px}.zx-root .zx-card{padding:18px}');
  }
  if (theme.motion === 'subtle') {
    parts.push(
      '@keyframes zx-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.zx-root .zx-card{animation:zx-in .28s ease-out}',
    );
  } else if (theme.motion === 'lively') {
    parts.push(
      '@keyframes zx-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}@keyframes zx-pop{0%{transform:scale(1)}40%{transform:scale(1.025)}100%{transform:scale(1)}}' +
        '.zx-root .zx-card{animation:zx-in .35s cubic-bezier(.2,.8,.2,1)}.zx-root .zx-option.zx-selected{animation:zx-pop .25s ease-out}.zx-root .zx-question{animation:zx-in .35s cubic-bezier(.2,.8,.2,1) both}',
    );
  }
  if (devices?.gridOnMobile === 'scroll') {
    parts.push(
      '@container zx (max-width:560px){.zx-root .zx-grid thead{display:table-header-group}.zx-root .zx-grid tr{display:table-row;padding:0}.zx-root .zx-grid tbody th{display:table-cell;padding:10px 8px}.zx-root .zx-grid td{display:table-cell;text-align:center;padding:10px 8px;border-bottom:1px solid var(--zx-border)}.zx-root .zx-grid td::after{content:none}}',
    );
  }
  parts.push(
    '.zx-root .zx-option{border-radius:var(--zx-option-radius)}.zx-root .zx-input{border-radius:var(--zx-option-radius)}.zx-root .zx-button{border-radius:var(--zx-option-radius);color:var(--zx-on-accent,#fff)}.zx-root .zx-button.zx-secondary{color:var(--zx-accent)}',
  );
  // Respondents who ask for less motion always get none, whatever the theme says.
  parts.push('@media (prefers-reduced-motion:reduce){.zx-root *{transition:none!important;animation:none!important}}');
  return parts.join('\n');
}

/** Logo and progress header shared by the runtime and the studio preview. */
export function SurveyHeader({ theme, progress, progressLabel }: { theme?: Theme; progress?: number; progressLabel?: string }) {
  const style = theme?.progress ?? 'bar';
  return (
    <>
      {theme?.logo ? <img className="zx-logo" src={theme.logo} alt={theme.logoAlt ?? ''} /> : null}
      {progress !== undefined && style === 'bar' ? (
        <div
          className="zx-progress"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={progressLabel}
        >
          <div style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {progress !== undefined && style === 'percent' ? <p className="zx-progress-text">{progress}%</p> : null}
    </>
  );
}
