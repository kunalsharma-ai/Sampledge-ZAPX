/**
 * Programmer tools (blueprint phase 1): the expression debugger, the variable inspector and the
 * dependency explorer. Pure functions over the canonical definition, used by the Programmer
 * workspace in the studio.
 */
import type { Answers, QaTestCase, SurveyDefinition } from '@zapx/survey-schema';
import { ExpressionError, evaluate, parse, references, truthy, type Value } from './expression.js';
import {
  PIPE_PATTERN,
  computeVariables,
  visibleQuestions,
  conditionHolds,
  contextFor,
  firstMatchingTermination,
  matchingQuotas,
  nextPageIndex,
  pageIsVisible,
} from './interview.js';
import { prepareSurvey } from './flow.js';

export interface ExpressionTrace {
  ok: boolean;
  /** The value of the expression for these answers. */
  value?: Value;
  truthy?: boolean;
  error?: { message: string; position: number };
  /** Every variable the expression reads, with its current value (the variable inspector). */
  inputs: Array<{ name: string; member?: string; value: Value | undefined; known: boolean }>;
}

/** Evaluate an expression against test answers and show what it read. Never throws. */
export function traceExpression(source: SurveyDefinition, expr: string, answers: Answers): ExpressionTrace {
  const def = prepareSurvey(source);
  let ast;
  try {
    ast = parse(expr);
  } catch (e) {
    if (e instanceof ExpressionError) return { ok: false, error: { message: e.message, position: e.position }, inputs: [] };
    throw e;
  }
  const ctx = contextFor(def, answers);
  const seen = new Set<string>();
  const inputs: ExpressionTrace['inputs'] = [];
  for (const r of references(ast)) {
    const key = r.member ? `${r.name}.${r.member}` : r.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = ctx.lookup(r.name, r.member);
    inputs.push({ ...r, value, known: value !== undefined });
  }
  const value = evaluate(ast, ctx);
  return { ok: true, value, truthy: truthy(value), inputs };
}

export interface RouteStep {
  pageId: string;
  shown: boolean;
  /** Why a page was skipped: its condition, or every question on it hidden. */
  reason?: string;
}

/** Walk the survey with a set of answers and explain which pages are shown, and how it ends. */
export function traceRoute(source: SurveyDefinition, answers: Answers, seed = ''): { steps: RouteStep[]; ending: string } {
  const def = prepareSurvey(source);
  const steps: RouteStep[] = [];
  const shown = new Set<number>();
  for (let i = nextPageIndex(def, answers, -1, seed); i !== -1; i = nextPageIndex(def, answers, i, seed)) shown.add(i);
  def.pages.forEach((p, i) => {
    if (shown.has(i)) steps.push({ pageId: p.id, shown: true });
    else if (p.condition && !conditionHolds(p.condition, def, answers))
      steps.push({ pageId: p.id, shown: false, reason: `condition ${p.condition} is false` });
    else if (!pageIsVisible(p, def, answers)) steps.push({ pageId: p.id, shown: false, reason: 'no question on it is shown' });
    else steps.push({ pageId: p.id, shown: false, reason: 'left out of a randomized block for this respondent' });
  });
  const t = firstMatchingTermination(def, answers);
  const q = matchingQuotas(def, answers).map((x) => x.id);
  const ending = t ? `${t.status} by ${t.id}` : `complete${q.length ? `, counting toward ${q.join(', ')}` : ''}`;
  return { steps, ending };
}

export interface DependencyNode {
  id: string;
  kind: 'question' | 'variable' | 'loop';
  pageId?: string;
  /** Variables this one's logic reads (conditions, validations, dynamic list source, piping). */
  uses: string[];
  /** Places whose logic reads this variable. */
  usedBy: Array<{ location: string; what: string }>;
}

function refsOf(expr: string | undefined): string[] {
  if (!expr) return [];
  try {
    return [...new Set(references(parse(expr)).map((r) => r.name))];
  } catch {
    return [];
  }
}
const pipes = (text: string | undefined) => (text ? [...text.matchAll(PIPE_PATTERN)].map((m) => m[1]!) : []);

/**
 * Who depends on whom: for every question and calculated variable, what its logic reads and which
 * conditions, validations, quotas, terminations, variables, loops and piping read it. Built on the
 * definition as written (loop templates, not the expanded copies).
 */
export function dependencyGraph(def: SurveyDefinition): DependencyNode[] {
  const nodes = new Map<string, DependencyNode>();
  for (const p of def.pages)
    for (const q of p.questions) nodes.set(q.id, { id: q.id, kind: 'question', pageId: p.id, uses: [], usedBy: [] });
  for (const v of def.variables ?? []) nodes.set(v.id, { id: v.id, kind: 'variable', uses: [], usedBy: [] });
  for (const l of def.loops ?? []) nodes.set(l.id, { id: l.id, kind: 'loop', uses: l.source ? [l.source] : [], usedBy: [] });
  const link = (names: string[], location: string, what: string, owner?: DependencyNode) => {
    for (const n of names) {
      const target = nodes.get(n);
      if (!target) continue;
      if (!target.usedBy.some((u) => u.location === location && u.what === what)) target.usedBy.push({ location, what });
      if (owner && owner.id !== n && !owner.uses.includes(n)) owner.uses.push(n);
    }
  };
  for (const p of def.pages) {
    link(refsOf(p.condition), `page ${p.id}`, 'page condition');
    link(pipes(p.title), `page ${p.id}`, 'piped into the page title');
    for (const q of p.questions) {
      const me = nodes.get(q.id)!;
      link(refsOf(q.condition), q.id, 'display condition', me);
      link(pipes(q.text), q.id, 'piped into the text', me);
      if (q.type !== 'info') {
        link(pipes(q.help), q.id, 'piped into the help text', me);
        q.validations.forEach((v) => link(refsOf(v.expr), q.id, 'validation', me));
      }
      if ((q.type === 'single' || q.type === 'multi' || q.type === 'ranking') && q.optionsFrom)
        link([q.optionsFrom.question], q.id, 'dynamic answer list', me);
    }
  }
  for (const v of def.variables ?? []) link(refsOf(v.expr), `variable ${v.id}`, 'formula', nodes.get(v.id));
  for (const l of def.loops ?? []) if (l.source) link([l.source], `loop ${l.id}`, 'loop items');
  for (const t of def.terminations) link(refsOf(t.condition), `termination ${t.id}`, 'termination');
  for (const q of def.quotas) link(refsOf(q.condition), `quota ${q.id}`, 'quota');
  for (const c of def.settings.quality.checks) link(refsOf(c.condition), `quality check ${c.id}`, 'quality check');
  return [...nodes.values()];
}

export interface TestCaseCheck {
  label: string;
  passed: boolean;
  /** What actually happened, when it differs. */
  actual?: string;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  checks: TestCaseCheck[];
  /** The route the answers took, for the report. */
  pages: string[];
  ending: string;
}

/** Outcome of a set of answers: `complete`, or the matching termination as `status:ID`. */
function outcomeOf(def: SurveyDefinition, answers: Answers): { status: string; id?: string } {
  const t = firstMatchingTermination(def, answers);
  return t ? { status: t.status, id: t.id } : { status: 'complete' };
}

const show = (v: unknown) => (v === undefined ? 'nothing' : JSON.stringify(v));

/**
 * Run one saved test case against a definition (regression testing). Every expectation becomes a
 * check; a case passes when all its checks pass. A missing page or question is a failed check, so a
 * renamed id is caught rather than silently passing.
 */
export function runTestCase(source: SurveyDefinition, tc: QaTestCase): TestCaseResult {
  const def = prepareSurvey(source);
  const answers = tc.answers as Answers;
  const { steps, ending } = traceRoute(source, answers, tc.seed);
  const shownPages = new Set(steps.filter((s) => s.shown).map((s) => s.pageId));
  const pageOf = new Map<string, number>();
  def.pages.forEach((p, i) => p.questions.forEach((q) => pageOf.set(q.id, i)));
  const checks: TestCaseCheck[] = [];

  const isShown = (id: string): boolean | undefined => {
    const pi = def.pages.findIndex((p) => p.id === id);
    if (pi >= 0) return shownPages.has(id);
    const qpi = pageOf.get(id);
    if (qpi === undefined) return undefined;
    const page = def.pages[qpi]!;
    return shownPages.has(page.id) && visibleQuestions(page, def, answers).some((q) => q.id === id);
  };
  for (const id of tc.expect.shows) {
    const s = isShown(id);
    checks.push({
      label: `${id} is shown`,
      passed: s === true,
      actual: s === undefined ? `${id} is not in the survey` : s ? undefined : 'skipped',
    });
  }
  for (const id of tc.expect.skips) {
    const s = isShown(id);
    checks.push({
      label: `${id} is skipped`,
      passed: s === false,
      actual: s === undefined ? `${id} is not in the survey` : s ? 'shown' : undefined,
    });
  }
  if (tc.expect.outcome) {
    const o = outcomeOf(def, answers);
    const want = tc.expect.outcome;
    const ok = want.includes(':') ? `${o.status}:${o.id}` === want : o.status === want;
    checks.push({ label: `ends as ${want}`, passed: ok, actual: ok ? undefined : o.id ? `${o.status}:${o.id}` : o.status });
  }
  if (Object.keys(tc.expect.variables).length) {
    const values = computeVariables(def, answers);
    for (const [k, want] of Object.entries(tc.expect.variables)) {
      const got = Object.hasOwn(values, k) ? values[k] : undefined;
      const ok = got === want || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9);
      checks.push({ label: `${k} = ${show(want)}`, passed: ok, actual: ok ? undefined : show(got) });
    }
  }
  if (tc.expect.quotas) {
    const got = matchingQuotas(def, answers)
      .map((q) => q.id)
      .sort();
    const want = [...tc.expect.quotas].sort();
    const ok = got.join(',') === want.join(',');
    checks.push({
      label: `counts toward ${want.length ? want.join(', ') : 'no quota'}`,
      passed: ok,
      actual: ok ? undefined : got.join(', ') || 'no quota',
    });
  }
  return {
    name: tc.name,
    passed: checks.every((c) => c.passed),
    checks,
    pages: steps.filter((s) => s.shown).map((s) => s.pageId),
    ending,
  };
}

/** Run a whole suite; the summary counts passed and failed cases. */
export function runTestSuite(def: SurveyDefinition, cases: QaTestCase[]) {
  const results = cases.map((c) => runTestCase(def, c));
  return { passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results };
}
