/** Milestone 11 question types: scale/NPS, ranking, constant sum, slider, and media checks. */
import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { analyzeSurvey, conditionHolds, localizeDefinition, normalizeAnswer, simulateSurvey, textKeys, validatePage } from './index.js';

function make(def: unknown): SurveyDefinition {
  const r = parseSurveyDefinition(def);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.definition;
}

const brands = [
  { code: 1, label: 'Alpha' },
  { code: 2, label: 'Beta' },
  { code: 3, label: 'Gamma' },
  { code: 4, label: 'Delta' },
];
const def = make({
  schemaVersion: 1,
  title: 'Rich',
  pages: [
    {
      id: 'P1',
      questions: [
        {
          id: 'NPS',
          type: 'scale',
          text: 'Recommend?',
          nps: true,
          minLabel: 'Not at all likely',
          maxLabel: 'Extremely likely',
          dontKnow: { code: 99, label: "Don't know" },
        },
        { id: 'RANK', type: 'ranking', text: 'Rank these', options: brands, rankCount: 2 },
        { id: 'SPEND', type: 'sum', text: 'Share 100 points', options: brands.slice(0, 3) },
        { id: 'TEMP', type: 'numeric', text: 'How warm?', display: 'slider', min: 0, max: 100, step: 5, integer: true },
        {
          id: 'AD',
          type: 'info',
          text: 'Watch this',
          media: { kind: 'video', id: 'vid_1234567890', alt: 'A 30-second ad', requireComplete: true },
        },
      ],
    },
    {
      id: 'P2',
      condition: 'NPS >= 9 and RANK.1 == 1 and SPEND.2 > 50',
      questions: [{ id: 'WHY', type: 'open', text: 'Why?' }],
    },
  ],
});
const q = (id: string) => def.pages.flatMap((p) => p.questions).find((x) => x.id === id)!;

describe('scale', () => {
  it('accepts points on the scale and the don’t know code', () => {
    expect(normalizeAnswer(q('NPS'), 10)).toEqual({ value: 10 });
    expect(normalizeAnswer(q('NPS'), '0')).toEqual({ value: 0 });
    expect(normalizeAnswer(q('NPS'), 99)).toEqual({ value: 99 });
    expect(normalizeAnswer(q('NPS'), 11)).toEqual({ error: 'Choose a point on the scale.' });
    expect(normalizeAnswer(q('NPS'), 4.5)).toEqual({ error: 'Choose a point on the scale.' });
  });
});

describe('ranking', () => {
  it('needs exactly the top N, each once', () => {
    expect(normalizeAnswer(q('RANK'), [3, 1])).toEqual({ value: [3, 1] });
    expect(normalizeAnswer(q('RANK'), ['2', '4'])).toEqual({ value: [2, 4] });
    expect(normalizeAnswer(q('RANK'), [3])).toEqual({ error: 'Rank your top 2.' });
    expect(normalizeAnswer(q('RANK'), [3, 3])).toEqual({ error: 'Rank only the listed items, each once.' });
    expect(normalizeAnswer(q('RANK'), [3, 9])).toEqual({ error: 'Rank only the listed items, each once.' });
    expect(normalizeAnswer(q('RANK'), [1, 2, 3])).toEqual({ error: 'Rank only the listed items, each once.' });
  });
  it('asks to rank every item when there is no top N', () => {
    const all = { ...q('RANK'), rankCount: undefined } as never;
    expect(normalizeAnswer(all, [1, 2])).toEqual({ error: 'Rank all 4 items.' });
  });
});

describe('constant sum', () => {
  it('must add up to the total and fills empty items with 0', () => {
    expect(normalizeAnswer(q('SPEND'), { 1: 30, 2: '70' })).toEqual({ value: { 1: 30, 2: 70, 3: 0 } });
    expect(normalizeAnswer(q('SPEND'), { 1: 30, 2: 60 })).toEqual({ error: 'The amounts must add up to 100.' });
    expect(normalizeAnswer(q('SPEND'), { 1: -10, 2: 110 })).toEqual({ error: 'Enter an amount of 0 or more for each item.' });
    expect(normalizeAnswer(q('SPEND'), { 1: 50.5, 2: 49.5 })).toEqual({ error: 'Enter a whole number.' });
    expect(normalizeAnswer(q('SPEND'), { 9: 100 })).toEqual({ error: 'Enter an amount of 0 or more for each item.' });
  });
});

describe('logic', () => {
  it('reads ranks and amounts with a dot', () => {
    const answers = { NPS: 9, RANK: [1, 3], SPEND: { 1: 20, 2: 80, 3: 0 } };
    expect(conditionHolds('NPS >= 9 and RANK.1 == 1 and SPEND.2 > 50', def, answers)).toBe(true);
    expect(conditionHolds('RANK.3 == 2', def, answers)).toBe(true);
    expect(conditionHolds('RANK.2 == null', def, answers)).toBe(true);
    expect(conditionHolds('3 in RANK', def, answers)).toBe(true);
  });
  it('validates a page with the new types', () => {
    const r = validatePage(def, def.pages[0]!, {}, { NPS: 10, RANK: [1, 2], SPEND: { 1: 100 }, TEMP: 55 });
    expect(r.ok).toBe(true);
    expect(r.answers.SPEND).toEqual({ 1: 100, 2: 0, 3: 0 });
  });
});

describe('static checks', () => {
  const issues = (d: unknown) => analyzeSurvey(make(d)).issues.map((i) => i.code);
  const one = (question: unknown) => ({ schemaVersion: 1, title: 'x', pages: [{ id: 'P1', questions: [question] }] });

  it('accepts the example survey', () => {
    expect(analyzeSurvey(def).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('flags invalid settings', () => {
    expect(issues(one({ id: 'S', type: 'scale', text: 'x', nps: true, min: 1, max: 10 }))).toContain('INVALID_RANGE');
    expect(issues(one({ id: 'S', type: 'scale', text: 'x', min: 1, max: 5, dontKnow: { code: 3, label: 'DK' } }))).toContain(
      'DUPLICATE_CODE',
    );
    expect(issues(one({ id: 'R', type: 'ranking', text: 'x', options: brands, rankCount: 5 }))).toContain('INVALID_RANGE');
    expect(issues(one({ id: 'N', type: 'numeric', text: 'x', display: 'slider', min: 0 }))).toContain('INVALID_RANGE');
    expect(issues(one({ id: 'I', type: 'info', text: 'x', media: { kind: 'image', id: 'img_1234567890' } }))).toContain('MEDIA');
  });
  it('checks dotted references and codes', () => {
    const d = {
      schemaVersion: 1,
      title: 'x',
      pages: [
        {
          id: 'P1',
          questions: [
            { id: 'R', type: 'ranking', text: 'x', options: brands },
            { id: 'S', type: 'scale', text: 'x', min: 1, max: 5 },
          ],
        },
        { id: 'P2', condition: 'R.9 == 1 or S == 7 or S.1 == 1', questions: [{ id: 'O', type: 'open', text: 'x' }] },
      ],
    };
    const found = analyzeSurvey(make(d)).issues.map((i) => i.code);
    expect(found.filter((c) => c === 'INVALID_MEMBER')).toHaveLength(2);
    expect(found).toContain('UNKNOWN_OPTION_CODE');
  });
});

describe('simulation', () => {
  it('produces valid answers for every new type', () => {
    const r = simulateSurvey(def, { respondents: 200, seed: 'rich' });
    expect(r.outcomes.error).toBe(0);
    expect(r.outcomes.stuck).toBe(0);
    expect(r.outcomes.complete).toBe(200);
    // P2 needs NPS >= 9, Alpha ranked first and Beta above 50 points: reachable by chance.
    expect(r.items.find((c) => c.kind === 'page' && c.id === 'P2')!.hits).toBeGreaterThan(0);
  });
});

describe('translation', () => {
  it('has keys for labels, items and media, and applies them', () => {
    const keys = textKeys(def).map((k) => k.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'q.NPS.minLabel',
        'q.NPS.maxLabel',
        'q.NPS.dontKnow',
        'q.RANK.opt.4',
        'q.SPEND.opt.3',
        'q.AD.media.alt',
        'ui.rankTop',
        'ui.playToEnd',
      ]),
    );
    const fr = localizeDefinition(def, {
      tag: 'fr',
      name: 'Français',
      enabled: true,
      texts: {
        'q.NPS.dontKnow': { text: 'Je ne sais pas', source: "Don't know", status: 'reviewed' },
        'q.RANK.opt.1': { text: 'Alpha FR', source: 'Alpha', status: 'reviewed' },
        'q.AD.media.alt': { text: 'Une publicité de 30 secondes', source: 'A 30-second ad', status: 'reviewed' },
      },
    });
    const all = fr.pages.flatMap((p) => p.questions);
    expect((all.find((x) => x.id === 'NPS') as { dontKnow: { label: string } }).dontKnow.label).toBe('Je ne sais pas');
    expect((all.find((x) => x.id === 'RANK') as { options: Array<{ label: string }> }).options[0]!.label).toBe('Alpha FR');
    expect(all.find((x) => x.id === 'AD')!.media!.alt).toBe('Une publicité de 30 secondes');
  });
});

describe('photo', () => {
  const photo = make({
    schemaVersion: 1,
    title: 'Photo',
    pages: [{ id: 'P1', questions: [{ id: 'SHELF', type: 'photo', text: 'Take a photo of the shelf' }] }],
    settings: { capi: { gps: 'required', audio: 'consent' } },
  });
  const pq = photo.pages[0]!.questions[0]!;
  it('stores a capture reference', () => {
    expect(normalizeAnswer(pq, 'c3f1a9b2-4e5d')).toEqual({ value: 'c3f1a9b2-4e5d' });
    expect(normalizeAnswer(pq, '../etc/passwd')).toEqual({ error: 'Take or choose a photo.' });
    expect(normalizeAnswer(pq, 42)).toEqual({ error: 'Take or choose a photo.' });
    expect(normalizeAnswer(pq, '')).toEqual({ error: 'This question requires an answer.' });
  });
  it('keeps the capture settings and simulates', () => {
    expect(photo.settings.capi).toEqual({ gps: 'required', audio: 'consent' });
    expect(simulateSurvey(photo, { respondents: 20, seed: 'p' }).outcomes.complete).toBe(20);
    expect(conditionHolds('SHELF != null', photo, { SHELF: 'abcdefgh' })).toBe(true);
  });
});
