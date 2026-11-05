import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { runTestCase, suggestTestCases } from './index.js';

const def = (() => {
  const p = parseSurveyDefinition({
    schemaVersion: 1,
    title: 'Routes',
    pages: [
      { id: 'S1', questions: [{ id: 'AGE', type: 'numeric', text: 'Age?', min: 10, max: 80, integer: true }] },
      {
        id: 'S2',
        questions: [
          {
            id: 'USE',
            type: 'single',
            text: 'Use it?',
            options: [
              { code: 1, label: 'Yes' },
              { code: 2, label: 'No' },
            ],
          },
        ],
      },
      { id: 'U1', condition: 'USE == 1', questions: [{ id: 'SAT', type: 'scale', text: 'Satisfied?', min: 1, max: 5 }] },
      { id: 'N1', condition: 'USE == 2', questions: [{ id: 'WHY', type: 'open', text: 'Why not?' }] },
    ],
    terminations: [{ id: 'T_YOUNG', condition: 'AGE < 18', label: 'Too young' }],
    quotas: [
      { id: 'Q_USERS', condition: 'USE == 1', target: 50 },
      { id: 'Q_OLD', condition: 'AGE >= 50', target: 50 },
    ],
    variables: [{ id: 'ADULT', expr: 'AGE >= 18' }],
  });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.definition as SurveyDefinition;
})();

describe('suggested test cases', () => {
  const cases = suggestTestCases(def, { respondents: 300, seed: 's' });

  it('covers every ending, page and quota with a few cases that pass now', () => {
    const covered = new Set(cases.flatMap((c) => c.covers));
    for (const t of ['ends complete', 'ends terminate:T_YOUNG', 'page U1', 'page N1', 'quota Q_USERS', 'quota Q_OLD'])
      expect(covered).toContain(t);
    expect(cases.length).toBeLessThanOrEqual(6);
    for (const c of cases) expect(runTestCase(def, c.case).passed).toBe(true);
  });

  it('fails when an edit changes the route', () => {
    const edited = { ...def, terminations: [{ ...def.terminations[0]!, condition: 'AGE < 21' }] };
    const young = cases.find((c) => c.case.expect.outcome === 'complete' && (c.case.answers.AGE as number) < 21);
    if (young) expect(runTestCase(edited, young.case).passed).toBe(false);
    const ended = cases.find((c) => c.case.expect.outcome === 'terminate:T_YOUNG')!;
    expect(runTestCase({ ...def, terminations: [] }, ended.case).passed).toBe(false);
    const user = cases.find((c) => c.case.expect.shows.includes('U1'))!;
    expect(user.case.expect.skips).toContain('N1');
  });
});
