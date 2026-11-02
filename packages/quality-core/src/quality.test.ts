import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type SurveyDefinitionInput } from '@zapx/survey-schema';
import {
  assessQuality,
  fieldwork,
  median,
  normalizeOpenEnd,
  openEndFingerprint,
  openEndFingerprints,
  openEndIssue,
  qualityDecision,
  type FieldworkRow,
} from './index.js';

function survey(quality: Record<string, unknown> = {}) {
  const input: SurveyDefinitionInput = {
    schemaVersion: 1,
    title: 'Q',
    pages: [
      {
        id: 'P1',
        questions: [
          {
            id: 'G1',
            type: 'grid',
            text: 'Rate',
            rows: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase() })),
            columns: [1, 2, 3, 4, 5].map((code) => ({ code, label: `L${code}` })),
          },
          { id: 'ATTN', type: 'single', text: 'Pick 3', options: [1, 2, 3].map((code) => ({ code, label: String(code) })) },
          { id: 'WHY', type: 'open', text: 'Why?' },
        ],
      },
    ],
    settings: { quality: quality as never },
  };
  const parsed = parseSurveyDefinition(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.definition;
}

const good = { G1: { a: 1, b: 3, c: 2, d: 5, e: 4 }, ATTN: 3, WHY: 'Because the price was fair and the staff were helpful.' };

describe('open-end checks', () => {
  it('accepts ordinary answers in several languages', () => {
    for (const t of [
      'Too expensive for what you get',
      'none of them',
      'Weil der Preis stimmt',
      'très bon rapport qualité-prix',
      '¿Por qué no?',
      '价格太贵了',
      'Нормально',
      '42',
      '12/05/2026',
      'Rhythm',
    ])
      expect(openEndIssue(t), t).toBeNull();
  });
  it('flags gibberish and keyboard mashing', () => {
    for (const t of ['asdfgh', 'sdfghjkl', 'aaaaaa', 'xcvbnm', 'asasasas', 'good good good', 'qwerty', 'jjjjjjjj', 'bnmvcxz'])
      expect(openEndIssue(t), t).toBe('gibberish');
  });
  it('flags low-effort answers without calling them gibberish', () => {
    for (const t of ['ok', 'idk', 'N/A', '.', '???', 'x']) expect(openEndIssue(t), t).toBe('low_effort');
  });
  it('fingerprints only long answers, ignoring case and punctuation', () => {
    expect(openEndFingerprint('too expensive')).toBeNull();
    const a = openEndFingerprint('I like the taste, and the price is fair!');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(openEndFingerprint('i like the taste and the PRICE is fair')).toBe(a);
    expect(normalizeOpenEnd('  Hello,   World! ')).toBe('hello world');
  });
});

describe('assessQuality', () => {
  it('scores a clean interview 100', () => {
    expect(assessQuality({ def: survey(), answers: good, durationMs: 300_000, medianMs: 280_000 })).toEqual({ score: 100, flags: [] });
  });

  it('flags hard and relative speeders, but not without a median', () => {
    const hard = assessQuality({ def: survey({ minSeconds: 60 }), answers: good, durationMs: 30_000, medianMs: null });
    expect(hard.flags.map((f) => f.code)).toEqual(['speeder_hard']);
    expect(hard.score).toBe(40);
    const rel = assessQuality({ def: survey(), answers: good, durationMs: 60_000, medianMs: 300_000 });
    expect(rel.flags[0]).toMatchObject({ code: 'speeder', penalty: 35 });
    expect(rel.flags[0]!.detail).toContain('under 40% of the median 300 s');
    expect(assessQuality({ def: survey(), answers: good, durationMs: 60_000, medianMs: null }).flags).toEqual([]);
  });

  it('flags straightlined grids with enough rows only', () => {
    const answers = { ...good, G1: { a: 4, b: 4, c: 4, d: 4, e: 4 } };
    const r = assessQuality({ def: survey(), answers, durationMs: null, medianMs: null });
    expect(r.flags).toEqual([
      expect.objectContaining({ code: 'straightline', ref: 'G1', detail: 'G1: the same answer (“L4”) in all 5 rows.' }),
    ]);
    expect(assessQuality({ def: survey({ straightlineMinRows: 6 }), answers, durationMs: null, medianMs: null }).flags).toEqual([]);
  });

  it('combines open-end, duplicate, network and custom checks', () => {
    const def = survey({ checks: [{ id: 'ATTN_CHECK', condition: 'ATTN != 3', label: 'Attention check', weight: 30 }] });
    const r = assessQuality({
      def,
      answers: { ...good, ATTN: 1, WHY: 'sdfghjk' },
      durationMs: null,
      medianMs: null,
      duplicateOpenEnds: new Set(['WHY']),
      sameNetworkCompletes: 2,
    });
    expect(r.flags.map((f) => f.code)).toEqual(['open_gibberish', 'open_duplicate', 'same_network', 'check_failed']);
    expect(r.flags.find((f) => f.code === 'check_failed')!.detail).toBe('Attention check failed.');
    expect(r.score).toBe(5); // 100 - 20 - 25 - 20 - 30
  });

  it('turns everything off with enabled: false', () => {
    const r = assessQuality({
      def: survey({ enabled: false, minSeconds: 600 }),
      answers: { ...good, WHY: 'aaaa' },
      durationMs: 1,
      medianMs: null,
    });
    expect(r).toEqual({ score: 100, flags: [] });
    expect(openEndFingerprints(survey({ enabled: false }), good)).toEqual([]);
  });

  it('scores versions published before quality settings existed with the defaults', () => {
    const def = survey();
    const old = { ...def, settings: { allowBack: false, showProgress: true } } as unknown as typeof def;
    const r = assessQuality({ def: old, answers: { ...good, WHY: 'aaaaaa' }, durationMs: null, medianMs: null });
    expect(r.flags.map((f) => f.code)).toEqual(['open_gibberish']);
  });

  it('never goes below zero', () => {
    const def = survey({ minSeconds: 600, checks: [{ id: 'C1', condition: 'true', weight: 100 }] });
    expect(assessQuality({ def, answers: good, durationMs: 1000, medianMs: null }).score).toBe(0);
  });
});

describe('qualityDecision', () => {
  const s = survey().settings.quality;
  it('reviews below reviewBelow and rejects only when rejectBelow is set', () => {
    expect(qualityDecision(s, 100)).toBe('pass');
    expect(qualityDecision(s, 69)).toBe('review');
    expect(qualityDecision(s, 0)).toBe('review');
    expect(qualityDecision({ ...s, rejectBelow: 50 }, 49)).toBe('reject');
    expect(qualityDecision({ ...s, rejectBelow: 50 }, 50)).toBe('review');
    expect(qualityDecision({ ...s, enabled: false }, 0)).toBe('pass');
  });
});

describe('fieldwork', () => {
  const row = (over: Partial<FieldworkRow>): FieldworkRow => ({
    status: 'complete',
    vendor: 'A',
    durationMs: 300_000,
    qualityScore: 100,
    reviewState: 'none',
    lastPageId: 'P3',
    ...over,
  });
  it('computes incidence, LOI, review counts and drop-off per vendor', () => {
    const rows = [
      row({}),
      row({ durationMs: 500_000, qualityScore: 60, reviewState: 'pending' }),
      row({ status: 'terminate', lastPageId: 'P1', durationMs: 20_000 }),
      row({ status: 'quality_fail', reviewState: 'rejected', vendor: 'B' }),
      row({ status: 'partial', lastPageId: 'P2', vendor: 'B' }),
      row({ status: 'in_progress', lastPageId: 'P2', vendor: null }),
      row({ status: 'quota_full', vendor: 'B' }),
    ];
    const f = fieldwork(rows);
    expect(f.total).toMatchObject({
      starts: 7,
      incidence: 50,
      completionRate: 28.6,
      medianLoiSeconds: 400,
      averageQualityScore: 80,
      pendingReview: 1,
      rejectedInReview: 1,
    });
    expect(f.total.counts.partial).toBe(1);
    expect(f.vendors.map((v) => v.vendor)).toEqual(['(no vendor)', 'A', 'B']);
    expect(f.vendors[2]!.summary.incidence).toBe(0);
    expect(f.dropOff).toEqual([{ pageId: 'P2', count: 2 }]);
    expect(fieldwork([]).total.incidence).toBeNull();
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});
