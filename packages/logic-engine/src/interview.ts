/**
 * Interview engine: decides what a respondent sees next and validates what they submit.
 *
 * The same functions run on the server (authoritative), in the studio preview and, later, in the
 * offline CAPI app, so a survey behaves identically in every mode. The server never trusts the
 * client's idea of routing: it recomputes visibility and validation from the stored answers.
 */
import type {
  AnswerValue,
  Answers,
  GridQuestion,
  Option,
  Page,
  Question,
  SurveyDefinition,
  Termination,
  Quota,
} from '@zapx/survey-schema';
import { evaluate, parseCached, references, truthy, type EvalContext, type Value } from './expression.js';

/** Build an evaluation context over a set of answers. Grid rows are addressable as Q.row. */
export function contextFor(def: SurveyDefinition, answers: Answers): EvalContext {
  const known = new Set(def.pages.flatMap((p) => p.questions.map((q) => q.id)));
  return {
    lookup(name, member) {
      if (!known.has(name)) return undefined;
      const v = answers[name];
      if (v === undefined) return null;
      if (member !== undefined) {
        if (v && typeof v === 'object' && !Array.isArray(v)) return (v as Record<string, number>)[member] ?? null;
        return null;
      }
      return v as Value;
    },
  };
}

/** Evaluate a condition; a condition that fails to parse is treated as false (publish blocks it). */
export function conditionHolds(expr: string | undefined, def: SurveyDefinition, answers: Answers): boolean {
  if (!expr) return true;
  try {
    return truthy(evaluate(parseCached(expr), contextFor(def, answers)));
  } catch {
    return false;
  }
}

/**
 * Questions on a page that are visible given the answers so far. Conditions may refer to earlier
 * questions on the same page; renderers re-evaluate this as the respondent answers.
 */
export function visibleQuestions(page: Page, def: SurveyDefinition, answers: Answers): Question[] {
  return page.questions.filter((q) => conditionHolds(q.condition, def, answers));
}

/**
 * A page is shown when its own condition holds and at least one question could be shown. Questions
 * whose conditions depend only on same-page answers count as possibly visible.
 */
export function pageIsVisible(page: Page, def: SurveyDefinition, answers: Answers): boolean {
  if (!conditionHolds(page.condition, def, answers)) return false;
  const samePage = new Set(page.questions.map((q) => q.id));
  return page.questions.some((q) => {
    if (conditionHolds(q.condition, def, answers)) return true;
    return dependsOn(q.condition, samePage);
  });
}

function dependsOn(expr: string | undefined, ids: Set<string>): boolean {
  if (!expr) return false;
  try {
    return references(parseCached(expr)).some((r) => ids.has(r.name));
  } catch {
    return false;
  }
}

/** Index of the next visible page after `fromIndex` (use -1 to start), or -1 when the survey ends. */
export function nextPageIndex(def: SurveyDefinition, answers: Answers, fromIndex: number): number {
  for (let i = fromIndex + 1; i < def.pages.length; i++) {
    if (pageIsVisible(def.pages[i]!, def, answers)) return i;
  }
  return -1;
}

/** First termination rule that matches, if any. Evaluated after every page. */
export function firstMatchingTermination(def: SurveyDefinition, answers: Answers): Termination | undefined {
  return def.terminations.find((t) => conditionHolds(t.condition, def, answers));
}

/** Quotas whose condition this respondent currently satisfies. */
export function matchingQuotas(def: SurveyDefinition, answers: Answers): Quota[] {
  return def.quotas.filter((q) => conditionHolds(q.condition, def, answers));
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export interface FieldError {
  questionId: string;
  message: string;
}

export interface PageValidationResult {
  ok: boolean;
  errors: FieldError[];
  /** Normalized answers for the page's visible questions (hidden questions are cleared to null). */
  answers: Answers;
}

function optionCodes(options: Option[]): Set<number> {
  return new Set(options.map((o) => o.code));
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)
  );
}

/** Coerce and check one submitted answer. Returns the normalized value or an error message. */
export function normalizeAnswer(q: Question, raw: unknown): { value: AnswerValue } | { error: string } {
  if (q.type === 'info') return { value: null };
  if (isEmpty(raw)) {
    return q.required ? { error: 'This question requires an answer.' } : { value: null };
  }
  switch (q.type) {
    case 'single': {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof n !== 'number' || !optionCodes(q.options).has(n)) return { error: 'Choose one of the listed options.' };
      return { value: n };
    }
    case 'multi': {
      if (!Array.isArray(raw)) return { error: 'Choose one or more of the listed options.' };
      const codes = optionCodes(q.options);
      const vals = [...new Set(raw.map((x) => (typeof x === 'string' ? Number(x) : x)))];
      if (!vals.every((v): v is number => typeof v === 'number' && codes.has(v)))
        return { error: 'Choose only the listed options.' };
      const exclusive = q.options.filter((o) => o.exclusive).map((o) => o.code);
      if (vals.length > 1 && vals.some((v) => exclusive.includes(v))) {
        const label = q.options.find((o) => o.exclusive && vals.includes(o.code))?.label ?? 'This option';
        return { error: `"${label}" cannot be combined with other answers.` };
      }
      if (q.minSelected !== undefined && vals.length < q.minSelected)
        return { error: `Choose at least ${q.minSelected}.` };
      if (q.maxSelected !== undefined && vals.length > q.maxSelected)
        return { error: `Choose at most ${q.maxSelected}.` };
      return { value: vals.sort((a, b) => a - b) };
    }
    case 'open': {
      if (typeof raw !== 'string') return { error: 'Enter text.' };
      const text = raw.trim();
      if (text.length > q.maxLength) return { error: `Use at most ${q.maxLength} characters.` };
      return { value: text };
    }
    case 'numeric': {
      const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'Enter a number.' };
      if (q.integer && !Number.isInteger(n)) return { error: 'Enter a whole number.' };
      if (q.min !== undefined && n < q.min) return { error: `Enter a number of at least ${q.min}.` };
      if (q.max !== undefined && n > q.max) return { error: `Enter a number no greater than ${q.max}.` };
      return { value: n };
    }
    case 'grid': {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'Answer each row.' };
      const cols = optionCodes(q.columns);
      const rows = new Set(q.rows.map((r) => r.id));
      const out: Record<string, number> = {};
      for (const [rowId, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!rows.has(rowId)) return { error: 'Unknown row.' };
        if (v === null || v === undefined || v === '') continue;
        const n = typeof v === 'string' ? Number(v) : v;
        if (typeof n !== 'number' || !cols.has(n)) return { error: 'Choose one of the listed options in each row.' };
        out[rowId] = n;
      }
      if (q.required && q.rows.some((r) => out[r.id] === undefined)) return { error: 'Answer every row.' };
      return { value: Object.keys(out).length ? out : null };
    }
  }
}

/**
 * Validate a page submission against the current answers.
 * Only visible questions are accepted; values for hidden or unknown questions are ignored.
 */
export function validatePage(
  def: SurveyDefinition,
  page: Page,
  priorAnswers: Answers,
  submitted: Record<string, unknown>,
): PageValidationResult {
  // Visibility is decided in page order: a question may depend on earlier questions on the same
  // page (e.g. "Other, please specify"), so each condition sees the answers accepted so far.
  const pageAnswers: Answers = {};
  const visible: Question[] = [];
  const errors: FieldError[] = [];
  for (const q of page.questions) {
    const shown = conditionHolds(q.condition, def, { ...priorAnswers, ...pageAnswers });
    if (shown) visible.push(q);
    if (q.type === 'info') continue;
    if (!shown) {
      pageAnswers[q.id] = null;
      continue;
    }
    const r = normalizeAnswer(q, submitted[q.id]);
    if ('error' in r) {
      errors.push({ questionId: q.id, message: r.error });
      pageAnswers[q.id] = null;
    } else pageAnswers[q.id] = r.value;
  }
  if (errors.length === 0) {
    const merged = { ...priorAnswers, ...pageAnswers };
    for (const q of visible) {
      if (q.type === 'info' || pageAnswers[q.id] === null) continue;
      for (const rule of q.validations) {
        if (!conditionHolds(rule.expr, def, merged)) {
          errors.push({ questionId: q.id, message: rule.message });
          break;
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, answers: pageAnswers };
}

// ---------------------------------------------------------------------------------------------
// Presentation helpers: piping and randomization
// ---------------------------------------------------------------------------------------------

/** Text form of an answer, used for piping ({{Q1}}). */
export function answerText(def: SurveyDefinition, id: string, answers: Answers): string {
  const q = def.pages.flatMap((p) => p.questions).find((x) => x.id === id);
  const v = answers[id];
  if (!q || v === null || v === undefined) return '';
  if (q.type === 'single') return q.options.find((o) => o.code === v)?.label ?? String(v);
  if (q.type === 'multi' && Array.isArray(v))
    return v.map((c) => q.options.find((o) => o.code === c)?.label ?? String(c)).join(', ');
  if (typeof v === 'object') return '';
  return String(v);
}

export const PIPE_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** Replace {{VAR}} placeholders with answer text. Output is plain text; renderers must not treat it as HTML. */
export function pipeText(text: string, def: SurveyDefinition, answers: Answers): string {
  return text.replace(PIPE_PATTERN, (_, id: string) => answerText(def, id, answers));
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffle items for one respondent. Anchored items keep their position.
 * The same seed always yields the same order, so a respondent who resumes sees the same list.
 */
export function seededOrder<T>(items: T[], seed: string, isAnchored: (item: T) => boolean = () => false): T[] {
  const rand = mulberry32(hashSeed(seed));
  const free = items.filter((x) => !isAnchored(x));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [free[i], free[j]] = [free[j]!, free[i]!];
  }
  let k = 0;
  return items.map((x) => (isAnchored(x) ? x : free[k++]!));
}

/** A question prepared for display: piping applied and options in this respondent's order. */
export type RenderedQuestion = Question & { renderedText: string };

export function renderQuestion(q: Question, def: SurveyDefinition, answers: Answers, seed: string): RenderedQuestion {
  const renderedText = pipeText(q.text, def, answers);
  if ((q.type === 'single' || q.type === 'multi') && q.randomize) {
    return { ...q, renderedText, options: seededOrder(q.options, `${seed}:${q.id}`, (o) => !!o.anchor) };
  }
  if (q.type === 'grid' && q.randomizeRows) {
    const g: GridQuestion = { ...q, rows: seededOrder(q.rows, `${seed}:${q.id}`) };
    return { ...g, renderedText };
  }
  return { ...q, renderedText };
}

/** Rough progress through the survey, 0..100, based on page position. */
export function progressPercent(def: SurveyDefinition, pageIndex: number): number {
  if (pageIndex < 0) return 100;
  return Math.round((pageIndex / def.pages.length) * 100);
}
