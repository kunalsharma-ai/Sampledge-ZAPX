import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type Answers, type SurveyDefinition } from '@zapx/survey-schema';
import { analyzeSurvey, applyCleaning, cleaningByTarget, fromZapxXml, toZapxXml } from './index.js';

const make = (cleaning: unknown[]) => {
  const p = parseSurveyDefinition({
    schemaVersion: 1,
    title: 'Cleaning',
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'AGE', type: 'numeric', text: 'Age?' },
          { id: 'SAT', type: 'scale', text: 'Satisfaction', points: 5 },
          {
            id: 'BRAND',
            type: 'single',
            text: 'Brand?',
            options: [
              { code: 1, label: 'A' },
              { code: 2, label: 'B' },
              { code: 99, label: 'Unknown' },
            ],
          },
          { id: 'WHY', type: 'open', text: 'Why?' },
          { id: 'USES', type: 'multi', text: 'Uses', options: [{ code: 1, label: 'x' }] },
        ],
      },
    ],
    cleaning,
  });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.definition as SurveyDefinition;
};

const data: Answers[] = [
  { AGE: 25, SAT: 4, BRAND: 1, WHY: 'good' },
  { AGE: 150, SAT: 2, BRAND: 2, WHY: 'asdfgh' },
  { AGE: 40, BRAND: 1 },
  { AGE: 31, SAT: 5 },
];

describe('rule-based cleaning', () => {
  it('sets, clears and imputes in order, without changing the stored answers', () => {
    const def = make([
      { id: 'C1', label: 'Impossible age', when: 'AGE > 99', target: 'AGE', action: 'clear' },
      { id: 'C2', when: 'WHY == "asdfgh"', target: 'WHY', action: 'clear' },
      { id: 'C3', target: 'SAT', action: 'impute', method: 'median' },
      { id: 'C4', target: 'BRAND', action: 'impute', method: 'mode' },
      { id: 'C5', when: 'AGE < 30', target: 'BRAND', action: 'set', value: 99 },
    ]);
    const before = JSON.stringify(data);
    const r = applyCleaning(def, data);
    expect(JSON.stringify(data)).toBe(before);
    expect(r.answers[1]!.AGE).toBeUndefined();
    expect(r.answers[1]!.WHY).toBeUndefined();
    // Median of 4, 2, 5 is 4: filled only where SAT was blank.
    expect(r.imputed.C3).toBe(4);
    expect(r.answers[2]!.SAT).toBe(4);
    expect(r.answers[0]!.SAT).toBe(4);
    // Mode of 1, 2, 1 is 1, filled for the record without a brand.
    expect(r.imputed.C4).toBe(1);
    expect(r.answers[3]!.BRAND).toBe(1);
    // C5 sees C1's edit: the 150-year-old has no age any more, so only the 25-year-old is set.
    expect(r.answers[0]!.BRAND).toBe(99);
    expect(r.answers[1]!.BRAND).toBe(2);
    expect(r.changed).toEqual({ C1: 1, C2: 1, C3: 1, C4: 1, C5: 1 });
    expect(r.applied[0]).toEqual(['C5']);
    expect(r.applied[1]).toEqual(['C1', 'C2']);
    expect(cleaningByTarget(def)).toEqual({ AGE: ['C1'], WHY: ['C2'], SAT: ['C3'], BRAND: ['C4', 'C5'] });
  });

  it('rounds a mean for whole-number questions and keeps two decimals otherwise', () => {
    const def = make([{ id: 'M', target: 'AGE', action: 'impute', method: 'mean' }]);
    const r = applyCleaning(def, [{ AGE: 20 }, { AGE: 25 }, {}]);
    expect(r.imputed.M).toBe(23); // 22.5 rounds to 23 for an integer question
    expect(r.answers[2]!.AGE).toBe(23);
    expect(applyCleaning(def, [{}, {}]).imputed.M).toBeNull();
  });

  it('flags rules the data cannot take', () => {
    const def = make([
      { id: 'BAD1', target: 'USES', action: 'clear' },
      { id: 'BAD2', target: 'BRAND', action: 'set', value: 7 },
      { id: 'BAD3', target: 'WHY', action: 'impute', method: 'mean' },
      { id: 'BAD4', when: 'NOPE > 1', target: 'AGE', action: 'clear' },
      { id: 'OK', target: 'BRAND', action: 'set', value: 99 },
    ]);
    const issues = analyzeSurvey(def).issues.filter((i) => i.location.startsWith('cleaning.'));
    expect(issues.map((i) => i.location.split('.')[1])).toEqual(['BAD1', 'BAD2', 'BAD3', 'BAD4']);
    expect(issues[0]!.code).toBe('CLEANING');
  });

  it('round-trips through ZAPX XML', () => {
    const def = make([
      { id: 'C1', label: 'Impossible age', when: 'AGE > 99', target: 'AGE', action: 'clear' },
      { id: 'C5', when: 'AGE < 30 and WHY != "x"', target: 'BRAND', action: 'set', value: 99 },
      { id: 'C3', target: 'SAT', action: 'impute', method: 'median' },
    ]);
    const back = fromZapxXml(toZapxXml(def));
    expect(back.warnings).toEqual([]);
    expect((back.definition as { cleaning?: unknown }).cleaning).toEqual(def.cleaning);
  });
});
