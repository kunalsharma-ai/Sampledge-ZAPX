/**
 * Survey flow (blueprint phase 1): loops, randomized blocks and dynamic answer lists.
 *
 * Loops are compiled away: `compileSurvey` copies a loop's pages once per item, renaming the looped
 * variables (`Q5` -> `Q5_3`). Everything downstream (routing, validation, QA, exports, analysis, CAPI)
 * then works on plain pages and questions, so loops need no special case anywhere else and the data
 * is one row per respondent with one column per pass, as in Decipher and Qualtrics loop exports.
 *
 * Blocks are applied per respondent at run time through `pageOrder`, seeded by the interview id, so
 * the order is stable when a respondent resumes and the server, preview, QA lab and CAPI app agree.
 */
import type { Answers, Option, Page, Question, SurveyDefinition } from '@zapx/survey-schema';
import { ExpressionError, rewriteVariables } from './expression.js';
import { PIPE_PATTERN, seededOrder } from './interview.js';

export interface FlowIssue {
  message: string;
  location: string;
}

/** Suffix of looped variables for an item code. */
export const loopSuffix = (code: number) => `_${code}`;

function loopItemsOf(def: SurveyDefinition, loop: SurveyDefinition['loops'][number]): Array<{ code: number; label: string }> {
  if (loop.items.length) return loop.items;
  if (!loop.source) return [];
  const src = def.pages.flatMap((p) => p.questions).find((q) => q.id === loop.source);
  if (src && (src.type === 'single' || src.type === 'multi'))
    return src.options.filter((o) => o.code >= 0).map((o) => ({ code: o.code, label: o.label }));
  return [];
}

/** Pages of a page-id list as a run of consecutive indexes, or an error message. */
function consecutive(def: SurveyDefinition, ids: string[], what: string): { start: number; end: number } | string {
  const idx = ids.map((id) => def.pages.findIndex((p) => p.id === id));
  const missing = ids.filter((_, i) => idx[i]! < 0);
  if (missing.length)
    return `${what} refers to page${missing.length > 1 ? 's' : ''} ${missing.join(', ')}, which do${missing.length > 1 ? '' : 'es'} not exist.`;
  if (new Set(ids).size !== ids.length) return `${what} lists a page twice.`;
  const sorted = [...idx].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1]! + 1) return `${what}: its pages must follow one another.`;
  return { start: sorted[0]!, end: sorted[sorted.length - 1]! };
}

/** Structural checks for loops, blocks and calculated variables (errors block publishing). */
export function checkFlow(def: SurveyDefinition): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const loops = def.loops ?? [];
  const blocks = def.blocks ?? [];
  const usedByLoop = new Map<string, string>();
  const questionIds = new Set(def.pages.flatMap((p) => p.questions.map((q) => q.id.toLowerCase())));
  for (const loop of loops) {
    const loc = `loops.${loop.id}`;
    if (questionIds.has(loop.id.toLowerCase())) issues.push({ message: `Loop id "${loop.id}" is also a question id.`, location: loc });
    const span = consecutive(def, loop.pages, `Loop ${loop.id}`);
    if (typeof span === 'string') {
      issues.push({ message: span, location: loc });
      continue;
    }
    for (const p of loop.pages) {
      const other = usedByLoop.get(p);
      if (other) issues.push({ message: `Page ${p} is in loops ${other} and ${loop.id}; a page can be in one loop only.`, location: loc });
      usedByLoop.set(p, loop.id);
    }
    if (loop.source) {
      const si = def.pages.findIndex((p) => p.questions.some((q) => q.id === loop.source));
      const src = def.pages[si]?.questions.find((q) => q.id === loop.source);
      if (!src || (src.type !== 'single' && src.type !== 'multi'))
        issues.push({ message: `Loop ${loop.id}: "${loop.source}" must be a single or multiple choice question.`, location: loc });
      else if (si >= span.start) issues.push({ message: `Loop ${loop.id}: ${loop.source} must be asked before the loop.`, location: loc });
      else if (loop.items.length) {
        const codes = new Set(src.options.map((o) => o.code));
        const bad = loop.items.filter((i) => !codes.has(i.code)).map((i) => i.code);
        if (bad.length)
          issues.push({
            message: `Loop ${loop.id}: ${loop.source} has no option${bad.length > 1 ? 's' : ''} ${bad.join(', ')}.`,
            location: loc,
          });
      }
    }
    const items = loopItemsOf(def, loop);
    if (!items.length) issues.push({ message: `Loop ${loop.id} has no items to loop over.`, location: loc });
    if (new Set(items.map((i) => i.code)).size !== items.length)
      issues.push({ message: `Loop ${loop.id} has an item code twice.`, location: loc });
    // The copies must not clash with existing variables.
    const looped = def.pages.slice(span.start, span.end + 1).flatMap((p) => p.questions.map((q) => q.id));
    for (const id of looped)
      for (const it of items) {
        const copy = `${id}${loopSuffix(it.code)}`;
        if (copy.length > 64) issues.push({ message: `Loop ${loop.id}: ${copy} would be longer than 64 characters.`, location: loc });
        else if (questionIds.has(copy.toLowerCase()))
          issues.push({ message: `Loop ${loop.id}: the copy ${copy} clashes with an existing question.`, location: loc });
      }
    // Questions after the loop cannot address looped variables by their template id.
  }
  const inBlock = new Map<string, string>();
  for (const b of blocks) {
    const loc = `blocks.${b.id}`;
    const span = consecutive(def, b.pages, `Block ${b.id}`);
    if (typeof span === 'string') {
      issues.push({ message: span, location: loc });
      continue;
    }
    for (const p of b.pages) {
      if (inBlock.has(p)) issues.push({ message: `Page ${p} is in blocks ${inBlock.get(p)} and ${b.id}.`, location: loc });
      inBlock.set(p, b.id);
      if (usedByLoop.has(p))
        issues.push({
          message: `Page ${p} is in loop ${usedByLoop.get(p)} and block ${b.id}; randomize the loop's source list instead.`,
          location: loc,
        });
    }
    if (b.pick !== undefined && b.pick > b.pages.length)
      issues.push({ message: `Block ${b.id} picks ${b.pick} pages but has ${b.pages.length}.`, location: loc });
  }
  const varIds = new Set<string>();
  for (const v of def.variables ?? []) {
    const key = v.id.toLowerCase();
    if (questionIds.has(key) || varIds.has(key))
      issues.push({ message: `Variable "${v.id}" is used more than once.`, location: `variables.${v.id}` });
    varIds.add(key);
  }
  return issues;
}

function renameIn(expr: string | undefined, rename: (n: string) => string | undefined): string | undefined {
  if (expr === undefined) return undefined;
  try {
    return rewriteVariables(expr, rename);
  } catch (e) {
    if (e instanceof ExpressionError) return expr; // reported by the logic check
    throw e;
  }
}

function pipeIn(text: string, loopId: string, label: string, looped: Set<string>, suffix: string): string {
  return text.replace(PIPE_PATTERN, (m, id: string) => {
    if (id === loopId) return label;
    if (looped.has(id)) return `{{${id}${suffix}}}`;
    return m;
  });
}

function copyQuestion(q: Question, loopId: string, item: { code: number; label: string }, looped: Set<string>): Question {
  const suffix = loopSuffix(item.code);
  const rename = (n: string) => (n === loopId ? String(item.code) : looped.has(n) ? `${n}${suffix}` : undefined);
  const out = { ...q, id: `${q.id}${suffix}`, text: pipeIn(q.text, loopId, item.label, looped, suffix) } as Question;
  if (q.condition) out.condition = renameIn(q.condition, rename);
  if ('help' in q && q.help) (out as { help?: string }).help = pipeIn(q.help, loopId, item.label, looped, suffix);
  if (q.type !== 'info')
    (out as Exclude<Question, { type: 'info' }>).validations = q.validations.map((v) => ({ ...v, expr: renameIn(v.expr, rename)! }));
  if ((q.type === 'single' || q.type === 'multi' || q.type === 'ranking') && q.optionsFrom && looped.has(q.optionsFrom.question))
    (out as typeof q).optionsFrom = { ...q.optionsFrom, question: `${q.optionsFrom.question}${suffix}` };
  return out;
}

const compiledCache = new WeakMap<object, SurveyDefinition>();

/**
 * The definition with every loop expanded into ordinary pages. Idempotent: a definition without
 * loops is returned as it is. Invalid loops (see `checkFlow`) are left out; publishing blocks them.
 */
export function compileSurvey(def: SurveyDefinition): SurveyDefinition {
  const loops = def.loops ?? [];
  if (!loops.length) return def;
  const hit = compiledCache.get(def);
  if (hit) return hit;
  const flowIssues = checkFlow(def);
  const brokenLoops = new Set(flowIssues.filter((i) => i.location.startsWith('loops.')).map((i) => i.location.slice(6)));
  const pages: Page[] = [];
  let i = 0;
  while (i < def.pages.length) {
    const page = def.pages[i]!;
    const loop = loops.find((l) => l.pages[0] !== undefined && !brokenLoops.has(l.id) && l.pages.includes(page.id));
    if (!loop) {
      pages.push(page);
      i++;
      continue;
    }
    const span = def.pages.slice(i, i + loop.pages.length);
    const looped = new Set(span.flatMap((p) => p.questions.map((q) => q.id)));
    const source = loop.source ? def.pages.flatMap((p) => p.questions).find((q) => q.id === loop.source) : undefined;
    for (const item of loopItemsOf(def, loop)) {
      const suffix = loopSuffix(item.code);
      const rename = (n: string) => (n === loop.id ? String(item.code) : looped.has(n) ? `${n}${suffix}` : undefined);
      const gate = source ? (source.type === 'multi' ? `selected(${source.id}, ${item.code})` : `${source.id} == ${item.code}`) : undefined;
      for (const p of span) {
        const own = renameIn(p.condition, rename);
        const condition = gate && own ? `(${gate}) and (${own})` : (gate ?? own);
        const copy: Page = {
          ...p,
          id: `${p.id}${suffix}`,
          title: p.title ? pipeIn(p.title, loop.id, item.label, looped, suffix) : p.title,
          questions: p.questions.map((q) => copyQuestion(q, loop.id, item, looped)),
        };
        if (condition) copy.condition = condition;
        else delete copy.condition;
        pages.push(copy);
      }
    }
    i += span.length;
  }
  const compiled: SurveyDefinition = { ...def, pages, loops: [] };
  compiledCache.set(def, compiled);
  return compiled;
}

/**
 * Page indexes in the order this respondent sees them. Randomized blocks are shuffled with the seed
 * and cut to `pick` pages; pages left out of a block are never shown.
 */
export function pageOrder(def: SurveyDefinition, seed = ''): number[] {
  const blocks = def.blocks ?? [];
  const order = def.pages.map((_, i) => i);
  if (!blocks.length) return order;
  const out: number[] = [];
  let i = 0;
  while (i < def.pages.length) {
    const block = blocks.find((b) => b.pages.includes(def.pages[i]!.id));
    const idx = block ? block.pages.map((id) => def.pages.findIndex((p) => p.id === id)) : [];
    const valid = block && idx.every((x) => x >= 0) && Math.max(...idx) - Math.min(...idx) === idx.length - 1 && Math.min(...idx) === i;
    if (!block || !valid) {
      out.push(i++);
      continue;
    }
    let run = idx.sort((a, b) => a - b);
    if (block.randomize) run = seededOrder(run, `${seed}:block:${block.id}`);
    if (block.pick !== undefined) run = run.slice(0, block.pick);
    out.push(...run);
    i += idx.length;
  }
  return out;
}

/**
 * A dynamic answer list with the options this respondent gets, or the question unchanged. Options
 * whose code the source question does not have (such as "None of these") are always offered.
 */
export function withDynamicOptions<Q extends Question>(q: Q, def: SurveyDefinition, answers: Answers): Q {
  if ((q.type !== 'single' && q.type !== 'multi' && q.type !== 'ranking') || !q.optionsFrom) return q;
  const from = q.optionsFrom;
  const src = def.pages.flatMap((p) => p.questions).find((x) => x.id === from.question);
  const srcCodes = new Set(src && 'options' in src ? src.options.map((o) => o.code) : []);
  const v = answers[from.question];
  const chosen = new Set<number>(Array.isArray(v) ? v : typeof v === 'number' ? [v] : []);
  const keep = (o: Option) => !srcCodes.has(o.code) || (from.include === 'selected' ? chosen.has(o.code) : !chosen.has(o.code));
  return { ...q, options: q.options.filter(keep) };
}

/** True when a dynamic list leaves the respondent nothing to choose from (the question is skipped). */
export function hasNoOptions(q: Question): boolean {
  return (q.type === 'single' || q.type === 'multi' || q.type === 'ranking') && q.options.length === 0;
}

/**
 * The definition as interviews run it (loops compiled). Every place that runs interviews (server,
 * preview, QA lab, CAPI app, replay, exports, analysis) calls this. Idempotent.
 */
export function prepareSurvey(def: SurveyDefinition): SurveyDefinition {
  return compileSurvey(def);
}
