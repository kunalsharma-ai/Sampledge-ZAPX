import { describe, expect, it } from 'vitest';
import { presentationSchema, surveyDefinitionSchema } from '@zapx/survey-schema';
import { buildTranslationMemory, glossaryFor, memoryMatches, textKeys, translationQa } from './index.js';

const def = surveyDefinitionSchema.parse({
  schemaVersion: 1,
  title: 'NPS',
  pages: [
    {
      id: 'P1',
      questions: [
        { id: 'NPS', type: 'scale', text: 'How likely are you to recommend Acme?', nps: true },
        { id: 'WHY', type: 'open', text: 'Why did you give {{NPS}}?' },
        {
          id: 'BRAND',
          type: 'single',
          text: 'Which brand?',
          options: [
            { code: 1, label: 'Acme' },
            { code: 2, label: 'Other' },
          ],
        },
      ],
    },
  ],
});

const keyOf = (text: string) => textKeys(def).find((k) => k.source === text)!.key;

describe('translation memory', () => {
  it('keeps the most frequent approved translation per source text', () => {
    const m = buildTranslationMemory([
      { source: 'Other', text: 'Autre' },
      { source: ' Other ', text: 'Autre' },
      { source: 'Other', text: 'Autres' },
      { source: 'Empty', text: '  ' },
    ]);
    expect(m.get('Other')).toBe('Autre');
    expect(m.has('Empty')).toBe(false);
  });

  it('fills only missing or outdated texts', () => {
    const pres = presentationSchema.parse({
      languages: [
        {
          tag: 'fr',
          name: 'Français',
          texts: { [keyOf('Which brand?')]: { text: 'Quelle marque ?', source: 'Which brand?', status: 'reviewed' } },
        },
      ],
    });
    const memory = buildTranslationMemory([
      { source: 'Which brand?', text: 'Laquelle ?' },
      { source: 'Other', text: 'Autre' },
    ]);
    expect(memoryMatches(def, pres, 'fr', memory)).toEqual({ [keyOf('Other')]: { text: 'Autre', source: 'Other' } });
  });
});

describe('per-language QA', () => {
  it('reports blockers and glossary, length and unchanged warnings', () => {
    const t = (source: string, text: string, status: 'machine' | 'reviewed' = 'reviewed') => [keyOf(source), { text, source, status }];
    const pres = presentationSchema.parse({
      languages: [
        {
          tag: 'fr',
          name: 'Français',
          texts: Object.fromEntries([
            t('How likely are you to recommend Acme?', 'Quelle est la probabilité que vous recommandiez la société ?'),
            t('Why did you give {{NPS}}?', 'Pourquoi cette note ?', 'machine'),
            t('Which brand?', 'Which brand?'),
            t('Acme', 'Acme'),
          ]),
        },
      ],
    });
    const issues = translationQa(def, pres, 'fr', [{ source: 'Acme', target: 'Acme' }]);
    const by = (kind: string) => issues.filter((i) => i.kind === kind).map((i) => i.key);
    expect(by('missing')).toContain(keyOf('Other'));
    expect(by('missing')).not.toContain(keyOf('Acme'));
    expect(by('unreviewed')).toEqual([keyOf('Why did you give {{NPS}}?')]);
    expect(by('placeholders')).toEqual([keyOf('Why did you give {{NPS}}?')]);
    expect(by('glossary')).toEqual([keyOf('How likely are you to recommend Acme?')]);
    expect(by('unchanged')).toEqual([keyOf('Which brand?')]);
    expect(issues.find((i) => i.kind === 'glossary')!.severity).toBe('warning');
  });

  it('flags translations far longer than the source', () => {
    const k = keyOf('Which brand?');
    const pres = presentationSchema.parse({
      languages: [
        {
          tag: 'de',
          name: 'Deutsch',
          texts: { [k]: { text: 'Welche Marke würden Sie unter allen Umständen auswählen?', source: 'Which brand?', status: 'reviewed' } },
        },
      ],
    });
    expect(translationQa(def, pres, 'de').some((i) => i.key === k && i.kind === 'too_long')).toBe(true);
  });

  it('picks the glossary terms a batch needs', () => {
    expect(
      glossaryFor(
        ['Rate ACME today'],
        [
          { source: 'Acme', target: 'Acme' },
          { source: 'NPS', target: 'NPS' },
        ],
      ),
    ).toEqual([{ source: 'Acme', target: 'Acme' }]);
  });
});
