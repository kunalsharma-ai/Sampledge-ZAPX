import { describe, expect, it } from 'vitest';
import {
  qaTestCaseSchema,
  surveyDefinitionSchema,
  urlVariableAnswers,
  type SurveyDefinition,
  type SurveyDefinitionInput,
} from '@zapx/survey-schema';
import {
  analyzeSurvey,
  compileSurvey,
  computeVariables,
  conditionHolds,
  localizeDefinition,
  nextPageIndex,
  pageOrder,
  pipeText,
  prevPageIndex,
  renderQuestion,
  replayInterview,
  rewriteVariables,
  simulateSurvey,
  textKeys,
  traceExpression,
  traceRoute,
  dependencyGraph,
  validatePage,
  checkFlow,
  exposureKey,
  fromZapxXml,
  leastFillSeed,
  pickedPages,
  toZapxXml,
  runTestCase,
  runTestSuite,
} from './index.js';

const make = (d: Partial<SurveyDefinitionInput>): SurveyDefinition =>
  surveyDefinitionSchema.parse({ schemaVersion: 1, title: 'T', pages: [], ...d });

const brands = [
  { code: 1, label: 'Acme' },
  { code: 2, label: 'Globex' },
  { code: 3, label: 'Initech' },
];

describe('rewriteVariables', () => {
  it('renames variables but not functions, keywords, strings or members', () => {
    const out = rewriteVariables("selected(Q1, 2) and Q2.r1 >= 3 and not answered(Q3) or Q1 == 'Q1'", (n) =>
      n === 'Q1' ? 'Q1_7' : n === 'Q2' ? 'Q2_7' : undefined,
    );
    expect(out).toBe("selected(Q1_7, 2) and Q2_7.r1 >= 3 and not answered(Q3) or Q1_7 == 'Q1'");
  });
});

describe('loops', () => {
  const def = make({
    pages: [
      { id: 'P1', questions: [{ id: 'AWARE', type: 'multi', text: 'Which brands do you know?', options: brands }] },
      { id: 'L1', questions: [{ id: 'RATE', type: 'scale', text: 'How do you rate {{BRAND}}?', min: 1, max: 5 }] },
      { id: 'L2', questions: [{ id: 'WHY', type: 'open', text: 'Why {{RATE}} for {{BRAND}}?', condition: 'RATE <= 2 and BRAND > 0' }] },
      { id: 'END', questions: [{ id: 'FINAL', type: 'open', text: 'Anything else?', required: false }] },
    ],
    loops: [{ id: 'BRAND', pages: ['L1', 'L2'], source: 'AWARE' }],
  });

  it('expands the pages per item with suffixed variables, piping and gating', () => {
    const c = compileSurvey(def);
    expect(c.pages.map((p) => p.id)).toEqual(['P1', 'L1_1', 'L2_1', 'L1_2', 'L2_2', 'L1_3', 'L2_3', 'END']);
    const [rate, why] = [c.pages[3]!, c.pages[4]!];
    expect(rate.condition).toBe('selected(AWARE, 2)');
    expect(rate.questions[0]!.id).toBe('RATE_2');
    expect(rate.questions[0]!.text).toBe('How do you rate Globex?');
    expect(why.questions[0]!.text).toBe('Why {{RATE_2}} for Globex?');
    expect(why.questions[0]!.condition).toBe('RATE_2 <= 2 and 2 > 0');
    expect(c.loops).toEqual([]);
    expect(compileSurvey(c)).toBe(c);
  });

  it('only asks the passes for chosen items and passes the logic check', () => {
    const c = compileSurvey(def);
    const answers = { AWARE: [1, 3] };
    expect(nextPageIndex(c, answers, 0)).toBe(1);
    expect(nextPageIndex(c, { ...answers, RATE_1: 1 }, 1)).toBe(2);
    expect(nextPageIndex(c, { ...answers, RATE_1: 5 }, 1)).toBe(5);
    expect(analyzeSurvey(def).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags broken loops', () => {
    const bad = make({ ...def, loops: [{ id: 'BRAND', pages: ['L1', 'NOPE'], source: 'AWARE' }] });
    expect(analyzeSurvey(bad).issues.some((i) => i.code === 'FLOW' && /NOPE/.test(i.message))).toBe(true);
    const late = make({ ...def, loops: [{ id: 'BRAND', pages: ['P1'], source: 'AWARE' }] });
    const gap = make({ ...def, loops: [{ id: 'BRAND', pages: ['L1', 'END'], source: 'AWARE' }] });
    expect(analyzeSurvey(gap).issues.some((i) => /follow one another/.test(i.message))).toBe(true);
    expect(analyzeSurvey(late).issues.some((i) => i.code === 'FLOW' && /before the loop/.test(i.message))).toBe(true);
  });

  it('loops over a fixed list and translates item labels', () => {
    const fixed = make({
      pages: [
        {
          id: 'L',
          questions: [
            {
              id: 'USE',
              type: 'single',
              text: 'Do you use {{TOOL}}?',
              options: [
                { code: 1, label: 'Yes' },
                { code: 2, label: 'No' },
              ],
            },
          ],
        },
      ],
      loops: [
        {
          id: 'TOOL',
          pages: ['L'],
          items: [
            { code: 10, label: 'Email' },
            { code: 20, label: 'Chat' },
          ],
        },
      ],
    });
    expect(compileSurvey(fixed).pages.map((p) => p.questions[0]!.id)).toEqual(['USE_10', 'USE_20']);
    expect(textKeys(fixed).some((k) => k.key === 'loop.TOOL.item.20')).toBe(true);
    const fr = localizeDefinition(fixed, {
      tag: 'fr',
      name: 'Français',
      enabled: true,
      texts: { 'loop.TOOL.item.20': { text: 'Messagerie', source: 'Chat', status: 'reviewed' } },
    });
    expect(compileSurvey(fr).pages[1]!.questions[0]!.text).toBe('Do you use Messagerie?');
  });

  it('replays a looped CAPI interview on the server', () => {
    const r = replayInterview(def, { AWARE: [2], RATE_2: 1, WHY_2: 'Too expensive' });
    expect(r.outcome).toBe('complete');
    expect(r.answers.RATE_2).toBe(1);
  });
});

describe('randomized blocks', () => {
  const page = (id: string) => ({ id, questions: [{ id: `Q${id}`, type: 'single' as const, text: id, options: brands }] });
  const def = make({
    pages: [page('A'), page('B'), page('C'), page('D'), page('E')],
    blocks: [{ id: 'CONCEPTS', pages: ['B', 'C', 'D'], randomize: true }],
  });

  it('keeps pages outside the block in place and is stable per seed', () => {
    const o = pageOrder(def, 'resp-1');
    expect(o[0]).toBe(0);
    expect(o[4]).toBe(4);
    expect([...o.slice(1, 4)].sort()).toEqual([1, 2, 3]);
    expect(pageOrder(def, 'resp-1')).toEqual(o);
  });

  it('shows each page first about equally often', () => {
    const firsts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) firsts[pageOrder(def, `r${i}`)[1]! - 1]! += 1;
    for (const n of firsts) expect(Math.abs(n - 1000)).toBeLessThan(120);
  });

  it('walks the respondent order forwards and back, and pick shows a subset', () => {
    const o = pageOrder(def, 's');
    expect(nextPageIndex(def, {}, o[1]!, 's')).toBe(o[2]);
    expect(prevPageIndex(def, {}, o[2]!, 's')).toBe(o[1]);
    const picked = make({ ...def, blocks: [{ id: 'CONCEPTS', pages: ['B', 'C', 'D'], randomize: true, pick: 2 }] });
    expect(pageOrder(picked, 'x')).toHaveLength(4);
    const report = simulateSurvey(picked, { respondents: 60, seed: 'blocks' });
    expect(report.outcomes.complete).toBe(60);
  });

  it('warns when a block page depends on another page of the block', () => {
    const dep = make({
      pages: [page('A'), page('B'), { ...page('C'), condition: 'QB == 1' }],
      blocks: [{ id: 'BL', pages: ['B', 'C'] }],
    });
    expect(analyzeSurvey(dep).issues.some((i) => i.code === 'BLOCK_ORDER')).toBe(true);
  });
});

describe('calculated variables', () => {
  const def = make({
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'AGE', type: 'numeric', text: 'Age?' },
          { id: 'KIDS', type: 'numeric', text: 'Children?' },
        ],
      },
      {
        id: 'P2',
        condition: 'FAMILY',
        questions: [{ id: 'SCHOOL', type: 'open', text: 'You are {{AGE}} with {{HH}} people at home. Which school?' }],
      },
    ],
    variables: [
      { id: 'HH', expr: 'KIDS + 2', label: 'Household size' },
      { id: 'FAMILY', expr: 'HH >= 3 and AGE < 60' },
    ],
    quotas: [{ id: 'FAM', condition: 'FAMILY', target: 10 }],
  });

  it('are computed from answers and usable in logic, piping and quotas', () => {
    const answers = { AGE: 40, KIDS: 2 };
    expect(computeVariables(def, answers)).toEqual({ HH: 4, FAMILY: true });
    expect(conditionHolds('FAMILY', def, answers)).toBe(true);
    expect(nextPageIndex(def, { AGE: 40, KIDS: 0 }, 0)).toBe(-1);
    expect(pipeText(def.pages[1]!.questions[0]!.text, def, answers)).toBe('You are 40 with 4 people at home. Which school?');
    expect(analyzeSurvey(def).ok).toBe(true);
  });

  it('must be defined before they are used', () => {
    const bad = make({
      ...def,
      variables: [
        { id: 'FAMILY', expr: 'HH >= 3' },
        { id: 'HH', expr: 'KIDS + 2' },
      ],
    });
    expect(analyzeSurvey(bad).issues.some((i) => i.code === 'FORWARD_REFERENCE' && /defined after/.test(i.message))).toBe(true);
    const clash = make({ ...def, variables: [{ id: 'AGE', expr: '1' }] });
    expect(analyzeSurvey(clash).ok).toBe(false);
  });
});

describe('dynamic answer lists', () => {
  const def = make({
    pages: [
      { id: 'P1', questions: [{ id: 'AWARE', type: 'multi', text: 'Known brands', options: brands }] },
      {
        id: 'P2',
        questions: [
          {
            id: 'BEST',
            type: 'single',
            text: 'Which is best?',
            options: [...brands, { code: 99, label: 'None of these' }],
            optionsFrom: { question: 'AWARE' },
          },
          {
            id: 'UNKNOWN',
            type: 'multi',
            text: 'Heard of these?',
            options: brands,
            optionsFrom: { question: 'AWARE', include: 'not_selected' },
          },
        ],
      },
    ],
  });

  it('offer only chosen (or not chosen) options and keep extra options', () => {
    const answers = { AWARE: [1, 3] };
    const best = renderQuestion(def.pages[1]!.questions[0]!, def, answers, 's');
    expect('options' in best && best.options.map((o) => o.code)).toEqual([1, 3, 99]);
    expect(validatePage(def, def.pages[1]!, answers, { BEST: 2, UNKNOWN: [2] }).errors[0]?.questionId).toBe('BEST');
    const ok = validatePage(def, def.pages[1]!, answers, { BEST: 3, UNKNOWN: [2] });
    expect(ok.ok).toBe(true);
  });

  it('skip the question when nothing is left', () => {
    const r = validatePage(def, def.pages[1]!, { AWARE: [1, 2, 3] }, { BEST: 1 });
    expect(r.ok).toBe(true);
    expect(r.answers.UNKNOWN).toBeNull();
  });

  it('are checked: source must exist and come first', () => {
    expect(analyzeSurvey(def).ok).toBe(true);
    const bad = make({ pages: [{ ...def.pages[1]! }, def.pages[0]!] });
    expect(analyzeSurvey(bad).issues.some((i) => i.code === 'FORWARD_REFERENCE')).toBe(true);
  });
});

describe('card sort and image hot-spot', () => {
  const def = make({
    pages: [
      {
        id: 'P1',
        questions: [
          {
            id: 'SORT',
            type: 'cardsort',
            text: 'Sort the features',
            options: [
              { code: 1, label: 'Price' },
              { code: 2, label: 'Speed' },
              { code: 3, label: 'Support' },
            ],
            groups: [
              { code: 1, label: 'Must have' },
              { code: 2, label: 'Nice to have' },
            ],
          },
          {
            id: 'SPOT',
            type: 'hotspot',
            text: 'What catches your eye?',
            image: 'img_0123456789',
            imageAlt: 'Pack front',
            regions: [
              { code: 1, label: 'Logo', x: 0, y: 0, w: 50, h: 20 },
              { code: 2, label: 'Claim', x: 0, y: 40, w: 100, h: 20 },
            ],
            maxSelected: 1,
          },
        ],
      },
      { id: 'P2', condition: 'SORT.1 == 1 and selected(SPOT, 2)', questions: [{ id: 'WHY', type: 'open', text: 'Why?' }] },
    ],
  });

  it('validate answers and work in logic', () => {
    const page = def.pages[0]!;
    expect(validatePage(def, page, {}, { SORT: { 1: 1, 2: 2 }, SPOT: [2] }).errors[0]?.questionId).toBe('SORT');
    expect(validatePage(def, page, {}, { SORT: { 1: 1, 2: 2, 3: 9 }, SPOT: [2] }).ok).toBe(false);
    expect(validatePage(def, page, {}, { SORT: { 1: 1, 2: 2, 3: 1 }, SPOT: [1, 2] }).errors[0]?.questionId).toBe('SPOT');
    const ok = validatePage(def, page, {}, { SORT: { 1: 1, 2: 2, 3: 1 }, SPOT: ['2'] });
    expect(ok.ok).toBe(true);
    expect(ok.answers.SPOT).toEqual([2]);
    expect(nextPageIndex(def, ok.answers, 0)).toBe(1);
    expect(analyzeSurvey(def).ok).toBe(true);
  });

  it('are covered by the QA lab', () => {
    const report = simulateSurvey(def, { respondents: 80, seed: 'cs' });
    expect(report.outcomes.complete).toBe(80);
    expect(report.items.filter((i) => i.id.startsWith('SPOT=')).every((i) => i.hits > 0)).toBe(true);
  });
});

describe('programmer tools', () => {
  const def = make({
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'AGE', type: 'numeric', text: 'Age?' },
          { id: 'KIDS', type: 'numeric', text: 'Kids?' },
        ],
      },
      { id: 'P2', condition: 'FAMILY', questions: [{ id: 'WHY', type: 'open', text: 'Why, at {{AGE}}?' }] },
    ],
    variables: [{ id: 'FAMILY', expr: 'KIDS > 0 and AGE < 60' }],
    terminations: [{ id: 'T1', condition: 'AGE < 18' }],
  });

  it('traces an expression and its inputs', () => {
    const t = traceExpression(def, 'FAMILY and AGE >= 30', { AGE: 40, KIDS: 2 });
    expect(t).toMatchObject({ ok: true, value: true, truthy: true });
    expect(t.inputs).toEqual([
      { name: 'FAMILY', value: true, known: true },
      { name: 'AGE', value: 40, known: true },
    ]);
    expect(traceExpression(def, 'AGE >', {}).error?.message).toBeTruthy();
    expect(traceExpression(def, 'NOPE == 1', {}).inputs[0]!.known).toBe(false);
  });

  it('explains the route', () => {
    const r = traceRoute(def, { AGE: 40, KIDS: 0 });
    expect(r.steps[1]).toMatchObject({ pageId: 'P2', shown: false, reason: 'condition FAMILY is false' });
    expect(traceRoute(def, { AGE: 12, KIDS: 1 }).ending).toBe('terminate by T1');
  });

  it('maps dependencies both ways', () => {
    const g = dependencyGraph(def);
    const age = g.find((n) => n.id === 'AGE')!;
    expect(age.usedBy.map((u) => u.location)).toEqual(['WHY', 'variable FAMILY', 'termination T1']);
    expect(g.find((n) => n.id === 'FAMILY')!).toMatchObject({
      uses: ['KIDS', 'AGE'],
      usedBy: [{ location: 'page P2', what: 'page condition' }],
    });
  });
});

describe('blueprint phase 2: URL variables and least-fill blocks', () => {
  const base = {
    schemaVersion: 1,
    title: 'P2',
    pages: [
      { id: 'S', questions: [{ id: 'AGE', type: 'numeric', text: 'Age?', min: 0, max: 99 }] },
      { id: 'C1', questions: [{ id: 'A1', type: 'open', text: 'Concept 1?' }] },
      { id: 'C2', questions: [{ id: 'A2', type: 'open', text: 'Concept 2?' }] },
      { id: 'C3', questions: [{ id: 'A3', type: 'open', text: 'Concept 3?' }] },
      { id: 'E', condition: 'SEG == "B2B" and SCORE > 5', questions: [{ id: 'END', type: 'info', text: 'Thanks' }] },
    ],
    urlVariables: [
      { id: 'SEG', param: 'seg' },
      { id: 'SCORE', param: 'score', numeric: true },
    ],
    blocks: [{ id: 'CON', pages: ['C1', 'C2', 'C3'], pick: 1, balance: 'least_fill' }],
  };
  const def = surveyDefinitionSchema.parse(base);

  it('reads link parameters into answers usable in logic', () => {
    const a = urlVariableAnswers(def, { seg: 'B2B', score: '7', other: 'x' });
    expect(a).toEqual({ SEG: 'B2B', SCORE: 7 });
    expect(urlVariableAnswers(def, { score: 'abc' })).toEqual({});
    expect(conditionHolds('SEG == "B2B" and SCORE > 5', def, a)).toBe(true);
    expect(analyzeSurvey(def).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects reserved or repeated parameters and clashing names', () => {
    const bad = surveyDefinitionSchema.parse({
      ...base,
      urlVariables: [
        { id: 'AGE', param: 'age' },
        { id: 'U1', param: 'uid' },
        { id: 'U2', param: 'seg' },
        { id: 'U3', param: 'seg' },
      ],
    });
    const messages = checkFlow(bad).map((i) => i.message);
    expect(messages).toEqual([
      expect.stringContaining('"AGE" is used more than once'),
      expect.stringContaining('"uid" is used by SampCode'),
      expect.stringContaining('"seg" is read twice'),
    ]);
  });

  it('least fill picks the pages shown least so far', () => {
    const exposure: Record<string, number> = {};
    const shown: Record<string, number> = { C1: 0, C2: 0, C3: 0 };
    for (let i = 0; i < 30; i++) {
      const seed = leastFillSeed(def, `r${i}`, exposure);
      for (const p of pickedPages(def, seed).CON!) {
        exposure[exposureKey('CON', p)] = (exposure[exposureKey('CON', p)] ?? 0) + 1;
        shown[p]!++;
      }
    }
    expect(shown).toEqual({ C1: 10, C2: 10, C3: 10 });
  });

  it('round-trips through SampCode XML', () => {
    const back = fromZapxXml(toZapxXml(def));
    expect(back.warnings).toEqual([]);
    expect(surveyDefinitionSchema.parse(back.definition)).toEqual(def);
  });
});

describe('blueprint phase 2: saved QA test cases', () => {
  const def = surveyDefinitionSchema.parse({
    schemaVersion: 1,
    title: 'Cases',
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'AGE', type: 'numeric', text: 'Age?', min: 0, max: 99 },
          {
            id: 'KIDS',
            type: 'single',
            text: 'Kids?',
            options: [
              { code: 1, label: 'Yes' },
              { code: 2, label: 'No' },
            ],
          },
        ],
      },
      { id: 'P2', condition: 'KIDS == 1', questions: [{ id: 'NKIDS', type: 'numeric', text: 'How many?', min: 1, max: 10 }] },
      {
        id: 'P3',
        questions: [
          { id: 'NOTE', type: 'open', text: 'Anything else?', condition: 'AGE > 60' },
          { id: 'END', type: 'info', text: 'Bye' },
        ],
      },
    ],
    variables: [{ id: 'SENIOR', expr: 'AGE >= 65' }],
    terminations: [{ id: 'T_MINOR', condition: 'AGE < 18', status: 'terminate' }],
    quotas: [{ id: 'Q_PARENT', condition: 'KIDS == 1', target: 10 }],
  });

  it('passes when the logic does what the case expects', () => {
    const r = runTestCase(
      def,
      qaTestCaseSchema.parse({
        name: 'Senior parent',
        answers: { AGE: 70, KIDS: 1, NKIDS: 2 },
        expect: { outcome: 'complete', shows: ['P2', 'NOTE'], variables: { SENIOR: true }, quotas: ['Q_PARENT'] },
      }),
    );
    expect(r.checks.filter((c) => !c.passed)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.pages).toEqual(['P1', 'P2', 'P3']);
  });

  it('fails with what actually happened, and catches renamed ids', () => {
    const suite = runTestSuite(def, [
      qaTestCaseSchema.parse({
        name: 'Minor',
        answers: { AGE: 15, KIDS: 2 },
        expect: { outcome: 'terminate:T_MINOR', skips: ['P2', 'NOTE'] },
      }),
      qaTestCaseSchema.parse({
        name: 'Wrong',
        answers: { AGE: 30, KIDS: 2 },
        expect: { outcome: 'terminate', shows: ['P2', 'GONE'], variables: { SENIOR: true }, quotas: ['Q_PARENT'] },
      }),
    ]);
    expect(suite).toMatchObject({ passed: 1, failed: 1 });
    expect(suite.results[1]!.checks.filter((c) => !c.passed).map((c) => c.actual)).toEqual([
      'skipped',
      'GONE is not in the survey',
      'complete',
      'false',
      'no quota',
    ]);
  });
});
