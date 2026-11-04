import { describe, expect, it } from 'vitest';
import {
  parseSurveyDefinition,
  type Answers,
  type ConjointQuestion,
  type MaxDiffQuestion,
  type SurveyDefinition,
} from '@zapx/survey-schema';
import {
  analyzeSurvey,
  conjointAnalysis,
  conjointDesign,
  fromZapxXml,
  maxDiffDesign,
  maxDiffScores,
  renderQuestion,
  simulateSurvey,
  toZapxXml,
  validatePage,
} from './index.js';

const def = (() => {
  const p = parseSurveyDefinition({
    schemaVersion: 1,
    title: 'Choice',
    pages: [
      {
        id: 'P1',
        questions: [
          {
            id: 'MD',
            type: 'maxdiff',
            text: 'Which matters most and least when choosing a bank?',
            options: ['Fees', 'Branches', 'App', 'Rates', 'Service', 'Security', 'Rewards', 'Brand'].map((label, i) => ({
              code: i + 1,
              label,
            })),
            itemsPerSet: 4,
            sets: 6,
            versions: 5,
          },
        ],
      },
      {
        id: 'P2',
        questions: [
          {
            id: 'CBC',
            type: 'conjoint',
            text: 'Which plan would you choose?',
            attributes: [
              {
                id: 'price',
                label: 'Price',
                levels: [
                  { code: 1, label: '₹199' },
                  { code: 2, label: '₹299' },
                  { code: 3, label: '₹399' },
                ],
              },
              {
                id: 'data',
                label: 'Data',
                levels: [
                  { code: 1, label: '1 GB/day' },
                  { code: 2, label: '2 GB/day' },
                  { code: 3, label: 'Unlimited' },
                ],
              },
              {
                id: 'ott',
                label: 'Streaming',
                levels: [
                  { code: 1, label: 'None' },
                  { code: 2, label: 'Included' },
                ],
              },
            ],
            tasks: 8,
            conceptsPerTask: 3,
            versions: 10,
          },
        ],
      },
    ],
    settings: { capi: { gps: 'optional', geofences: [{ label: 'Ward 4', lat: 28.6, lon: 77.2, radiusM: 500 }], interruptions: false } },
  });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.definition as SurveyDefinition;
})();
const md = def.pages[0]!.questions[0] as MaxDiffQuestion;
const cbc = def.pages[1]!.questions[0] as ConjointQuestion;

describe('designs', () => {
  it('shows every MaxDiff item equally often, never twice in a set, and is deterministic', () => {
    const d = maxDiffDesign(md);
    expect(d).toHaveLength(5);
    for (const version of d) {
      const counts = new Map<number, number>();
      for (const set of version) {
        expect(new Set(set).size).toBe(4);
        for (const c of set) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      // 6 sets × 4 = 24 slots over 8 items: exactly 3 each.
      expect([...counts.values()]).toEqual(new Array(8).fill(3));
    }
    expect(maxDiffDesign({ ...md })).toEqual(d);
  });

  it('balances conjoint levels with minimal overlap and no duplicate concepts', () => {
    const d = conjointDesign(cbc);
    for (const version of d) {
      for (const task of version) {
        expect(new Set(task.map((c) => c.join(','))).size).toBe(3);
        // 3 concepts and 3 price levels: all different within the task.
        expect(new Set(task.map((c) => c[0])).size).toBe(3);
      }
      const price = version.flat().map((c) => c[0]);
      for (const l of [1, 2, 3]) expect(price.filter((x) => x === l)).toHaveLength(8);
    }
  });
});

describe('answers', () => {
  it('accepts only picks from the sets this respondent saw', () => {
    const r = renderQuestion(md, def, {}, 'resp-1');
    const sets = r.design!.sets!;
    const good: Record<string, number> = { v: r.design!.version };
    sets.forEach((s, i) => Object.assign(good, { [`b${i + 1}`]: s[0], [`w${i + 1}`]: s[1] }));
    expect(validatePage(def, def.pages[0]!, {}, { MD: good }).ok).toBe(true);
    const outside = md.options.map((o) => o.code).find((c) => !sets[0]!.includes(c))!;
    expect(validatePage(def, def.pages[0]!, {}, { MD: { ...good, b1: outside } }).ok).toBe(false);
    expect(validatePage(def, def.pages[0]!, {}, { MD: { ...good, w1: good.b1 } }).ok).toBe(false);
    expect(validatePage(def, def.pages[0]!, {}, { MD: { ...good, v: 99 } }).ok).toBe(false);
    const { b6: _, ...missing } = good;
    expect(validatePage(def, def.pages[0]!, {}, { MD: missing }).ok).toBe(false);
  });

  it('accepts a choice or none in every conjoint task', () => {
    const all = Object.fromEntries([['v', 3], ...Array.from({ length: 8 }, (_, i) => [`t${i + 1}`, i % 4])]);
    expect(validatePage(def, def.pages[1]!, {}, { CBC: all }).ok).toBe(true);
    expect(validatePage(def, def.pages[1]!, {}, { CBC: { ...all, t1: 4 } }).ok).toBe(false);
    expect(validatePage(def, def.pages[1]!, {}, { CBC: { ...all, t8: undefined } }).ok).toBe(false);
  });

  it('passes analysis, simulation and the XML round trip (with CAPI areas)', () => {
    expect(analyzeSurvey(def).issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(simulateSurvey(def, { respondents: 30, seed: 'c' }).outcomes.complete).toBe(30);
    const back = parseSurveyDefinition(fromZapxXml(toZapxXml(def)).definition);
    expect(back.ok && back.definition).toEqual(def);
  });
});

/** Respondents who choose by known utilities (with logit noise), to check the estimates recover them. */
function population(n: number) {
  let s = 7;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const mdTrue: Record<number, number> = { 1: 3, 2: -1, 3: 1.5, 4: 2, 5: 1, 6: 2.5, 7: -0.5, 8: -2 };
  const cjTrue = [
    { 1: 1, 2: 0, 3: -1 },
    { 1: -0.8, 2: 0.2, 3: 0.6 },
    { 1: -0.3, 2: 0.3 },
  ] as Array<Record<number, number>>;
  const gumbel = () => -Math.log(-Math.log(rand()));
  const out: Answers[] = [];
  for (let k = 0; k < n; k++) {
    const r = renderQuestion(md, def, {}, `p${k}`);
    const a: Record<string, number> = { v: r.design!.version };
    r.design!.sets!.forEach((set, i) => {
      const u = set.map((c) => mdTrue[c]! + gumbel());
      a[`b${i + 1}`] = set[u.indexOf(Math.max(...u))]!;
      const v = set.map((c) => -mdTrue[c]! + gumbel());
      let w = set[v.indexOf(Math.max(...v))]!;
      if (w === a[`b${i + 1}`]) w = set.filter((c) => c !== w)[0]!;
      a[`w${i + 1}`] = w;
    });
    const c = renderQuestion(cbc, def, {}, `p${k}`);
    const t: Record<string, number> = { v: c.design!.version };
    c.design!.tasks!.forEach((task, i) => {
      const u = task.map((concept) => concept.reduce((sum, code, ai) => sum + cjTrue[ai]![code]!, 0) + gumbel());
      u.push(-0.5 + gumbel()); // none
      const best = u.indexOf(Math.max(...u));
      t[`t${i + 1}`] = best === task.length ? 0 : best + 1;
    });
    out.push({ MD: a, CBC: t });
  }
  return out;
}

describe('estimation', () => {
  const people = population(400);
  it('ranks MaxDiff items by counting scores', () => {
    const r = maxDiffScores(md, people);
    expect(r.respondents).toBe(400);
    expect(r.items.map((i) => i.label).slice(0, 3)).toEqual(['Fees', 'Security', 'Rates']);
    expect(r.items.at(-1)!.label).toBe('Brand');
    expect(r.items[0]!.score).toBeGreaterThan(0.5);
  });

  it('recovers conjoint part-worths and importances', () => {
    const r = conjointAnalysis(cbc, people);
    expect(r.converged).toBe(true);
    expect(r.choices).toBe(3200);
    const pw = (a: number, l: number) => r.attributes[a]!.levels[l]!.partWorth;
    expect(pw(0, 0)).toBeCloseTo(1, 0);
    expect(pw(0, 2)).toBeCloseTo(-1, 0);
    expect(pw(1, 2)).toBeGreaterThan(pw(1, 1));
    expect(pw(2, 1)).toBeCloseTo(0.3, 0);
    const imp = r.attributes.map((a) => a.importance);
    expect(imp[0]).toBeGreaterThan(imp[1]!);
    expect(imp[1]).toBeGreaterThan(imp[2]!);
    expect(imp.reduce((x, y) => x + y, 0)).toBeCloseTo(100, 1);
    expect(r.pseudoR2).toBeGreaterThan(0.1);
  });
});
