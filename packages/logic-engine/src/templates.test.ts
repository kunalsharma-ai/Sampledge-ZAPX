import { describe, expect, it } from 'vitest';
import { SURVEY_TEMPLATES, parseSurveyDefinition, surveyTemplate } from '@zapx/survey-schema';
import { analyzeSurvey, simulateSurvey } from './index.js';

describe('built-in survey templates', () => {
  it('have unique keys', () => {
    expect(new Set(SURVEY_TEMPLATES.map((t) => t.key)).size).toBe(SURVEY_TEMPLATES.length);
    expect(surveyTemplate('customer-nps')?.name).toBeTruthy();
    expect(surveyTemplate('nope')).toBeUndefined();
  });

  for (const t of SURVEY_TEMPLATES)
    it(`${t.key} is valid and passes the logic check`, () => {
      const parsed = parseSurveyDefinition(t.definition);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const report = analyzeSurvey(parsed.definition);
      expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
      const sim = simulateSurvey(parsed.definition, { respondents: 50 });
      expect(sim.outcomes.complete).toBeGreaterThan(0);
      expect(sim.outcomes.stuck + sim.outcomes.error).toBe(0);
      expect(sim.passed).toBe(true);
    });
});
