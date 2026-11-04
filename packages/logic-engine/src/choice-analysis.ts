/**
 * Analysis of MaxDiff and choice-based conjoint answers (blueprint phase 4).
 *
 * - MaxDiff: counting scores, (times best − times worst) / times shown, from -1 to 1. Simple, robust
 *   and transparent; hierarchical Bayes utilities are not estimated.
 * - Conjoint: aggregate multinomial logit with effects coding, fitted by Newton-Raphson. Part-worths
 *   are centred within each attribute; importance is the attribute's share of the summed part-worth
 *   ranges. Also the counting share of each level (chosen / shown). One model for the whole sample:
 *   no individual-level (HB) utilities.
 */
import type { Answers, ConjointQuestion, MaxDiffQuestion } from '@zapx/survey-schema';
import { conjointDesign, maxDiffDesign } from './choice-design.js';

export interface MaxDiffItemScore {
  code: number;
  label: string;
  shown: number;
  best: number;
  worst: number;
  /** (best − worst) / shown, between -1 and 1. */
  score: number;
}

export interface MaxDiffResult {
  respondents: number;
  items: MaxDiffItemScore[];
}

const record = (a: unknown) => (a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, number>) : null);

export function maxDiffScores(q: MaxDiffQuestion, answers: Answers[], weights?: number[]): MaxDiffResult {
  const design = maxDiffDesign(q);
  const stats = new Map(q.options.map((o) => [o.code, { shown: 0, best: 0, worst: 0 }]));
  let respondents = 0;
  answers.forEach((ans, k) => {
    const a = record(ans[q.id]);
    const sets = a ? design[a.v as number] : undefined;
    if (!a || !sets) return;
    const w = weights?.[k] ?? 1;
    respondents++;
    sets.forEach((set, i) => {
      const b = a[`b${i + 1}`];
      const wo = a[`w${i + 1}`];
      if (b === undefined || wo === undefined) return;
      for (const c of set) stats.get(c)!.shown += w;
      stats.get(b)!.best += w;
      stats.get(wo)!.worst += w;
    });
  });
  const items = q.options
    .map((o) => {
      const s = stats.get(o.code)!;
      const r = (x: number) => Math.round(x * 1000) / 1000;
      return {
        code: o.code,
        label: o.label,
        shown: r(s.shown),
        best: r(s.best),
        worst: r(s.worst),
        score: s.shown ? r((s.best - s.worst) / s.shown) : 0,
      };
    })
    .sort((a, b) => b.score - a.score);
  return { respondents, items };
}

export interface ConjointLevelResult {
  code: number;
  label: string;
  partWorth: number;
  shown: number;
  chosen: number;
  /** chosen / shown. */
  share: number;
}
export interface ConjointResult {
  respondents: number;
  choices: number;
  /** Share of tasks where "none" was chosen. */
  noneShare: number | null;
  attributes: Array<{ id: string; label: string; importance: number; levels: ConjointLevelResult[] }>;
  /** Utility of "none" on the same scale as the part-worths, when offered. */
  noneUtility: number | null;
  /** McFadden pseudo R² of the model against equal choice. */
  pseudoR2: number;
  converged: boolean;
}

interface Task {
  /** Effects-coded rows, one per alternative (concepts, then "none" if offered). */
  x: number[][];
  chosen: number;
  w: number;
}

/** Solve A·x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

export function conjointAnalysis(q: ConjointQuestion, answers: Answers[], weights?: number[]): ConjointResult {
  const design = conjointDesign(q);
  // Effects coding: attribute a with L levels has L-1 columns; the last level is -1 on all of them.
  const offsets: number[] = [];
  let p = 0;
  for (const a of q.attributes) {
    offsets.push(p);
    p += a.levels.length - 1;
  }
  const noneCol = q.noneOption ? p++ : -1;
  const encode = (concept: number[]) => {
    const row = new Array<number>(p).fill(0);
    q.attributes.forEach((a, ai) => {
      const li = a.levels.findIndex((l) => l.code === concept[ai]);
      if (li < a.levels.length - 1) row[offsets[ai]! + li] = 1;
      else for (let k = 0; k < a.levels.length - 1; k++) row[offsets[ai]! + k] = -1;
    });
    return row;
  };
  const counts = q.attributes.map((a) => new Map(a.levels.map((l) => [l.code, { shown: 0, chosen: 0 }])));
  const tasks: Task[] = [];
  let respondents = 0;
  let none = 0;
  answers.forEach((ans, k) => {
    const a = record(ans[q.id]);
    const version = a ? design[a.v as number] : undefined;
    if (!a || !version) return;
    respondents++;
    const w = weights?.[k] ?? 1;
    version.forEach((concepts, ti) => {
      const pick = a[`t${ti + 1}`];
      if (pick === undefined) return;
      const x = concepts.map(encode);
      if (q.noneOption) {
        const row = new Array<number>(p).fill(0);
        row[noneCol] = 1;
        x.push(row);
      }
      const chosen = pick === 0 ? concepts.length : pick - 1;
      if (pick === 0) none += w;
      concepts.forEach((c, ci) =>
        c.forEach((code, ai) => {
          const s = counts[ai]!.get(code)!;
          s.shown += w;
          if (ci === chosen) s.chosen += w;
        }),
      );
      tasks.push({ x, chosen, w });
    });
  });

  // Newton-Raphson on the multinomial logit log-likelihood (small ridge for stability).
  let beta = new Array<number>(p).fill(0);
  const loglik = (b: number[]) =>
    tasks.reduce((ll, t) => {
      const u = t.x.map((r) => r.reduce((s, v, i) => s + v * b[i]!, 0));
      const m = Math.max(...u);
      const z = u.reduce((s, v) => s + Math.exp(v - m), 0);
      return ll + t.w * (u[t.chosen]! - m - Math.log(z));
    }, 0);
  const ll0 = loglik(beta);
  let converged = tasks.length === 0;
  for (let iter = 0; iter < 50 && tasks.length; iter++) {
    const g = new Array<number>(p).fill(0);
    const H = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (const t of tasks) {
      const u = t.x.map((r) => r.reduce((s, v, i) => s + v * beta[i]!, 0));
      const m = Math.max(...u);
      const e = u.map((v) => Math.exp(v - m));
      const z = e.reduce((s, v) => s + v, 0);
      const pr = e.map((v) => v / z);
      const mean = new Array<number>(p).fill(0);
      t.x.forEach((r, j) => r.forEach((v, i) => (mean[i]! += pr[j]! * v)));
      t.x[t.chosen]!.forEach((v, i) => (g[i]! += t.w * (v - mean[i]!)));
      t.x.forEach((r, j) => {
        for (let a = 0; a < p; a++) {
          const da = r[a]! - mean[a]!;
          if (!da) continue;
          for (let b = 0; b < p; b++) H[a]![b]! += t.w * pr[j]! * da * (r[b]! - mean[b]!);
        }
      });
    }
    for (let i = 0; i < p; i++) H[i]![i]! += 1e-6;
    const step = solve(H, g);
    if (!step) break;
    // Halve the step until the likelihood does not fall (keeps Newton safe on separable data).
    const before = loglik(beta);
    let scale = 1;
    let next = beta.map((b, i) => b + step[i]!);
    while (loglik(next) < before - 1e-9 && scale > 1e-4) {
      scale /= 2;
      next = beta.map((b, i) => b + scale * step[i]!);
    }
    const moved = Math.max(...step.map((s) => Math.abs(s * scale)));
    beta = next.map((b) => Math.max(-20, Math.min(20, b)));
    if (moved < 1e-6) {
      converged = true;
      break;
    }
  }
  const ll = loglik(beta);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const attrs = q.attributes.map((a, ai) => {
    const raw = a.levels.map((_, li) =>
      li < a.levels.length - 1 ? beta[offsets[ai]! + li]! : -a.levels.slice(0, -1).reduce((s, __, k) => s + beta[offsets[ai]! + k]!, 0),
    );
    return { a, raw, range: Math.max(...raw) - Math.min(...raw) };
  });
  const total = attrs.reduce((s, x) => s + x.range, 0) || 1;
  return {
    respondents,
    choices: tasks.length,
    noneShare: q.noneOption && tasks.length ? r3(none / tasks.reduce((s, t) => s + t.w, 0)) : null,
    noneUtility: q.noneOption ? r3(beta[noneCol]!) : null,
    pseudoR2: ll0 ? r3(1 - ll / ll0) : 0,
    converged,
    attributes: attrs.map(({ a, raw, range }, ai) => ({
      id: a.id,
      label: a.label,
      importance: r3((range / total) * 100),
      levels: a.levels.map((l, li) => {
        const c = counts[ai]!.get(l.code)!;
        return {
          code: l.code,
          label: l.label,
          partWorth: r3(raw[li]!),
          shown: r3(c.shown),
          chosen: r3(c.chosen),
          share: c.shown ? r3(c.chosen / c.shown) : 0,
        };
      }),
    })),
  };
}
