/**
 * Rim weighting (raking, iterative proportional fitting), Milestone 15.
 *
 * Each dimension is a single-answer variable (a single choice or scale question, a grid row, or a
 * system variable such as mode) with a target share per category. Raking adjusts every interview's
 * weight so that the weighted shares match each dimension's targets in turn, and repeats until all
 * of them match within the tolerance, or the iteration limit is reached.
 *
 * - Interviews with no answer to a dimension keep their weight for that dimension; targets apply to
 *   the interviews that answered it.
 * - Weights are capped (trimmed) to [minWeight, maxWeight] times the mean after every pass, then
 *   rescaled to a mean of 1, so the weighted total equals the number of interviews.
 * - A category with a target above 0 but no interviews cannot be reached: it is reported and its
 *   target is shared out over the other categories of that dimension.
 */
import { codes, effectiveBase, type AnalysisRecord, type Variable } from './index';

export interface WeightTarget {
  code: number | string;
  /** Target share in percent (0-100). The targets of a dimension are rescaled to add up to 100. */
  pct: number;
}

export interface WeightDimension {
  variable: Variable;
  targets: WeightTarget[];
}

export interface RakeOptions {
  maxIterations?: number;
  /** Largest allowed gap between a weighted share and its target, in percentage points. */
  tolerance?: number;
  /** Weight caps, relative to the mean weight of 1. */
  minWeight?: number;
  maxWeight?: number;
}

export interface DimensionResult {
  variable: string;
  label: string;
  /** Interviews that answered this dimension. */
  answered: number;
  categories: Array<{
    code: number | string;
    label: string;
    target: number;
    /** Unweighted share among the interviews that answered, percent. */
    unweighted: number;
    /** Weighted share after raking, percent. */
    weighted: number;
    count: number;
  }>;
  /** Categories with a target but no interviews (the target could not be met). */
  empty: Array<number | string>;
}

export interface RakeResult {
  /** One weight per record, in the same order. */
  weights: number[];
  converged: boolean;
  iterations: number;
  /** Largest gap between a weighted share and its target, percentage points. */
  maxGap: number;
  /** Weighting efficiency, percent: effective base / interviews. */
  efficiency: number;
  effectiveBase: number;
  minWeight: number;
  maxWeight: number;
  /** Interviews whose weight hit a cap at the end. */
  capped: number;
  dimensions: DimensionResult[];
  warnings: string[];
}

const RAKEABLE = new Set(['single', 'scale']);

export function rake(records: AnalysisRecord[], dims: WeightDimension[], opts: RakeOptions = {}): RakeResult {
  const maxIterations = opts.maxIterations ?? 100;
  const tolerance = opts.tolerance ?? 0.01;
  const lo = opts.minWeight ?? 0.2;
  const hi = opts.maxWeight ?? 5;
  if (!(lo > 0 && lo <= 1 && hi >= 1)) throw new Error('Weight caps must satisfy 0 < minimum <= 1 <= maximum');
  if (!dims.length) throw new Error('Add at least one weighting variable');
  const seen = new Set<string>();
  for (const d of dims) {
    if (!RAKEABLE.has(d.variable.kind)) throw new Error(`${d.variable.id}: weight on single-answer variables only`);
    if (seen.has(d.variable.id)) throw new Error(`${d.variable.id} is used twice`);
    seen.add(d.variable.id);
    if (d.targets.some((t) => !(t.pct >= 0))) throw new Error(`${d.variable.id}: targets must be 0 or more`);
    if (!(d.targets.reduce((a, t) => a + t.pct, 0) > 0)) throw new Error(`${d.variable.id}: the targets add up to 0`);
  }

  const n = records.length;
  const warnings: string[] = [];
  // Per dimension: each record's category index (or -1 when unanswered or not a target category).
  const prepared = dims.map((d) => {
    const keys = d.targets.map((t) => String(t.code));
    const cat = records.map((r) => {
      const c = codes(d.variable, r)[0];
      return c === undefined ? -1 : keys.indexOf(String(c));
    });
    const counts = keys.map((_, k) => cat.filter((c) => c === k).length);
    const empty = d.targets.filter((t, k) => t.pct > 0 && counts[k] === 0).map((t) => t.code);
    const outside = records.filter((r, i) => cat[i] === -1 && codes(d.variable, r).length).length;
    if (outside) warnings.push(`${d.variable.id}: ${outside} interviews have an answer with no target; they keep their weight.`);
    if (empty.length) warnings.push(`${d.variable.id}: no interviews in ${empty.join(', ')}; that target cannot be met.`);
    // Reachable targets, rescaled to add up to 1.
    const reach = d.targets.map((t, k) => (counts[k] ? t.pct : 0));
    const sum = reach.reduce((a, b) => a + b, 0);
    const share = reach.map((t) => (sum ? t / sum : 0));
    const total = d.targets.reduce((a, t) => a + t.pct, 0);
    return { d, keys, cat, counts, empty, share, target: d.targets.map((t) => (t.pct / total) * 100) };
  });

  // Typed arrays and plain loops: this runs on up to 200,000 interviews, many passes.
  const w = new Float64Array(n).fill(1);
  const cats = prepared.map((p) => Int32Array.from(p.cat));
  const sumsOf = (k: number) => {
    const sums = new Float64Array(prepared[k]!.keys.length);
    const cat = cats[k]!;
    let answered = 0;
    for (let i = 0; i < n; i++) {
      const c = cat[i]!;
      if (c >= 0) {
        sums[c]! += w[i]!;
        answered += w[i]!;
      }
    }
    return { sums, answered };
  };
  const normalize = () => {
    let total = 0;
    for (let i = 0; i < n; i++) total += w[i]!;
    const mean = total / (n || 1);
    if (mean > 0) for (let i = 0; i < n; i++) w[i] = w[i]! / mean;
  };
  // Cap, rescale to a mean of 1, and repeat until the rescaled weights are inside the caps too.
  const trim = () => {
    for (let round = 0; round < 50; round++) {
      normalize();
      let inside = true;
      for (let i = 0; i < n && inside; i++) inside = w[i]! >= lo - 1e-9 && w[i]! <= hi + 1e-9;
      if (inside) return;
      for (let i = 0; i < n; i++) w[i] = Math.min(hi, Math.max(lo, w[i]!));
    }
  };
  const gapOf = () => {
    let gap = 0;
    prepared.forEach((p, k) => {
      const { sums, answered } = sumsOf(k);
      if (!answered) return;
      p.share.forEach((sh, c) => {
        if (p.counts[c]) gap = Math.max(gap, Math.abs((sums[c]! / answered) * 100 - sh * 100));
      });
    });
    return gap;
  };

  let iterations = 0;
  let gap = n ? gapOf() : 0;
  while (n && gap > tolerance && iterations < maxIterations) {
    iterations++;
    prepared.forEach((p, k) => {
      const { sums, answered } = sumsOf(k);
      const factor = Array.from(sums, (sum, c) => (sum > 0 ? (p.share[c]! * answered) / sum : 1));
      const cat = cats[k]!;
      for (let i = 0; i < n; i++) if (cat[i]! >= 0) w[i] = w[i]! * factor[cat[i]!]!;
    });
    trim();
    gap = gapOf();
  }
  const converged = gap <= tolerance;
  if (n && !converged)
    warnings.push(
      `Did not converge in ${iterations} passes (largest gap ${gap.toFixed(2)} points). The caps may be too tight or targets conflict.`,
    );

  const weights = Array.from(w);
  const eff = effectiveBase(weights);
  const capped = weights.filter((x) => x <= lo + 1e-9 || x >= hi - 1e-9).length;
  const dimensions: DimensionResult[] = prepared.map((p) => {
    const answeredIdx = p.cat.map((c, i) => (c >= 0 ? i : -1)).filter((i) => i >= 0);
    const wa = answeredIdx.reduce((a, i) => a + w[i]!, 0);
    const label = (code: number | string) => p.d.variable.categories.find((c) => String(c.code) === String(code))?.label ?? String(code);
    return {
      variable: p.d.variable.id,
      label: p.d.variable.label,
      answered: answeredIdx.length,
      categories: p.d.targets.map((t, k) => {
        const idx = answeredIdx.filter((i) => p.cat[i] === k);
        return {
          code: t.code,
          label: label(t.code),
          target: p.target[k]!,
          unweighted: answeredIdx.length ? (idx.length / answeredIdx.length) * 100 : 0,
          weighted: wa ? (idx.reduce((a, i) => a + w[i]!, 0) / wa) * 100 : 0,
          count: idx.length,
        };
      }),
      empty: p.empty,
    };
  });
  if (n && eff / n < 0.5)
    warnings.push(`Weighting efficiency is ${Math.round((eff / n) * 100)}%: the weighted results rest on few interviews.`);

  return {
    weights,
    converged,
    iterations,
    maxGap: gap,
    efficiency: n ? (eff / n) * 100 : 0,
    effectiveBase: eff,
    minWeight: n ? weights.reduce((a, b) => Math.min(a, b), Infinity) : 0,
    maxWeight: n ? weights.reduce((a, b) => Math.max(a, b), -Infinity) : 0,
    capped,
    dimensions,
    warnings,
  };
}
