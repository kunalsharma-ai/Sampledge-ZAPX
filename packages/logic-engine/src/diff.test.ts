import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { diffSurveys } from './diff.js';

function def(input: unknown): SurveyDefinition {
  const r = parseSurveyDefinition(input);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.definition;
}

const base = def({
  schemaVersion: 1,
  title: 'T',
  pages: [
    { id: 'P1', questions: [{ id: 'Q1', type: 'single', text: 'Gender', options: [{ code: 1, label: 'M' }, { code: 2, label: 'F' }] }] },
    { id: 'P2', questions: [{ id: 'Q2', type: 'open', text: 'Why?' }] },
  ],
});

describe('diffSurveys', () => {
  it('reports no changes for identical definitions', () => {
    const d = diffSurveys(base, structuredClone(base));
    expect(d.items).toEqual([]);
    expect(d.affectsData).toBe(false);
  });

  it('reports added, removed, changed and moved items', () => {
    const next = structuredClone(base);
    next.pages[0]!.questions[0] = { ...next.pages[0]!.questions[0]!, text: 'Your gender', options: [{ code: 1, label: 'M' }] } as never;
    next.pages[0]!.questions.push(next.pages[1]!.questions[0]!);
    next.pages.pop();
    next.pages[0]!.questions.push({ id: 'Q3', type: 'numeric', text: 'Age', required: true, validations: [], integer: true });
    next.quotas.push({ id: 'QT1', condition: 'Q1 == 1', target: 10 });
    const d = diffSurveys(base, next);
    const by = (id: string) => d.items.find((i) => i.id === id);
    expect(by('Q1')?.change).toBe('changed');
    expect(by('Q1')?.fields).toEqual(['options', 'text']);
    expect(by('Q1')?.summary).toContain('answer codes removed: 2');
    expect(by('Q2')?.change).toBe('moved');
    expect(by('Q3')?.change).toBe('added');
    expect(by('P2')?.change).toBe('removed');
    expect(by('QT1')?.change).toBe('added');
    expect(d.affectsData).toBe(true);
  });
});
