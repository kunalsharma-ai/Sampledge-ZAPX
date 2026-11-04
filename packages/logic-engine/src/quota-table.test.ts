import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { analyzeSurvey, matchingQuotas, quotaDimensions, quotaSlots, quotaTableCells, quotasFromCells } from './index.js';

const def = (() => {
  const p = parseSurveyDefinition({
    schemaVersion: 1,
    title: 'Quota table',
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'REGION', type: 'single', text: 'Region?', options: ['North', 'South', 'East'].map((label, i) => ({ code: i + 1, label })) },
          { id: 'AGE', type: 'single', text: 'Age?', options: [{ code: 1, label: '18-34' }, { code: 2, label: '35+' }] },
          { id: 'SAT', type: 'scale', text: 'Satisfaction', min: 1, max: 5 },
          { id: 'NOTE', type: 'open', text: 'Anything else?' },
        ],
      },
    ],
    quotas: [{ id: 'QT_REGION1_AGE1', condition: 'REGION == 1 and AGE == 1', target: 5 }],
  });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.definition as SurveyDefinition;
})();

describe('quota table builder', () => {
  const dims = quotaDimensions(def);

  it('offers single choice and rating questions only', () => {
    expect(dims.map((d) => d.id)).toEqual(['REGION', 'AGE', 'SAT']);
    expect(dims[2]!.options.map((o) => o.code)).toEqual([1, 2, 3, 4, 5]);
  });

  it('makes one cell per combination, splitting the total exactly', () => {
    const cells = quotaTableCells(dims.slice(0, 2), 100, { REGION3_AGE2: 30 });
    expect(cells).toHaveLength(6);
    expect(cells[0]).toEqual({ key: 'REGION1_AGE1', label: 'North × 18-34', condition: 'REGION == 1 and AGE == 1', target: 17 });
    expect(cells.at(-1)!.target).toBe(30);
    expect(quotaTableCells(dims.slice(0, 2), 100).reduce((s, c) => s + c.target, 0)).toBe(100);
    expect(quotaTableCells(dims, 300)).toHaveLength(30);
  });

  it('adds quotas that each respondent matches exactly once, skipping existing ids', () => {
    const quotas = quotasFromCells(def, quotaTableCells(dims.slice(0, 2), 60));
    expect(quotas.map((q) => q.id)).not.toContain('QT_REGION1_AGE1');
    expect(quotas).toHaveLength(5);
    const next = { ...def, quotas: [...def.quotas, ...quotas] };
    expect(analyzeSurvey(next).issues.filter((i) => i.severity === 'error')).toEqual([]);
    for (const r of [1, 2, 3]) for (const a of [1, 2]) expect(matchingQuotas(next, { REGION: r, AGE: a })).toHaveLength(1);
  });
});

describe('least-fill quota groups', () => {
  const g = {
    ...def,
    quotas: [
      { id: 'QN', condition: 'REGION == 1 or AGE == 1', target: 10, group: 'G' },
      { id: 'QS', condition: 'REGION == 2 or AGE == 1', target: 10, group: 'G' },
      { id: 'QA', condition: 'true', target: 10 },
    ],
  } as SurveyDefinition;
  it('gives a group one slot, least filled first', () => {
    const fill: Record<string, number> = { QN: 0.8, QS: 0.2, QA: 0 };
    expect(quotaSlots(g, { REGION: 1, AGE: 1 }, (q) => fill[q.id]!).map((s) => s.map((q) => q.id))).toEqual([['QS', 'QN'], ['QA']]);
    expect(quotaSlots(g, { REGION: 1, AGE: 2 }).map((s) => s.map((q) => q.id))).toEqual([['QN'], ['QA']]);
  });
});
