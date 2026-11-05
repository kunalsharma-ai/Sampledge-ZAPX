/**
 * Blueprint phase 5: rule-based data cleaning. Edit and impute rules from `def.cleaning` are
 * applied to copies of the answers when data is analysed or exported; stored answers never change.
 * Rules run in order, so a later rule sees the edits of earlier ones, and an impute rule's mean,
 * median or mode is computed from the records as they are at that point.
 */
import type { Answers, CleaningRule, Question, SurveyDefinition } from '@zapx/survey-schema';
import { conditionHolds } from './interview.js';

/** Question types whose answer is one value, so a rule can set or fill it. */
export const CLEANABLE_TYPES = ['single', 'numeric', 'scale', 'open'] as const;

export interface CleaningResult {
  answers: Answers[];
  /** Per record, the ids of the rules that changed it. */
  applied: string[][];
  /** Per rule, how many records it changed. */
  changed: Record<string, number>;
  /** Per impute rule, the value it filled in (null when nobody answered). */
  imputed: Record<string, number | string | null>;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function questionOf(def: SurveyDefinition, id: string): Question | undefined {
  return def.pages.flatMap((p) => p.questions).find((q) => q.id === id);
}

function statistic(
  values: Array<number | string>,
  method: NonNullable<CleaningRule['method']>,
  q: Question | undefined,
): number | string | null {
  if (!values.length) return null;
  if (method === 'mode') {
    const counts = new Map<string, { v: number | string; n: number }>();
    for (const v of values) {
      const k = `${typeof v}:${v}`;
      const c = counts.get(k) ?? { v, n: 0 };
      c.n++;
      counts.set(k, c);
    }
    // Ties go to the smallest value, so the result does not depend on record order.
    return [...counts.values()].sort((a, b) => b.n - a.n || (a.v < b.v ? -1 : a.v > b.v ? 1 : 0))[0]!.v;
  }
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  let x: number;
  if (method === 'mean') x = nums.reduce((s, v) => s + v, 0) / nums.length;
  else {
    const mid = nums.length >> 1;
    x = nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
  }
  // A scale or whole-number question gets a value it could have been answered with.
  const whole = q?.type === 'scale' || (q?.type === 'numeric' && q.integer);
  return whole ? Math.round(x) : Math.round(x * 100) / 100;
}

export function applyCleaning(def: SurveyDefinition, records: Answers[]): CleaningResult {
  const rules = def.cleaning ?? [];
  const answers = records.map((a) => ({ ...a }));
  const applied: string[][] = records.map(() => []);
  const changed: Record<string, number> = {};
  const imputed: Record<string, number | string | null> = {};
  for (const rule of rules) {
    changed[rule.id] = 0;
    const q = questionOf(def, rule.target);
    let fill: number | string | null = null;
    if (rule.action === 'impute') {
      const values = answers
        .map((a) => a[rule.target])
        .filter((v): v is number | string => !blank(v) && (typeof v === 'number' || typeof v === 'string'));
      fill = statistic(values, rule.method!, q);
      imputed[rule.id] = fill;
    }
    answers.forEach((a, i) => {
      if (rule.when && !safeHolds(rule.when, def, a)) return;
      const before = a[rule.target];
      if (rule.action === 'set') {
        if (before === rule.value) return;
        a[rule.target] = rule.value as Answers[string];
      } else if (rule.action === 'clear') {
        if (blank(before)) return;
        delete a[rule.target];
      } else {
        if (!blank(before) || fill === null) return;
        a[rule.target] = fill as Answers[string];
      }
      changed[rule.id]!++;
      applied[i]!.push(rule.id);
    });
  }
  return { answers, applied, changed, imputed };
}

function safeHolds(expr: string, def: SurveyDefinition, answers: Answers): boolean {
  try {
    return conditionHolds(expr, def, answers);
  } catch {
    return false;
  }
}

/** The cleaning rules that touch each question (shown as lineage next to the variable). */
export function cleaningByTarget(def: SurveyDefinition): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of def.cleaning ?? []) (out[r.target] ??= []).push(r.id);
  return out;
}
