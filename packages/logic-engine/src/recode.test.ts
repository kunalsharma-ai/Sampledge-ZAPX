import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { analyzeSurvey, fromZapxXml, toZapxXml, variableLineage } from './index.js';

const make = (extra: Record<string, unknown>) => {
  const p = parseSurveyDefinition({
    schemaVersion: 1,
    title: 'Recodes',
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'AGE', type: 'numeric', text: 'Age?' },
          { id: 'INC', type: 'numeric', text: 'Income?' },
        ],
      },
    ],
    variables: [
      { id: 'RICH', expr: 'INC >= 5' },
      { id: 'SEG', expr: 'RICH and AGE >= 35' },
    ],
    recodes: [
      {
        id: 'AGEGRP',
        label: 'Age group',
        source: 'AGE',
        groups: [
          { code: 1, label: 'Under 35', max: 34 },
          { code: 2, label: '35 plus', min: 35 },
        ],
      },
      { id: 'SEGR', source: 'SEG', groups: [{ code: 1, label: 'Target', values: [1, 'yes'] }], otherwise: { code: 0, label: 'Other' } },
    ],
    ...extra,
  });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.definition as SurveyDefinition;
};

describe('recodes and lineage', () => {
  it('traces calculated variables back to the questions they use', () => {
    expect(variableLineage(make({}))).toEqual({ RICH: ['INC'], SEG: ['RICH', 'AGE', 'INC'] });
  });

  it('round-trips recodes through SampCode XML', () => {
    const def = make({});
    const back = parseSurveyDefinition(fromZapxXml(toZapxXml(def)).definition);
    expect(back.ok && back.definition).toEqual(def);
  });

  it('refuses a recode named like a question', () => {
    const def = make({ recodes: [{ id: 'AGE', source: 'INC', groups: [{ code: 1, label: 'x', min: 1 }] }] });
    expect(analyzeSurvey(def).issues.some((i) => i.code === 'DUPLICATE_ID' && i.location === 'recodes.AGE')).toBe(true);
  });

  it('rejects a group without values or range, and repeated codes', () => {
    const base = { schemaVersion: 1, title: 't', pages: [{ id: 'P', questions: [{ id: 'A', type: 'numeric', text: 'a' }] }] };
    expect(parseSurveyDefinition({ ...base, recodes: [{ id: 'R', source: 'A', groups: [{ code: 1, label: 'x' }] }] }).ok).toBe(false);
    expect(
      parseSurveyDefinition({
        ...base,
        recodes: [
          {
            id: 'R',
            source: 'A',
            groups: [
              { code: 1, label: 'x', min: 1 },
              { code: 1, label: 'y', max: 0 },
            ],
          },
        ],
      }).ok,
    ).toBe(false);
  });
});
