/**
 * QA Laboratory: synthetic respondent testing.
 *
 * Runs many simulated interviews through the real interview engine (the same functions the server
 * uses), steering answers toward untested options and boundary values, and reports:
 *   - outcome mix (completes, terminations, quota full)
 *   - coverage of pages, questions, answer options, both sides of every condition,
 *     terminations and quotas
 *   - defects: unreachable content, conditions that never change, interviews that get stuck
 *     because no answer passes validation, and surveys nobody can complete.
 *
 * It is deterministic for a given seed, so a QA report can be reproduced exactly.
 */
import { scaleCodes, type Answers, type AnswerValue, type Option, type Question, type SurveyDefinition } from '@zapx/survey-schema';
import { analyzeSurvey, type AnalysisReport } from './analyze.js';
import { parseCached, references, type Node } from './expression.js';
import { conditionHolds, renderQuestion, validatePage, type RenderedQuestion } from './interview.js';
import { hasNoOptions, pageOrder, prepareSurvey } from './flow.js';

export interface SimulationOptions {
  respondents: number;
  seed?: string;
  /** Count completes against quota targets and end over-quota respondents (default true). */
  simulateQuotas?: boolean;
  /** How many answer attempts per page before reporting the interview as stuck. */
  maxAttemptsPerPage?: number;
  /** Called with every simulated interview (the report keeps only samples). */
  onInterview?: (interview: SimulatedInterview) => void;
}

export type SimOutcome = 'complete' | 'terminate' | 'quality_fail' | 'quota_full' | 'stuck' | 'error';

export interface SimulatedInterview {
  index: number;
  outcome: SimOutcome;
  reason?: string;
  pages: string[];
  answers: Answers;
}

export type CoverageKind = 'page' | 'question' | 'option' | 'condition_true' | 'condition_false' | 'termination' | 'quota' | 'outcome';

export interface CoverageItem {
  kind: CoverageKind;
  id: string;
  label: string;
  hits: number;
}

export interface QaDefect {
  severity: 'error' | 'warning';
  code:
    | 'NO_COMPLETES'
    | 'STUCK'
    | 'ENGINE_ERROR'
    | 'NEVER_SHOWN'
    | 'OPTION_NEVER_CHOSEN'
    | 'CONDITION_CONSTANT'
    | 'TERMINATION_NEVER_TRIGGERED'
    | 'QUOTA_NEVER_MATCHED';
  message: string;
  location: string;
  /** A respondent that demonstrates the problem, when there is one. */
  example?: { index: number; pages: string[]; answers: Answers; detail?: string };
}

export interface QaReport {
  seed: string;
  respondents: number;
  durationMs: number;
  outcomes: Record<SimOutcome, number>;
  uniquePaths: number;
  coverage: { total: number; covered: number; percent: number };
  items: CoverageItem[];
  defects: QaDefect[];
  staticAnalysis: AnalysisReport;
  /** Up to 25 example interviews, including every stuck or failed one. */
  samples: SimulatedInterview[];
  /** True when there are no error-level static or simulation defects. */
  passed: boolean;
}

// ---- deterministic randomness ---------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class Rng {
  private a: number;
  constructor(seed: string) {
    this.a = hash(seed);
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---- answer generation ----------------------------------------------------------------------

/** Numbers that appear next to a variable in any expression: the interesting boundaries. */
function numericHints(def: SurveyDefinition): Map<string, number[]> {
  const hints = new Map<string, number[]>();
  const add = (name: string, n: number) => {
    const list = hints.get(name) ?? [];
    for (const v of [n - 1, n, n + 1]) if (!list.includes(v)) list.push(v);
    hints.set(name, list);
  };
  const walk = (node: Node) => {
    if (node.kind === 'binary') {
      if (node.left.kind === 'var' && node.right.kind === 'num') add(node.left.name, node.right.value);
      if (node.right.kind === 'var' && node.left.kind === 'num') add(node.right.name, node.left.value);
      walk(node.left);
      walk(node.right);
    } else if (node.kind === 'unary') walk(node.arg);
    else if (node.kind === 'call' || node.kind === 'list') (node.kind === 'call' ? node.args : node.items).forEach(walk);
  };
  const exprs: string[] = [
    ...def.pages.flatMap((p) => [
      p.condition,
      ...p.questions.flatMap((q) => [q.condition, ...(q.type === 'info' ? [] : q.validations.map((v) => v.expr))]),
    ]),
    ...def.terminations.map((t) => t.condition),
    ...def.quotas.map((q) => q.condition),
  ].filter((e): e is string => !!e);
  for (const e of exprs) {
    try {
      walk(parseCached(e));
    } catch {
      /* reported by static analysis */
    }
  }
  return hints;
}

interface GenContext {
  rng: Rng;
  hints: Map<string, number[]>;
  optionHits: Map<string, number>;
  serial: number;
}

/** Prefer options that have been chosen least so far, so coverage grows quickly. */
function pickOption(q: Question, options: Option[], g: GenContext): Option {
  if (g.rng.chance(0.6)) {
    let best = options[0]!;
    let bestHits = Infinity;
    for (const o of options) {
      const h = g.optionHits.get(`${q.id}=${o.code}`) ?? 0;
      if (h < bestHits) {
        best = o;
        bestHits = h;
      }
    }
    return best;
  }
  return g.rng.pick(options);
}

function generateAnswer(q: Question, g: GenContext): AnswerValue | undefined {
  if (q.type === 'info') return undefined;
  if (!q.required && g.rng.chance(0.12)) return null;
  switch (q.type) {
    case 'single':
      return pickOption(q, q.options, g).code;
    case 'multi': {
      const first = pickOption(q, q.options, g);
      if (first.exclusive) return [first.code];
      const pool = q.options.filter((o) => !o.exclusive && o.code !== first.code);
      const min = Math.max(1, q.minSelected ?? 1);
      const max = Math.min(q.maxSelected ?? 3, pool.length + 1);
      const size = Math.max(min, g.rng.int(1, Math.max(1, max)));
      const chosen = new Set([first.code]);
      while (chosen.size < size && pool.length) chosen.add(g.rng.pick(pool).code);
      return [...chosen];
    }
    case 'numeric': {
      const lo = q.min ?? 0;
      const hi = q.max ?? Math.max(lo + 100, ...(g.hints.get(q.id) ?? []).map((n) => n + 10));
      const candidates = [lo, hi, ...(g.hints.get(q.id) ?? [])].filter((n) => n >= lo && n <= hi && (!q.integer || Number.isInteger(n)));
      if (candidates.length && g.rng.chance(0.4)) return g.rng.pick(candidates);
      const v = lo + g.rng.next() * (hi - lo);
      return q.integer ? Math.round(v) : Math.round(v * 100) / 100;
    }
    case 'open':
      return `Synthetic answer ${++g.serial}`.slice(0, q.maxLength);
    case 'photo':
      // A reference only: synthetic respondents never upload files.
      return `synthetic-photo-${++g.serial}`;
    case 'maxdiff': {
      const d = (q as RenderedQuestion).design;
      if (!d?.sets) return undefined;
      const out: Record<string, number> = { v: d.version };
      d.sets.forEach((set, i) => {
        const b = g.rng.pick(set);
        out[`b${i + 1}`] = b;
        out[`w${i + 1}`] = g.rng.pick(set.filter((c) => c !== b));
      });
      return out;
    }
    case 'conjoint': {
      const d = (q as RenderedQuestion).design;
      if (!d?.tasks) return undefined;
      const out: Record<string, number> = { v: d.version };
      d.tasks.forEach((_, i) => (out[`t${i + 1}`] = g.rng.int(q.noneOption ? 0 : 1, q.conceptsPerTask)));
      return out;
    }
    case 'signature':
      return `100,200 ${200 + (++g.serial % 700)},150 900,250`;
    case 'eyetrack': {
      // Synthetic respondents skip some tasks and otherwise look around the picture.
      if (g.rng.chance(0.2)) return 'declined';
      const pts: string[] = [];
      for (let t = 0; t <= q.durationSec * 1000; t += 100)
        pts.push(g.rng.chance(0.1) ? `${t},-` : `${t},${g.rng.int(0, 1000)},${g.rng.int(0, 1000)}`);
      return `recorded|${g.rng.int(30, 120)}|${q.durationSec * 1000}|${pts.join(' ')}`;
    }
    case 'barcode': {
      // Common code shapes (EAN-13, EAN-8, UPC-A, alphanumeric, a URL in a QR code); the first that fits the pattern.
      const n = String(++g.serial);
      const tries = [n.padStart(13, '4'), n.padStart(8, '4'), n.padStart(12, '0'), `SYN${n.padStart(10, '0')}`, `https://example.com/${n}`];
      if (!q.pattern) return tries[3];
      const re = new RegExp(q.pattern);
      return tries.find((t) => re.test(t));
    }
    case 'grid':
      return Object.fromEntries(q.rows.map((r) => [r.id, pickOption(q, q.columns, g).code]));
    case 'scale': {
      const codes = scaleCodes(q);
      const hinted = (g.hints.get(q.id) ?? []).filter((n) => codes.includes(n));
      return hinted.length && g.rng.chance(0.4) ? g.rng.pick(hinted) : g.rng.pick(codes);
    }
    case 'ranking': {
      // The least-covered option first, the rest shuffled.
      const first = pickOption(q, q.options, g);
      const rest = q.options.filter((o) => o.code !== first.code).map((o) => o.code);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = g.rng.int(0, i);
        [rest[i], rest[j]] = [rest[j]!, rest[i]!];
      }
      return [first.code, ...rest].slice(0, Math.min(q.rankCount ?? q.options.length, q.options.length));
    }
    case 'cardsort': {
      const sorted = q.options.filter(() => !q.allowUnsorted || g.rng.chance(0.85));
      return Object.fromEntries((sorted.length ? sorted : q.options).map((o) => [String(o.code), pickOption(q, q.groups, g).code]));
    }
    case 'hotspot': {
      const first = pickOption(
        q,
        q.regions.map((r) => ({ code: r.code, label: r.label })),
        g,
      ).code;
      const min = Math.max(1, q.minSelected ?? 1);
      const max = Math.min(q.maxSelected ?? 3, q.regions.length);
      const size = Math.max(min, g.rng.int(1, Math.max(1, max)));
      const chosen = new Set([first]);
      while (chosen.size < size) chosen.add(g.rng.pick(q.regions).code);
      return [...chosen];
    }
    case 'sum': {
      // Split the total at random cut points; whole numbers when required.
      const n = q.options.length;
      const cuts = Array.from({ length: n - 1 }, () => g.rng.next() * q.total).sort((a, b) => a - b);
      const parts = [...cuts, q.total].map((c, i) => c - (i ? cuts[i - 1]! : 0));
      let amounts = q.integer ? parts.map((p) => Math.floor(p)) : parts.map((p) => Math.round(p * 100) / 100);
      const diff = Math.round((q.total - amounts.reduce((a, b) => a + b, 0)) * 100) / 100;
      amounts = amounts.map((a, i) => (i === 0 ? Math.round((a + diff) * 100) / 100 : a));
      return Object.fromEntries(q.options.map((o, i) => [String(o.code), amounts[i]!]));
    }
  }
}

// ---- simulation -----------------------------------------------------------------------------

export function simulateSurvey(source: SurveyDefinition, opts: SimulationOptions): QaReport {
  const started = Date.now();
  const def = prepareSurvey(source);
  const seed = opts.seed ?? 'zapx';
  const n = Math.max(1, Math.min(10000, Math.floor(opts.respondents)));
  const simulateQuotas = opts.simulateQuotas ?? true;
  const maxAttempts = opts.maxAttemptsPerPage ?? 25;
  const staticAnalysis = analyzeSurvey(source);

  const items = new Map<string, CoverageItem>();
  const item = (kind: CoverageKind, id: string, label: string) => {
    const key = `${kind}:${id}`;
    if (!items.has(key)) items.set(key, { kind, id, label, hits: 0 });
    return items.get(key)!;
  };
  const hit = (kind: CoverageKind, id: string) => {
    const it = items.get(`${kind}:${id}`);
    if (it) it.hits++;
  };

  // Register everything that should be covered.
  item('outcome', 'complete', 'At least one complete');
  for (const p of def.pages) {
    item('page', p.id, `Page ${p.id} shown`);
    if (p.condition) {
      item('condition_true', `page:${p.id}`, `Page ${p.id} condition true`);
      item('condition_false', `page:${p.id}`, `Page ${p.id} condition false`);
    }
    for (const q of p.questions) {
      if (q.type !== 'info') item('question', q.id, `${q.id} asked`);
      if (q.condition) {
        item('condition_true', `q:${q.id}`, `${q.id} condition true`);
        item('condition_false', `q:${q.id}`, `${q.id} condition false`);
      }
      if (q.type === 'single' || q.type === 'multi')
        for (const o of q.options) item('option', `${q.id}=${o.code}`, `${q.id}: "${o.label}" chosen`);
      if (q.type === 'ranking') for (const o of q.options) item('option', `${q.id}=${o.code}`, `${q.id}: "${o.label}" ranked first`);
      if (q.type === 'grid') for (const o of q.columns) item('option', `${q.id}=${o.code}`, `${q.id}: "${o.label}" chosen in a row`);
      if (q.type === 'hotspot') for (const r of q.regions) item('option', `${q.id}=${r.code}`, `${q.id}: area "${r.label}" chosen`);
      if (q.type === 'cardsort') for (const o of q.groups) item('option', `${q.id}=${o.code}`, `${q.id}: a card sorted into "${o.label}"`);
    }
  }
  for (const t of def.terminations) item('termination', t.id, `Termination ${t.id} triggered`);
  for (const q of def.quotas) item('quota', q.id, `Quota ${q.id} matched by a complete`);

  const condCounts = new Map<string, { t: number; f: number }>();
  const recordCond = (key: string, value: boolean) => {
    const c = condCounts.get(key) ?? { t: 0, f: 0 };
    if (value) c.t++;
    else c.f++;
    condCounts.set(key, c);
    hit(value ? 'condition_true' : 'condition_false', key);
  };

  const outcomes: Record<SimOutcome, number> = { complete: 0, terminate: 0, quality_fail: 0, quota_full: 0, stuck: 0, error: 0 };
  const quotaCounts = new Map<string, number>();
  const paths = new Set<string>();
  const samples: SimulatedInterview[] = [];
  const defects: QaDefect[] = [];
  const stuckSeen = new Set<string>();
  const g: GenContext = { rng: new Rng(seed), hints: numericHints(def), optionHits: new Map(), serial: 0 };

  for (let i = 0; i < n; i++) {
    const answers: Answers = {};
    const visited: string[] = [];
    let outcome: SimOutcome = 'complete';
    let reason: string | undefined;
    try {
      // This respondent's page order (randomized blocks), seeded like a live interview.
      const order = pageOrder(def, `${seed}:${i}`);
      let position = -1;
      for (;;) {
        // Find the next page, recording each page condition evaluated on the way.
        let next = -1;
        for (let k = position + 1; k < order.length; k++) {
          const p = def.pages[order[k]!]!;
          if (p.condition) {
            const ok = conditionHolds(p.condition, def, answers);
            recordCond(`page:${p.id}`, ok);
            if (!ok) continue;
          }
          next = k;
          break;
        }
        if (next === -1) break;
        position = next;
        const page = def.pages[order[position]!]!;

        // Answer the page, retrying with new random answers if validation rejects them.
        let accepted: Answers | null = null;
        let lastErrors = '';
        for (let attempt = 0; attempt < maxAttempts && !accepted; attempt++) {
          const submitted: Record<string, unknown> = {};
          const shownNow: Answers = { ...answers };
          for (const q of page.questions) {
            if (!conditionHolds(q.condition, def, shownNow)) continue;
            const rendered = renderQuestion(q, def, shownNow, `${seed}:${i}`);
            if (hasNoOptions(rendered)) continue;
            const v = generateAnswer(rendered as Question, g);
            if (v !== undefined) {
              submitted[q.id] = v;
              shownNow[q.id] = v;
            }
          }
          const r = validatePage(def, page, answers, submitted);
          if (r.ok) accepted = r.answers;
          else lastErrors = r.errors.map((e) => `${e.questionId}: ${e.message}`).join('; ');
        }
        if (!accepted) {
          outcome = 'stuck';
          reason = `Page ${page.id}: ${lastErrors}`;
          if (!stuckSeen.has(page.id)) {
            stuckSeen.add(page.id);
            defects.push({
              severity: 'error',
              code: 'STUCK',
              message: `Simulated respondents could not get past page ${page.id}: no answers passed validation after ${maxAttempts} attempts (${lastErrors}). Check for contradictory validations or ranges.`,
              location: `pages.${page.id}`,
              example: { index: i, pages: [...visited, page.id], answers: { ...answers }, detail: lastErrors },
            });
          }
          visited.push(page.id);
          break;
        }

        // Record coverage for what was shown and chosen on this page.
        visited.push(page.id);
        hit('page', page.id);
        const before = { ...answers };
        Object.assign(answers, accepted);
        const progressive: Answers = { ...before };
        for (const q of page.questions) {
          if (q.condition) recordCond(`q:${q.id}`, conditionHolds(q.condition, def, progressive));
          const v = accepted[q.id];
          if (v !== undefined && v !== null && q.type !== 'info') {
            hit('question', q.id);
            const codes = Array.isArray(v)
              ? q.type === 'ranking'
                ? v.slice(0, 1)
                : v
              : typeof v === 'number' && q.type === 'single'
                ? [v]
                : (q.type === 'grid' || q.type === 'cardsort') && typeof v === 'object'
                  ? Object.values(v as Record<string, number>)
                  : [];
            for (const c of codes) {
              const key = `${q.id}=${c}`;
              hit('option', key);
              g.optionHits.set(key, (g.optionHits.get(key) ?? 0) + 1);
            }
          }
          if (v !== undefined) progressive[q.id] = v;
        }

        const term = def.terminations.find((t) => conditionHolds(t.condition, def, answers));
        if (term) {
          hit('termination', term.id);
          outcome = term.status;
          reason = term.id;
          break;
        }
        if (simulateQuotas) {
          const full = def.quotas.find((q) => conditionHolds(q.condition, def, answers) && (quotaCounts.get(q.id) ?? 0) >= q.target);
          if (full) {
            outcome = 'quota_full';
            reason = full.id;
            break;
          }
        }
      }
      if (outcome === 'complete') {
        const matched = def.quotas.filter((q) => conditionHolds(q.condition, def, answers));
        const over = simulateQuotas ? matched.find((q) => (quotaCounts.get(q.id) ?? 0) >= q.target) : undefined;
        if (over) {
          outcome = 'quota_full';
          reason = over.id;
        } else {
          hit('outcome', 'complete');
          for (const q of matched) {
            hit('quota', q.id);
            quotaCounts.set(q.id, (quotaCounts.get(q.id) ?? 0) + 1);
          }
        }
      }
    } catch (e) {
      outcome = 'error';
      reason = e instanceof Error ? e.message : String(e);
      if (!defects.some((d) => d.code === 'ENGINE_ERROR'))
        defects.push({
          severity: 'error',
          code: 'ENGINE_ERROR',
          message: `The interview engine failed: ${reason}`,
          location: 'survey',
          example: { index: i, pages: visited, answers },
        });
    }
    outcomes[outcome]++;
    paths.add(visited.join('>'));
    const interview: SimulatedInterview = { index: i, outcome, reason, pages: visited, answers };
    opts.onInterview?.(interview);
    if (samples.length < 25 || outcome === 'stuck' || outcome === 'error') {
      if (samples.length < 60) samples.push(interview);
    }
  }

  // ---- defects from coverage ----------------------------------------------------------------
  const all = [...items.values()];
  if (outcomes.complete === 0 && outcomes.quota_full === 0)
    defects.push({
      severity: 'error',
      code: 'NO_COMPLETES',
      message: `None of ${n} simulated respondents could complete the survey.`,
      location: 'survey',
    });
  for (const it of all) {
    if (it.hits > 0) continue;
    if (it.kind === 'page' || it.kind === 'question')
      defects.push({
        severity: 'warning',
        code: 'NEVER_SHOWN',
        message: `${it.kind === 'page' ? `Page ${it.id}` : it.id} was never shown to ${n} simulated respondents. Check the conditions that lead to it.`,
        location: it.kind === 'page' ? `pages.${it.id}` : `questions.${it.id}`,
      });
    else if (it.kind === 'termination')
      defects.push({
        severity: 'warning',
        code: 'TERMINATION_NEVER_TRIGGERED',
        message: `Termination ${it.id} never triggered in ${n} simulated interviews.`,
        location: `terminations.${it.id}`,
      });
    else if (it.kind === 'quota')
      defects.push({
        severity: 'warning',
        code: 'QUOTA_NEVER_MATCHED',
        message: `No simulated complete matched quota ${it.id}.`,
        location: `quotas.${it.id}`,
      });
  }
  for (const [key, c] of condCounts) {
    if (c.t + c.f >= 20 && (c.t === 0 || c.f === 0)) {
      const [kind, id] = key.split(':') as [string, string];
      defects.push({
        severity: 'warning',
        code: 'CONDITION_CONSTANT',
        message: `The condition on ${kind === 'page' ? `page ${id}` : id} was ${c.t === 0 ? 'false' : 'true'} in all ${c.t + c.f} checks.`,
        location: kind === 'page' ? `pages.${id}.condition` : `questions.${id}.condition`,
      });
    }
  }

  const covered = all.filter((i) => i.hits > 0).length;
  const order: Record<QaDefect['severity'], number> = { error: 0, warning: 1 };
  defects.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    seed,
    respondents: n,
    durationMs: Date.now() - started,
    outcomes,
    uniquePaths: paths.size,
    coverage: { total: all.length, covered, percent: all.length ? Math.round((covered / all.length) * 1000) / 10 : 100 },
    items: all,
    defects,
    staticAnalysis,
    samples,
    passed: staticAnalysis.ok && !defects.some((d) => d.severity === 'error'),
  };
}

/** Variables an expression reads; exported for tooling that explains coverage gaps. */
export function variablesIn(expr: string): string[] {
  try {
    return [...new Set(references(parseCached(expr)).map((r) => r.name))];
  } catch {
    return [];
  }
}
