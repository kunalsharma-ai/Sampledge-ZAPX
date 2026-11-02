import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import {
  analyzeSurvey,
  conditionHolds,
  evaluate,
  firstMatchingTermination,
  matchingQuotas,
  nextPageIndex,
  parse,
  pipeText,
  seededOrder,
  validatePage,
  ExpressionError,
} from './index.js';

const demoPath = fileURLToPath(new URL('../../../docs/examples/demo-screener.json', import.meta.url));
function demo(): SurveyDefinition {
  const r = parseSurveyDefinition(JSON.parse(readFileSync(demoPath, 'utf8')));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.definition;
}

function make(def: unknown): SurveyDefinition {
  const r = parseSurveyDefinition(def);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.definition;
}

const ctx = (vals: Record<string, unknown>) => ({
  lookup: (name: string, member?: string) => {
    if (!Object.hasOwn(vals, name)) return null;
    const v = vals[name] as never;
    return member ? ((v as Record<string, number>)[member] ?? null) : v;
  },
});

describe('expression language', () => {
  it('evaluates comparisons, boolean logic and precedence', () => {
    expect(evaluate(parse('1 + 2 * 3 == 7'), ctx({}))).toBe(true);
    expect(evaluate(parse('AGE >= 18 and AGE <= 65'), ctx({ AGE: 30 }))).toBe(true);
    expect(evaluate(parse('AGE >= 18 and AGE <= 65'), ctx({ AGE: 70 }))).toBe(false);
    expect(evaluate(parse('not Q1 == 2'), ctx({ Q1: 2 }))).toBe(false);
    expect(evaluate(parse('Q1 == 1 || Q1 == 2'), ctx({ Q1: 2 }))).toBe(true);
    expect(evaluate(parse('(1 + 2) * 3'), ctx({}))).toBe(9);
  });

  it('treats unanswered questions as null and comparisons with null as false', () => {
    expect(evaluate(parse('AGE < 18'), ctx({}))).toBe(false);
    expect(evaluate(parse('AGE == null'), ctx({}))).toBe(true);
    expect(evaluate(parse('answered(AGE)'), ctx({}))).toBe(false);
  });

  it('supports in-lists, multi answers, grid rows and functions', () => {
    expect(evaluate(parse('Q1 in [1, 3, 5]'), ctx({ Q1: 3 }))).toBe(true);
    expect(evaluate(parse('Q2 in [4, 5]'), ctx({ Q2: [1, 5] }))).toBe(true);
    expect(evaluate(parse('selected(Q2, 2, 3)'), ctx({ Q2: [1, 5] }))).toBe(false);
    expect(evaluate(parse('count(Q2)'), ctx({ Q2: [1, 5] }))).toBe(2);
    expect(evaluate(parse('G.r1 >= 4'), ctx({ G: { r1: 4 } }))).toBe(true);
    expect(evaluate(parse('sum(A, B, C)'), ctx({ A: 1, B: 2 }))).toBe(3);
    expect(evaluate(parse('round(10 / 3, 2)'), ctx({}))).toBe(3.33);
    expect(evaluate(parse('len(T) > 3'), ctx({ T: 'hello' }))).toBe(true);
    expect(evaluate(parse('1 / 0'), ctx({}))).toBe(null);
  });

  it('rejects malformed input with a position', () => {
    expect(() => parse('Q1 = 2')).toThrow(ExpressionError);
    expect(() => parse('Q1 == ')).toThrow(/end of expression/);
    expect(() => parse('Q1 == (2')).toThrow(/Expected "\)"/);
    expect(() => parse('Q1 == 2 Q2')).toThrow(/after expression/);
    expect(() => parse("'unterminated")).toThrow(/Unterminated/);
    expect(() => parse('('.repeat(100) + '1' + ')'.repeat(100))).toThrow(/nested too deeply/);
  });

  it('cannot reach JavaScript globals', () => {
    // identifiers are only ever looked up through the context
    expect(evaluate(parse('constructor == null'), ctx({}))).toBe(true);
    expect(evaluate(parse('process.env == null'), ctx({}))).toBe(true);
  });
});

describe('interview routing', () => {
  it('skips pages whose condition is false', () => {
    const def = demo();
    const answers = { AGE: 30, GENDER: 2, AWARE: [99], AWARE_OTHER: null };
    // P3 (ratings) is skipped when the respondent knows none of the brands
    expect(nextPageIndex(def, answers, 1)).toBe(3);
    expect(nextPageIndex(def, { ...answers, AWARE: [1] }, 1)).toBe(2);
    expect(nextPageIndex(def, answers, 3)).toBe(-1);
  });

  it('applies terminations and quotas', () => {
    const def = demo();
    expect(firstMatchingTermination(def, { AGE: 16 })?.id).toBe('T_UNDERAGE');
    expect(firstMatchingTermination(def, { AGE: 40 })).toBeUndefined();
    expect(matchingQuotas(def, { GENDER: 1 }).map((q) => q.id)).toEqual(['QT_MEN']);
  });

  it('pipes answer labels into text', () => {
    const def = demo();
    expect(pipeText('You know {{AWARE}}.', def, { AWARE: [1, 3] })).toBe('You know Brand A, Brand C.');
    expect(pipeText('Age {{AGE}}', def, {})).toBe('Age ');
  });

  it('randomizes deterministically and keeps anchors in place', () => {
    const items = [1, 2, 3, 4, 5, 6, 98, 99];
    const anchored = (n: number) => n >= 98;
    const a = seededOrder(items, 'resp-1', anchored);
    expect(seededOrder(items, 'resp-1', anchored)).toEqual(a);
    expect(a.slice(-2)).toEqual([98, 99]);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    const orders = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => seededOrder(items, s, anchored).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('answer validation', () => {
  const def = demo();
  const p1 = def.pages[0]!;
  const p2 = def.pages[1]!;
  const p3 = def.pages[2]!;

  it('accepts valid answers and normalizes types', () => {
    const r = validatePage(def, p1, {}, { AGE: '34', GENDER: 2 });
    expect(r.ok).toBe(true);
    expect(r.answers).toEqual({ AGE: 34, GENDER: 2 });
  });

  it('enforces required, ranges, codes and integers', () => {
    const r = validatePage(def, p1, {}, { AGE: 150, GENDER: 7 });
    expect(r.errors.map((e) => e.questionId).sort()).toEqual(['AGE', 'GENDER']);
    expect(validatePage(def, p1, {}, { AGE: 30.5, GENDER: 1 }).errors[0]?.message).toMatch(/whole number/);
    expect(validatePage(def, p1, {}, {}).errors).toHaveLength(2);
  });

  it('enforces exclusive options and clears hidden questions', () => {
    expect(validatePage(def, p2, {}, { AWARE: [1, 99] }).errors[0]?.message).toMatch(/cannot be combined/);
    // AWARE_OTHER is shown (on the same page) only when 98 is selected; otherwise it is cleared.
    const r = validatePage(def, p2, {}, { AWARE: [2, 1], AWARE_OTHER: 'sneaky' });
    expect(r.ok).toBe(true);
    expect(r.answers).toEqual({ AWARE: [1, 2], AWARE_OTHER: null });
    const withOther = validatePage(def, p2, {}, { AWARE: [98] });
    expect(withOther.errors).toEqual([{ questionId: 'AWARE_OTHER', message: 'This question requires an answer.' }]);
    expect(validatePage(def, p2, {}, { AWARE: [98], AWARE_OTHER: 'Brand Z' }).answers.AWARE_OTHER).toBe('Brand Z');
  });

  it('validates grid rows and optional grids', () => {
    expect(validatePage(def, p3, {}, { RATE: { a: 4, b: 9 } }).ok).toBe(false);
    expect(validatePage(def, p3, {}, { RATE: { zz: 1 } }).ok).toBe(false);
    const r = validatePage(def, p3, {}, { RATE: { a: 4 } });
    expect(r.ok).toBe(true);
    expect(r.answers.RATE).toEqual({ a: 4 });
  });

  it('runs custom validation rules', () => {
    const d = make({
      schemaVersion: 1,
      title: 't',
      pages: [
        {
          id: 'P1',
          questions: [
            { id: 'KIDS', type: 'numeric', text: 'Kids?' },
            {
              id: 'HH',
              type: 'numeric',
              text: 'Household size?',
              validations: [{ expr: 'HH > KIDS', message: 'Household must be larger than number of children.' }],
            },
          ],
        },
      ],
    });
    expect(validatePage(d, d.pages[0]!, {}, { KIDS: 3, HH: 2 }).errors[0]?.message).toMatch(/Household/);
    expect(validatePage(d, d.pages[0]!, {}, { KIDS: 1, HH: 3 }).ok).toBe(true);
  });
});

describe('static analysis', () => {
  it('passes the demo survey', () => {
    const report = analyzeSurvey(demo());
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  const base = (pages: unknown[], extra: Record<string, unknown> = {}) =>
    make({ schemaVersion: 1, title: 't', pages, ...extra });
  const codes = (def: SurveyDefinition) => analyzeSurvey(def).issues.map((i) => i.code);

  it('finds undefined variables, forward references and parse errors', () => {
    const def = base([
      { id: 'P1', questions: [{ id: 'Q1', type: 'single', text: 'a', options: [{ code: 1, label: 'x' }] }] },
      {
        id: 'P2',
        condition: 'Q3 == 1',
        questions: [
          { id: 'Q2', type: 'numeric', text: 'b', condition: 'NOPE > 1' },
          { id: 'Q3', type: 'single', text: 'c', options: [{ code: 1, label: 'x' }], condition: 'Q1 = 1' },
        ],
      },
    ]);
    expect(codes(def)).toEqual(expect.arrayContaining(['FORWARD_REFERENCE', 'UNDEFINED_VARIABLE', 'PARSE_ERROR']));
    expect(analyzeSurvey(def).ok).toBe(false);
  });

  it('finds impossible conditions and unreachable pages', () => {
    const def = base([
      { id: 'P1', questions: [{ id: 'Q1', type: 'single', text: 'a', options: [{ code: 1, label: 'x' }, { code: 2, label: 'y' }] }] },
      { id: 'P2', condition: 'Q1 == 1 and Q1 == 2', questions: [{ id: 'Q2', type: 'open', text: 'b' }] },
      { id: 'P3', questions: [{ id: 'Q3', type: 'open', text: 'c', condition: 'false' }] },
    ]);
    const c = codes(def);
    expect(c.filter((x) => x === 'IMPOSSIBLE_CONDITION').length).toBe(2);
    expect(c).toContain('UNREACHABLE');
  });

  it('flags unknown answer codes, duplicates, bad ranges and always-true terminations', () => {
    const def = base(
      [
        {
          id: 'P1',
          questions: [
            { id: 'Q1', type: 'single', text: 'a', options: [{ code: 1, label: 'x' }, { code: 1, label: 'y' }] },
            { id: 'q1', type: 'numeric', text: 'b', min: 10, max: 5 },
          ],
        },
        { id: 'P2', questions: [{ id: 'Q2', type: 'open', text: 'c', condition: 'Q1 == 7' }] },
      ],
      { terminations: [{ id: 'T1', condition: '1 == 1' }] },
    );
    expect(codes(def)).toEqual(
      expect.arrayContaining(['DUPLICATE_CODE', 'DUPLICATE_ID', 'INVALID_RANGE', 'UNKNOWN_OPTION_CODE', 'ALWAYS_TERMINATES']),
    );
  });

  it('checks piping references and grid members', () => {
    const def = base([
      {
        id: 'P1',
        questions: [
          {
            id: 'G',
            type: 'grid',
            text: 'Rate {{LATER}}',
            rows: [{ id: 'r1', label: 'A' }],
            columns: [{ code: 1, label: 'x' }],
          },
        ],
      },
      { id: 'P2', questions: [{ id: 'LATER', type: 'open', text: 'x', condition: 'G.r9 == 1' }] },
    ]);
    expect(codes(def)).toEqual(expect.arrayContaining(['PIPING_UNDEFINED', 'INVALID_MEMBER']));
  });

  it('conditionHolds treats unparseable expressions as false', () => {
    expect(conditionHolds('Q1 = 1', demo(), {})).toBe(false);
  });
});

describe('same-page conditions', () => {
  it('rejects a condition on a later question of the same page', () => {
    const def = make({
      schemaVersion: 1,
      title: 't',
      pages: [
        {
          id: 'P1',
          questions: [
            { id: 'A', type: 'open', text: 'a', condition: 'B == 1' },
            { id: 'B', type: 'single', text: 'b', options: [{ code: 1, label: 'x' }] },
          ],
        },
      ],
    });
    expect(analyzeSurvey(def).issues.map((i) => i.code)).toContain('FORWARD_REFERENCE');
  });
});
