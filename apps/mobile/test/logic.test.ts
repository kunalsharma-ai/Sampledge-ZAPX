import { describe, expect, it } from 'vitest';
import { ruleSchema } from '../../api/src/automation/automation-rules';
import { RECIPES } from '../src/lib/recipes';
import { withWording } from '../src/lib/wording';
import { mobileHref } from '../src/lib/links';
import type { Definition } from '../src/lib/types';

describe('automation recipes', () => {
  it('each recipe builds a rule the API accepts', () => {
    for (const r of RECIPES) {
      const rule = r.build('survey_1', 50);
      const parsed = ruleSchema.safeParse(rule);
      expect(parsed.success, `${r.key}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });
});

describe('withWording', () => {
  const def: Definition = {
    title: 'S',
    pages: [
      {
        id: 'P1',
        questions: [
          {
            id: 'Q1',
            type: 'single',
            text: 'Old?',
            options: [
              { code: 1, label: 'Yes' },
              { code: 2, label: 'No' },
            ],
            required: true,
          },
        ],
      },
    ],
  };
  it('changes text and labels but keeps codes and every other field', () => {
    const out = withWording(def, 'Q1', 'New?', { 2: 'Nope' });
    const q = out.pages[0]!.questions[0]!;
    expect(q.text).toBe('New?');
    expect(q.options).toEqual([
      { code: 1, label: 'Yes' },
      { code: 2, label: 'Nope' },
    ]);
    expect(q.required).toBe(true);
    expect(def.pages[0]!.questions[0]!.text).toBe('Old?');
  });
});

describe('mobileHref', () => {
  it('maps studio links to mobile screens', () => {
    expect(mobileHref('/surveys/abc?tab=quality')).toBe('/survey/abc');
    expect(mobileHref('https://zapx.example/projects/p1')).toBe('/project/p1');
    expect(mobileHref('/automation?run=1')).toBe('/automation');
    expect(mobileHref('/settings')).toBeNull();
    expect(mobileHref(null)).toBeNull();
  });
});

describe('app version check', () => {
  it('compares numerically and blocks apps older than the server minimum', async () => {
    const { compareVersions, versionProblem } = await import('../src/lib/version');
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(versionProblem('1.0.0', { service: 'zapx', minimumAppVersion: null })).toBeNull();
    expect(versionProblem('1.0.0', { service: 'zapx', minimumAppVersion: '1.2.0' })).toMatch(/too old/);
    expect(versionProblem('1.0.0', null)).toMatch(/not a SampCode server/);
  });
});
