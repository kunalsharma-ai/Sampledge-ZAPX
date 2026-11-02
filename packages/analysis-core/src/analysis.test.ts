import { describe, expect, it } from 'vitest';
import type { SurveyDefinition } from '@zapx/survey-schema';
import { crosstab, frequency, meanZ, numericStats, proportionZ, variables, type AnalysisRecord } from './index';

const def = {
  id: 'S',
  title: 'T',
  language: 'en',
  pages: [
    {
      id: 'P1',
      questions: [
        {
          id: 'GENDER',
          type: 'single',
          text: 'Gender?',
          options: [
            { code: 1, label: 'Male' },
            { code: 2, label: 'Female' },
          ],
        },
        {
          id: 'BRANDS',
          type: 'multi',
          text: 'Brands {{GENDER}}?',
          options: [
            { code: 1, label: 'A' },
            { code: 2, label: 'B' },
          ],
        },
        { id: 'AGE', type: 'numeric', text: 'Age?' },
        { id: 'WHY', type: 'open', text: 'Why?' },
        {
          id: 'SAT',
          type: 'grid',
          text: 'Rate',
          rows: [{ id: 'r1', label: 'Price' }],
          columns: [
            { code: 1, label: 'Bad' },
            { code: 5, label: 'Good' },
          ],
        },
        { id: 'NOTE', type: 'info', text: 'Thanks' },
      ],
    },
  ],
  quotas: [],
} as unknown as SurveyDefinition;

const rec = (answers: Record<string, unknown>, vendor = 'V1'): AnalysisRecord => ({
  answers,
  system: { status: 'complete', vendor, mode: 'cawi' },
});

describe('variables', () => {
  it('lists questions, grid rows and system variables, without info elements', () => {
    const vs = variables(def, [rec({}, 'V2'), rec({}, 'V1')]);
    expect(vs.map((v) => `${v.id}:${v.kind}`)).toEqual([
      'GENDER:single',
      'BRANDS:multi',
      'AGE:numeric',
      'WHY:open',
      'SAT_r1:single',
      'status:single',
      'vendor:single',
      'mode:single',
      'language:single',
      'device:single',
    ]);
    expect(vs[1]!.label).toBe('Brands …?');
    expect(vs.find((v) => v.id === 'vendor')!.categories.map((c) => c.code)).toEqual(['V1', 'V2']);
  });
});

describe('grid rows', () => {
  it('reads the answer stored under the grid question', () => {
    const v = variables(def).find((x) => x.id === 'SAT_r1')!;
    const f = frequency(v, [rec({ SAT: { r1: 5 } }), rec({ SAT: { r1: 1 } }), rec({ SAT: { r1: 5 } }), rec({})]);
    expect(f.base).toBe(3);
    expect(f.rows.map((r) => r.count)).toEqual([1, 2]);
  });
});

describe('frequencies', () => {
  const vs = variables(def);
  const v = (id: string) => vs.find((x) => x.id === id)!;
  const records = [
    rec({ GENDER: 1, BRANDS: [1, 2], AGE: 20, WHY: 'cheap' }),
    rec({ GENDER: 2, BRANDS: [1], AGE: 30 }),
    rec({ GENDER: 2, AGE: '40' }),
    rec({ GENDER: 3 }),
  ];

  it('counts single choice on the people who answered, including codes no longer defined', () => {
    const f = frequency(v('GENDER'), records);
    expect(f.base).toBe(4);
    expect(f.rows).toEqual([
      { code: 1, label: 'Male', count: 1, pct: 25 },
      { code: 2, label: 'Female', count: 2, pct: 50 },
      { code: '3', label: 'Code 3 (not in the current version)', count: 1, pct: 25 },
    ]);
  });
  it('lets multiple choice add up to more than 100%', () => {
    const f = frequency(v('BRANDS'), records);
    expect(f.base).toBe(2);
    expect(f.rows.map((r) => r.pct)).toEqual([100, 50]);
  });
  it('summarises numbers and samples open answers', () => {
    expect(frequency(v('AGE'), records).stats).toMatchObject({ n: 3, mean: 30, median: 30, min: 20, max: 40, sd: 10 });
    expect(frequency(v('WHY'), records)).toMatchObject({ base: 1, samples: ['cheap'] });
  });
});

describe('statistics', () => {
  it('matches hand-computed z values', () => {
    // 60/100 vs 40/100: pooled p = 0.5, se = sqrt(0.25 * 0.02) = 0.0707, z = 2.828
    expect(proportionZ(60, 100, 40, 100)).toBeCloseTo(2.8284, 3);
    expect(proportionZ(0, 0, 1, 1)).toBe(0);
    const a = numericStats([1, 2, 3, 4, 5])!;
    const b = numericStats([3, 4, 5, 6, 7])!;
    // sd 1.5811 each, se = sqrt(2 * 2.5 / 5) = 1, z = -2
    expect(meanZ(a, b)).toBeCloseTo(-2, 6);
  });
});

describe('crosstabs', () => {
  const vs = variables(def);
  const v = (id: string) => vs.find((x) => x.id === id)!;
  // 100 men: 60 chose brand A; 100 women: 40 chose brand A. Ages: men 30 +/- 1, women 40 +/- 1.
  const records: AnalysisRecord[] = [];
  for (let i = 0; i < 100; i++) records.push(rec({ GENDER: 1, BRANDS: i < 60 ? [1] : [2], AGE: 29 + (i % 3), SAT_r1: 5 }));
  for (let i = 0; i < 100; i++) records.push(rec({ GENDER: 2, BRANDS: i < 40 ? [1] : [2], AGE: 39 + (i % 3), SAT_r1: 5 }));

  it('computes column percentages and marks significant differences with letters', () => {
    const t = crosstab(v('GENDER'), v('BRANDS'), records);
    expect(t.columns.map((c) => [c.label, c.letter, c.base])).toEqual([
      ['Total', '', 200],
      ['Male', 'A', 100],
      ['Female', 'B', 100],
    ]);
    const a = t.rows[0]!;
    expect(a.cells.map((c) => c.pct)).toEqual([50, 60, 40]);
    expect(a.cells[1]!.higherThan).toEqual(['B']);
    expect(a.cells[2]!.higherThan).toEqual([]);
    expect(t.rows[1]!.cells[2]!.higherThan).toEqual(['A']);
    // At 99% (z 2.576) the 2.83 difference still counts.
    expect(crosstab(v('GENDER'), v('BRANDS'), records, { confidence: 0.99 }).rows[0]!.cells[1]!.higherThan).toEqual(['B']);
  });

  it('does not test small columns', () => {
    const t = crosstab(v('GENDER'), v('BRANDS'), records.slice(0, 120));
    expect(t.columns[2]).toMatchObject({ base: 20, lowBase: true });
    expect(t.rows.every((r) => r.cells.every((c) => c.higherThan.length === 0))).toBe(true);
  });

  it('compares means for numeric stubs', () => {
    const t = crosstab(v('GENDER'), v('AGE'), records);
    expect(t.means!.map((m) => Math.round(m.stats!.mean))).toEqual([35, 30, 40]);
    expect(t.means![2]!.higherThan).toEqual(['A']);
    expect(t.means![1]!.higherThan).toEqual([]);
  });

  it('does not test overlapping columns from a multiple choice banner', () => {
    const t = crosstab(v('BRANDS'), v('GENDER'), records);
    expect(t.testNote).toMatch(/more than one column/);
    expect(t.rows.flatMap((r) => r.cells).every((c) => c.higherThan.length === 0)).toBe(true);
  });

  it('refuses unusable combinations', () => {
    expect(() => crosstab(v('AGE'), v('GENDER'), records)).toThrow(/banner/);
    expect(() => crosstab(v('GENDER'), v('WHY'), records)).toThrow(/Open answers/);
    expect(() => crosstab(v('GENDER'), v('BRANDS'), records, { confidence: 0.8 })).toThrow(/Confidence/);
  });
});
