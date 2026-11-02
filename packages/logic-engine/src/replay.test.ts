import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition } from '@zapx/survey-schema';
import { replayInterview } from './replay.js';

const parsed = parseSurveyDefinition({
  schemaVersion: 1,
  title: 'Replay',
  pages: [
    { id: 'P1', questions: [{ id: 'AGE', type: 'numeric', text: 'Age', min: 0, max: 120 }] },
    {
      id: 'P2',
      questions: [
        {
          id: 'Q1',
          type: 'single',
          text: 'Pick',
          options: [
            { code: 1, label: 'A' },
            { code: 2, label: 'B' },
          ],
        },
      ],
    },
    { id: 'P3', condition: 'Q1 == 2', questions: [{ id: 'Q2', type: 'open', text: 'Why B?' }] },
  ],
  terminations: [{ id: 'T_AGE', condition: 'AGE < 18' }],
});
if (!parsed.ok) throw new Error('bad fixture');
const def = parsed.definition;

describe('replayInterview', () => {
  it('completes, skipping hidden pages and dropping answers to them', () => {
    const r = replayInterview(def, { AGE: 30, Q1: 1, Q2: 'should be ignored' });
    expect(r).toEqual({ outcome: 'complete', answers: { AGE: 30, Q1: 1 }, lastPageId: 'P2' });
  });
  it('applies terminations', () => {
    expect(replayInterview(def, { AGE: 12, Q1: 1 })).toMatchObject({ outcome: 'terminate', reason: 'T_AGE', lastPageId: 'P1' });
  });
  it('reports where a broken-off interview stopped', () => {
    expect(replayInterview(def, { AGE: 30, Q1: 2 })).toMatchObject({ outcome: 'incomplete', lastPageId: 'P3' });
    expect(replayInterview(def, {})).toMatchObject({ outcome: 'incomplete', lastPageId: 'P1' });
  });
  it('rejects answers the published version does not allow', () => {
    const r = replayInterview(def, { AGE: 30, Q1: 7 });
    expect(r).toMatchObject({ outcome: 'invalid', pageId: 'P2' });
    expect(replayInterview(def, { AGE: 300 })).toMatchObject({ outcome: 'invalid', pageId: 'P1' });
  });
});
