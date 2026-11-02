import { describe, expect, it } from 'vitest';
import { crosstab, frequency, rake, type AnalysisRecord, type Variable } from './index';

const gender: Variable = {
  id: 'GENDER',
  label: 'Gender',
  kind: 'single',
  source: 'question',
  categories: [
    { code: 1, label: 'Male' },
    { code: 2, label: 'Female' },
  ],
};
const age: Variable = {
  id: 'AGE',
  label: 'Age group',
  kind: 'single',
  source: 'question',
  categories: [
    { code: 1, label: '18-34' },
    { code: 2, label: '35+' },
  ],
};
const brand: Variable = {
  id: 'BRAND',
  label: 'Brand',
  kind: 'single',
  source: 'question',
  categories: [
    { code: 1, label: 'A' },
    { code: 2, label: 'B' },
  ],
};
const spend: Variable = { id: 'SPEND', label: 'Spend', kind: 'numeric', source: 'question', categories: [] };

/** n records with the given answers. */
const many = (n: number, answers: Record<string, unknown>): AnalysisRecord[] =>
  Array.from({ length: n }, () => ({ answers: { ...answers }, system: {} }));

// 300 interviews: 75% men, mostly young; women prefer brand B.
const sample = [
  ...many(150, { GENDER: 1, AGE: 1, BRAND: 1, SPEND: 10 }),
  ...many(75, { GENDER: 1, AGE: 2, BRAND: 1, SPEND: 20 }),
  ...many(25, { GENDER: 2, AGE: 1, BRAND: 2, SPEND: 30 }),
  ...many(50, { GENDER: 2, AGE: 2, BRAND: 2, SPEND: 40 }),
];

describe('rake', () => {
  it('matches every target and keeps the total', () => {
    const r = rake(sample, [
      {
        variable: gender,
        targets: [
          { code: 1, pct: 50 },
          { code: 2, pct: 50 },
        ],
      },
      {
        variable: age,
        targets: [
          { code: 1, pct: 40 },
          { code: 2, pct: 60 },
        ],
      },
    ]);
    expect(r.converged).toBe(true);
    expect(r.maxGap).toBeLessThanOrEqual(0.01);
    expect(r.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 6);
    for (const d of r.dimensions) for (const c of d.categories) expect(c.weighted).toBeCloseTo(c.target, 1);
    expect(r.dimensions[0]!.categories[0]!.unweighted).toBeCloseTo(75, 6);
    expect(r.efficiency).toBeGreaterThan(50);
    expect(r.efficiency).toBeLessThan(100);
  });

  it('gives weight 1 to everyone when the sample already matches', () => {
    const r = rake(sample, [
      {
        variable: gender,
        targets: [
          { code: 1, pct: 75 },
          { code: 2, pct: 25 },
        ],
      },
    ]);
    expect(r.iterations).toBe(0);
    expect(new Set(r.weights)).toEqual(new Set([1]));
    expect(r.efficiency).toBeCloseTo(100, 6);
  });

  it('a single dimension is exact cell weighting', () => {
    const r = rake(sample, [
      {
        variable: gender,
        targets: [
          { code: 1, pct: 50 },
          { code: 2, pct: 50 },
        ],
      },
    ]);
    expect(r.weights[0]).toBeCloseTo(150 / 225, 6); // men: 50% of 300 over 225
    expect(r.weights[299]).toBeCloseTo(150 / 75, 6); // women: 50% of 300 over 75
  });

  it('rescales targets that do not add up to 100', () => {
    const r = rake(sample, [
      {
        variable: gender,
        targets: [
          { code: 1, pct: 1 },
          { code: 2, pct: 1 },
        ],
      },
    ]);
    expect(r.dimensions[0]!.categories.map((c) => c.target)).toEqual([50, 50]);
    expect(r.dimensions[0]!.categories[0]!.weighted).toBeCloseTo(50, 2);
  });

  it('caps weights and says when the targets cannot be met', () => {
    const r = rake(
      sample,
      [
        {
          variable: gender,
          targets: [
            { code: 1, pct: 5 },
            { code: 2, pct: 95 },
          ],
        },
      ],
      { maxWeight: 2 },
    );
    expect(r.maxWeight).toBeLessThanOrEqual(2 + 1e-9);
    expect(r.converged).toBe(false);
    expect(r.capped).toBeGreaterThan(0);
    expect(r.warnings.join(' ')).toMatch(/Did not converge/);
  });

  it('reports an empty target category and leaves unanswered interviews alone', () => {
    const recs = [...many(60, { GENDER: 1 }), ...many(40, { GENDER: 2 }), ...many(10, {})];
    const three: Variable = { ...gender, categories: [...gender.categories, { code: 3, label: 'Other' }] };
    const r = rake(recs, [
      {
        variable: three,
        targets: [
          { code: 1, pct: 45 },
          { code: 2, pct: 45 },
          { code: 3, pct: 10 },
        ],
      },
    ]);
    expect(r.dimensions[0]!.empty).toEqual([3]);
    expect(r.warnings.join(' ')).toMatch(/no interviews in 3/);
    expect(r.dimensions[0]!.categories[0]!.weighted).toBeCloseTo(50, 2);
    expect(r.dimensions[0]!.answered).toBe(100);
    // Unanswered interviews keep the same weight as each other.
    expect(new Set(r.weights.slice(100).map((w) => w.toFixed(9))).size).toBe(1);
  });

  it('refuses bad input', () => {
    expect(() => rake(sample, [])).toThrow(/at least one/);
    expect(() => rake(sample, [{ variable: spend, targets: [{ code: 1, pct: 1 }] }])).toThrow(/single-answer/);
    expect(() => rake(sample, [{ variable: gender, targets: [{ code: 1, pct: 0 }] }])).toThrow(/add up to 0/);
    expect(() => rake(sample, [{ variable: gender, targets: [{ code: 1, pct: 50 }] }], { minWeight: 2 })).toThrow(/caps/);
    expect(() =>
      rake(sample, [
        { variable: gender, targets: [{ code: 1, pct: 1 }] },
        { variable: gender, targets: [{ code: 1, pct: 1 }] },
      ]),
    ).toThrow(/twice/);
  });
});

describe('weighted results', () => {
  const r = rake(sample, [
    {
      variable: gender,
      targets: [
        { code: 1, pct: 50 },
        { code: 2, pct: 50 },
      ],
    },
  ]);
  const weighted = sample.map((rec, i) => ({ ...rec, weight: r.weights[i] }));

  it('frequencies use the weights and keep the unweighted base', () => {
    const f = frequency(brand, weighted);
    expect(f.unweightedBase).toBe(300);
    expect(f.base).toBeCloseTo(300, 6);
    expect(f.rows[0]!.pct).toBeCloseTo(50, 6); // brand A = men = 50% weighted
    expect(f.effectiveBase).toBeLessThan(300);
    const unweighted = frequency(brand, sample);
    expect(unweighted.rows[0]!.pct).toBeCloseTo(75, 6);
    expect(unweighted.effectiveBase).toBe(300);
  });

  it('means are weighted', () => {
    const f = frequency(spend, weighted);
    // Men 50% (mean spend 3000/225), women 50% (mean 2750/75).
    expect(f.stats!.mean).toBeCloseTo((3000 / 225 + 2750 / 75) / 2, 6);
    expect(f.stats!.n).toBe(300);
    expect(f.stats!.neff).toBeLessThan(300);
  });

  it('crosstab tests use the effective base', () => {
    const t = crosstab(gender, brand, weighted);
    expect(t.columns[0]!.unweightedBase).toBe(300);
    expect(t.columns[1]!.unweightedBase).toBe(225);
    expect(t.columns[0]!.effectiveBase).toBeLessThan(300);
    // Within a gender column all weights are equal, so the effective base equals the interviews.
    expect(t.columns[1]!.effectiveBase).toBeCloseTo(225, 6);
    expect(t.rows[0]!.cells[1]!.higherThan).toEqual(['B']);
  });
});
