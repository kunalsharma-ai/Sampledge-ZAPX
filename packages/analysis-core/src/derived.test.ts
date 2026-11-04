import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { crosstab, frequency, recodeProblems, variables, type AnalysisRecord } from './index';

const parsed = parseSurveyDefinition({
  schemaVersion: 1,
  title: 'Derived',
  pages: [
    {
      id: 'P1',
      questions: [
        { id: 'AGE', type: 'numeric', text: 'Age?', min: 18, max: 99 },
        { id: 'SAT', type: 'scale', text: 'Satisfaction', min: 1, max: 5 },
        { id: 'BRANDS', type: 'multi', text: 'Brands used', options: [1, 2, 3, 4].map((code) => ({ code, label: `B${code}` })) },
      ],
    },
  ],
  variables: [{ id: 'SENIOR', label: 'Senior', expr: 'AGE >= 55' }],
  recodes: [
    {
      id: 'AGEGRP',
      label: 'Age group',
      source: 'AGE',
      groups: [
        { code: 1, label: '18-34', max: 34 },
        { code: 2, label: '35-54', min: 35, max: 54 },
        { code: 3, label: '55+', min: 55 },
      ],
    },
    { id: 'T2B', source: 'SAT', groups: [{ code: 1, label: 'Top 2', values: [4, 5] }], otherwise: { code: 0, label: 'Rest' } },
    { id: 'LOCAL', source: 'BRANDS', groups: [{ code: 1, label: 'Local', values: [1, 2] }, { code: 2, label: 'Global', values: [3, 4] }] },
    { id: 'GEN', label: 'Generation', source: 'AGEGRP', groups: [{ code: 1, label: 'Younger', values: [1, 2] }, { code: 2, label: 'Older', values: [3] }] },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const def = parsed.definition as SurveyDefinition;

const rec = (age: number, sat: number, brands: number[]): AnalysisRecord => ({
  answers: { AGE: age, SAT: sat, BRANDS: brands },
  system: { status: 'complete' },
  derived: { SENIOR: age >= 55 },
});
const records = [rec(20, 5, [1]), rec(40, 4, [3, 4]), rec(60, 2, [1, 3]), rec(70, 1, [])];

describe('derived variables', () => {
  const vars = variables(def, records, { lineage: { SENIOR: ['AGE'] } });
  const v = (id: string) => vars.find((x) => x.id === id)!;

  it('builds recodes and calculated variables with their lineage', () => {
    expect(v('AGEGRP')).toMatchObject({ kind: 'single', source: 'derived', lineage: ['AGE'], derivation: { kind: 'recode', from: 'AGE' } });
    expect(v('GEN').lineage).toEqual(['AGEGRP', 'AGE']);
    expect(v('LOCAL').kind).toBe('multi');
    expect(v('SENIOR')).toMatchObject({ kind: 'single', lineage: ['AGE'], derivation: { kind: 'calculated', expr: 'AGE >= 55' } });
    expect(v('T2B').categories.map((c) => c.label)).toEqual(['Top 2', 'Rest']);
  });

  it('counts recoded values in frequencies and crosstabs', () => {
    const f = frequency(v('AGEGRP'), records);
    expect(f.rows.map((r) => r.count)).toEqual([1, 1, 2]);
    expect(frequency(v('T2B'), records).rows.map((r) => r.count)).toEqual([2, 2]);
    expect(frequency(v('LOCAL'), records).rows.map((r) => r.count)).toEqual([2, 2]);
    expect(frequency(v('GEN'), records).rows.map((r) => r.count)).toEqual([2, 2]);
    expect(frequency(v('SENIOR'), records).rows.map((r) => r.count)).toEqual([2, 2]);
    const x = crosstab(v('GEN'), v('T2B'), records);
    expect(x.columns.length).toBeGreaterThan(0);
  });

  it('reports recodes that cannot be built', () => {
    const bad = { ...def, recodes: [...def.recodes, { id: 'X', source: 'NOPE', groups: [{ code: 1, label: 'a', values: [1] }] }, { ...def.recodes[0]!, id: 'AGE' }] };
    expect(recodeProblems(bad as SurveyDefinition).map((p) => p.id)).toEqual(['X', 'AGE']);
    expect(recodeProblems(def)).toEqual([]);
  });
});
