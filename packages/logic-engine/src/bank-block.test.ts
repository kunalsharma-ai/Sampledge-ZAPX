import { describe, expect, it } from 'vitest';
import { bankBlockSchema, parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { analyzeSurvey, insertBankBlock } from './index.js';

const survey = (() => {
  const p = parseSurveyDefinition({
    schemaVersion: 1,
    title: 'Host',
    pages: [
      { id: 'S1', questions: [{ id: 'AGE', type: 'numeric', text: 'Age?' }] },
      { id: 'END', questions: [{ id: 'THANKS', type: 'info', text: 'Thanks' }] },
    ],
  });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.definition as SurveyDefinition;
})();

const block = bankBlockSchema.parse({
  pages: [
    {
      id: 'S1',
      questions: [
        { id: 'AGE', type: 'numeric', text: 'Your age?' },
        { id: 'KIDS', type: 'single', text: 'Any kids?', options: [{ code: 1, label: 'Yes' }, { code: 2, label: 'No' }] },
      ],
    },
    {
      id: 'DEMO2',
      condition: 'KIDS == 1 and AGE >= 18 and "AGE" != "x"',
      questions: [
        {
          id: 'KIDAGE',
          type: 'multi',
          text: 'Ages of the children, at {{AGE}}?',
          options: [{ code: 1, label: 'Under 5' }, { code: 2, label: '5 plus' }],
          validations: [{ expr: 'count(KIDAGE) >= 1 or AGE < 18', message: 'Pick one' }],
        },
      ],
    },
  ],
});

describe('question bank blocks', () => {
  it('inserts the pages with clashing names renamed and their logic updated', () => {
    const r = insertBankBlock(survey, block, 0);
    expect(r.renamed).toEqual({ AGE: 'AGE_2', S1: 'S1_2' });
    expect(r.def.pages.map((p) => p.id)).toEqual(['S1', 'S1_2', 'DEMO2', 'END']);
    const [, first, second] = r.def.pages;
    expect(first!.questions.map((q) => q.id)).toEqual(['AGE_2', 'KIDS']);
    expect(second!.questions[0]!.text).toBe('Ages of the children, at {{AGE_2}}?');
    expect(second!.condition).toBe('KIDS == 1 and AGE_2 >= 18 and "AGE" != "x"');
    expect((second!.questions[0] as { validations: Array<{ expr: string }> }).validations[0]!.expr).toBe('count(KIDAGE) >= 1 or AGE_2 < 18');
    const parsed = parseSurveyDefinition(r.def);
    expect(parsed.ok).toBe(true);
    expect(analyzeSurvey(r.def).issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
  });

  it('keeps names when nothing clashes, and appends at the end by default', () => {
    const empty = { ...survey, pages: [{ id: 'X', questions: [{ id: 'Z', type: 'info', text: 'z' }] }] } as SurveyDefinition;
    const r = insertBankBlock(empty, block);
    expect(r.renamed).toEqual({});
    expect(r.pages).toEqual(['S1', 'DEMO2']);
    expect(r.def.pages.at(-1)!.id).toBe('DEMO2');
  });
});
