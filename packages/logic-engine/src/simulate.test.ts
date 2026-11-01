import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { simulateSurvey } from './index.js';

const demoPath = fileURLToPath(new URL('../../../docs/examples/demo-screener.json', import.meta.url));
const load = (raw: unknown): SurveyDefinition => {
  const r = parseSurveyDefinition(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.definition;
};
const demo = () => load(JSON.parse(readFileSync(demoPath, 'utf8')));

describe('synthetic respondent QA', () => {
  it('covers every route of the demo survey and passes', () => {
    const r = simulateSurvey(demo(), { respondents: 300, seed: 't1', simulateQuotas: false });
    expect(r.passed).toBe(true);
    expect(r.coverage.percent).toBe(100);
    expect(r.outcomes.complete).toBeGreaterThan(0);
    expect(r.outcomes.terminate).toBeGreaterThan(0); // under-18 boundary found from "AGE < 18"
    expect(r.uniquePaths).toBeGreaterThan(1);
    expect(r.defects.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const a = simulateSurvey(demo(), { respondents: 100, seed: 'same' });
    const b = simulateSurvey(demo(), { respondents: 100, seed: 'same' });
    expect(a.outcomes).toEqual(b.outcomes);
    expect(a.samples.map((s) => s.answers)).toEqual(b.samples.map((s) => s.answers));
  });

  it('simulates quota fills', () => {
    const r = simulateSurvey(demo(), { respondents: 200, seed: 'q' });
    expect(r.outcomes.quota_full).toBeGreaterThan(0); // men's quota target is 1
    expect(r.items.find((i) => i.kind === 'quota' && i.id === 'QT_MEN')!.hits).toBe(1);
  });

  it('reports a page nobody can get past', () => {
    const def = load({
      schemaVersion: 1,
      title: 't',
      pages: [
        {
          id: 'P1',
          questions: [{ id: 'N', type: 'numeric', text: 'n', min: 1, max: 10, validations: [{ expr: 'N > 20', message: 'Must exceed 20' }] }],
        },
        { id: 'P2', questions: [{ id: 'X', type: 'open', text: 'x' }] },
      ],
    });
    const r = simulateSurvey(def, { respondents: 20, seed: 's' });
    expect(r.passed).toBe(false);
    expect(r.outcomes.stuck).toBe(20);
    expect(r.defects.map((d) => d.code)).toEqual(expect.arrayContaining(['STUCK', 'NO_COMPLETES', 'NEVER_SHOWN']));
    expect(r.defects.find((d) => d.code === 'STUCK')!.message).toMatch(/Must exceed 20/);
  });

  it('flags content hidden behind a condition that never comes true in practice', () => {
    const def = load({
      schemaVersion: 1,
      title: 't',
      pages: [
        { id: 'P1', questions: [{ id: 'AGE', type: 'numeric', text: 'age', min: 18, max: 99 }] },
        { id: 'P2', condition: 'AGE > 150', questions: [{ id: 'OLD', type: 'open', text: 'x' }] },
        { id: 'P3', questions: [{ id: 'END', type: 'open', text: 'x' }] },
      ],
    });
    const r = simulateSurvey(def, { respondents: 100, seed: 'c' });
    const codes = r.defects.map((d) => d.code);
    expect(codes).toContain('NEVER_SHOWN');
    expect(codes).toContain('CONDITION_CONSTANT');
    expect(r.coverage.percent).toBeLessThan(100);
  });
});
