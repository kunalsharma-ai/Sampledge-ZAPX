import { describe, expect, it } from 'vitest';
import { defaultPresentation, emptySurvey, parsePresentation, parseSurveyDefinition } from './index.js';

describe('survey definition schema', () => {
  it('applies defaults and accepts the starter survey', () => {
    const def = emptySurvey('Test');
    expect(def.pages[0]!.questions[0]!.type).toBe('single');
    const q = def.pages[0]!.questions[0]!;
    expect(q.type !== 'info' && q.required).toBe(true);
    expect(def.settings).toEqual({ allowBack: false, showProgress: true });
    expect(parseSurveyDefinition(JSON.parse(JSON.stringify(def))).ok).toBe(true);
  });

  it('rejects invalid variable names, reserved words and unknown types with paths', () => {
    const bad = parseSurveyDefinition({
      schemaVersion: 1,
      title: 't',
      pages: [
        {
          id: 'P1',
          questions: [
            { id: '1Q', type: 'open', text: 'x' },
            { id: 'and', type: 'open', text: 'y' },
            { id: 'Q3', type: 'slider', text: 'z' },
          ],
        },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const paths = bad.issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['pages.0.questions.0.id', 'pages.0.questions.1.id', 'pages.0.questions.2.type']));
    }
  });

  it('requires at least one page and one option', () => {
    expect(parseSurveyDefinition({ schemaVersion: 1, title: 't', pages: [] }).ok).toBe(false);
    expect(
      parseSurveyDefinition({
        schemaVersion: 1,
        title: 't',
        pages: [{ id: 'P1', questions: [{ id: 'Q1', type: 'single', text: 'x', options: [] }] }],
      }).ok,
    ).toBe(false);
  });
});

describe('presentation', () => {
  it('fills defaults and rejects unsafe logos and bad colours', () => {
    expect(defaultPresentation().theme.accent).toBe('#2f5bea');
    expect(defaultPresentation().devices.allowed).toEqual(['desktop', 'tablet', 'mobile']);
    expect(parsePresentation({ theme: { logo: 'data:image/svg+xml;base64,PHN2Zz4=' } }).ok).toBe(false);
    expect(parsePresentation({ theme: { accent: 'red' } }).ok).toBe(false);
    expect(parsePresentation({ theme: { logo: 'data:image/png;base64,iVBORw0KGgo=' } }).ok).toBe(true);
    expect(parsePresentation({ languages: [{ tag: 'not a tag', name: 'x' }] }).ok).toBe(false);
  });
});
