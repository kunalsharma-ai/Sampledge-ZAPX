/**
 * Blueprint phase 4 over the API: MaxDiff and conjoint estimation, design download, recodes and
 * calculated variables with lineage in analysis and exports, and the research assistant (a fake
 * provider: tables are computed by SampCode, findings without a real table citation are dropped).
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conjointTasksFor, maxDiffSetsFor } from '@zapx/logic-engine';
import { parseSurveyDefinition, type ConjointQuestion, type MaxDiffQuestion } from '@zapx/survey-schema';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { AiProvider, type InsightsRequest, type InsightsResult } from '../src/ai/ai-provider';
import { checkCapture } from '../src/captures/capture.service';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `bp4${Date.now().toString(36)}`;

class FakeAnalyst extends AiProvider {
  readonly configured = true;
  readonly model = 'fake-analyst';
  requests: InsightsRequest[] = [];
  architect(): Promise<never> {
    throw new Error('not used');
  }
  translate(): Promise<never> {
    throw new Error('not used');
  }
  async insights(req: InsightsRequest): Promise<InsightsResult> {
    this.requests.push(req);
    return {
      model: this.model,
      answer: 'Older respondents are more aware of brand 2.',
      findings: [
        { statement: 'Everyone aged 35 plus is aware of brand 2.', tables: [req.tables[0]!.id] },
        { statement: 'Made-up claim without a table.', tables: [] },
        { statement: 'Claim citing a table that was not sent.', tables: ['T99'] },
      ],
      caveats: ['Small sample.'],
    };
  }
}

const fake = new FakeAnalyst();
let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let surveyId: string;

const def = {
  ...demo,
  pages: [
    ...demo.pages,
    {
      id: 'P5',
      questions: [
        {
          id: 'MD',
          type: 'maxdiff',
          text: 'Most and least important?',
          options: ['Price', 'Taste', 'Brand', 'Pack', 'Health'].map((label, i) => ({ code: i + 1, label })),
          itemsPerSet: 3,
          sets: 5,
          versions: 3,
        },
        {
          id: 'CBC',
          type: 'conjoint',
          text: 'Which would you buy?',
          attributes: [
            {
              id: 'price',
              label: 'Price',
              levels: [
                { code: 1, label: '$1' },
                { code: 2, label: '$2' },
              ],
            },
            {
              id: 'size',
              label: 'Size',
              levels: [
                { code: 1, label: 'Small' },
                { code: 2, label: 'Large' },
              ],
            },
          ],
          tasks: 4,
          conceptsPerTask: 2,
          versions: 3,
        },
      ],
    },
  ],
  variables: [{ id: 'OLDER', label: 'Aged 35+', expr: 'AGE >= 35' }],
  recodes: [
    {
      id: 'AGEGRP',
      label: 'Age group',
      source: 'AGE',
      groups: [
        { code: 1, label: 'Under 35', max: 34 },
        { code: 2, label: '35 plus', min: 35 },
      ],
    },
    {
      id: 'OLDGRP',
      label: 'Older (recode)',
      source: 'OLDER',
      groups: [{ code: 1, label: 'Older', values: [1] }],
      otherwise: { code: 0, label: 'Younger' },
    },
  ],
};

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiProvider)
    .useValue(fake)
    .compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  const pid = (await http.post('/api/projects').set(admin).send({ name: 'P4' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${pid}/surveys`).set(admin).send({ name: 'Choice' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition: def }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);

  const parsed = parseSurveyDefinition(def);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const qs = parsed.definition.pages[4]!.questions;
  const md = qs[0] as MaxDiffQuestion;
  const cbc = qs[1] as ConjointQuestion;
  const survey = await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } });
  const rows = [];
  // 40 people. Everyone picks Price (1) as most important whenever shown, Pack (4) as least; and
  // always the $1 concept in conjoint (or the first concept when both cost the same).
  for (let i = 0; i < 40; i++) {
    const uid = `r-${i}`;
    const m = maxDiffSetsFor(md, uid);
    const mdAns: Record<string, number> = { v: m.version };
    m.sets.forEach((set, k) => {
      const best = set.includes(1) ? 1 : set.find((c) => c !== 4)!;
      const worst = set.includes(4) && best !== 4 ? 4 : set.find((c) => c !== best)!;
      mdAns[`b${k + 1}`] = best;
      mdAns[`w${k + 1}`] = worst;
    });
    const c = conjointTasksFor(cbc, uid);
    const cbcAns: Record<string, number> = { v: c.version };
    c.tasks.forEach((task, k) => {
      const cheap = task.findIndex((concept) => concept[0] === 1);
      cbcAns[`t${k + 1}`] = (cheap < 0 ? 0 : cheap) + 1;
    });
    rows.push({
      tenantId: survey.tenantId,
      surveyId,
      versionId: survey.liveVersionId!,
      uid,
      status: 'COMPLETE' as const,
      sessionTokenHash: `${run}-${uid}`,
      answers: { AGE: i < 20 ? 25 : 50, GENDER: 1 + (i % 2), AWARE: i < 20 ? [1] : [2], MD: mdAns, CBC: cbcAns },
    });
  }
  await prisma.response.createMany({ data: rows });
});

afterAll(async () => {
  await app?.close();
});

describe('choice modelling', () => {
  it('scores MaxDiff items by counting', async () => {
    const r = (await http.post(`/api/surveys/${surveyId}/analysis/choice/MD`).set(admin).send({}).expect(200)).body;
    expect(r.type).toBe('maxdiff');
    expect(r.result.respondents).toBe(40);
    expect(r.result.items[0]).toMatchObject({ label: 'Price', score: 1 });
    expect(r.result.items.at(-1)).toMatchObject({ label: 'Pack', score: -1 });
  });

  it('estimates conjoint part-worths with price the most important attribute', async () => {
    const r = (await http.post(`/api/surveys/${surveyId}/analysis/choice/CBC`).set(admin).send({}).expect(200)).body;
    expect(r.type).toBe('conjoint');
    expect(r.result.choices).toBe(160);
    const [price, size] = r.result.attributes;
    expect(price.levels[0].partWorth).toBeGreaterThan(price.levels[1].partWorth);
    expect(price.importance).toBeGreaterThan(size.importance);
    await http.post(`/api/surveys/${surveyId}/analysis/choice/AGE`).set(admin).send({}).expect(400);
  });

  it('downloads the design as CSV', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/analysis/choice/CBC/design.csv`).set(admin).expect(200)).text;
    expect(csv.split('\n')[0]).toContain('version');
    expect(csv.trim().split('\n').length).toBe(1 + 3 * 4 * 2);
  });
});

describe('derived variables', () => {
  it('lists recodes and calculated variables with lineage', async () => {
    const body = (await http.get(`/api/surveys/${surveyId}/analysis/variables`).set(admin).expect(200)).body;
    const v = (id: string) => body.variables.find((x: { id: string }) => x.id === id);
    expect(v('AGEGRP')).toMatchObject({ source: 'derived', lineage: ['AGE'], derivation: { kind: 'recode', from: 'AGE' } });
    expect(v('OLDER')).toMatchObject({ kind: 'single', lineage: ['AGE'], derivation: { kind: 'calculated', expr: 'AGE >= 35' } });
    expect(v('OLDGRP').lineage).toEqual(['OLDER', 'AGE']);
    expect(body.recodeProblems).toEqual([]);
  });

  it('tabulates recodes in frequencies and crosstabs', async () => {
    const f = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(admin)
        .send({ variables: ['AGEGRP', 'OLDGRP'] })
        .expect(200)
    ).body;
    expect(f.frequencies[0].rows.map((r: { count: number }) => r.count)).toEqual([20, 20]);
    expect(f.frequencies[1].rows.map((r: { label: string; count: number }) => [r.label, r.count])).toEqual([
      ['Older', 20],
      ['Younger', 20],
    ]);
    const x = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/crosstab`)
        .set(admin)
        .send({ banner: 'AGEGRP', stubs: ['AWARE'] })
        .expect(200)
    ).body;
    const brand2 = x.tables[0].rows.find((r: { code: number }) => r.code === 2);
    expect(brand2.cells.map((c: { pct: number }) => c.pct)).toEqual([50, 0, 100]);
  });

  it('exports recodes as columns', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(admin).expect(200)).text;
    const [head, ...lines] = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r\n/);
    const cols = head!.split(',');
    const i = cols.indexOf('AGEGRP');
    expect(i).toBeGreaterThan(-1);
    expect(new Set(lines.map((l) => l.split(',')[i]))).toEqual(new Set(['1', '2']));
    expect(cols).toEqual(expect.arrayContaining(['MD_v', 'MD_b1', 'MD_w1', 'CBC_t1']));
  });
});

describe('research assistant', () => {
  it('shows the computed tables it will send', async () => {
    const r = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/assistant/tables`)
        .set(admin)
        .send({ banner: 'AGEGRP', variables: ['AWARE'] })
        .expect(200)
    ).body;
    expect(r.tables).toHaveLength(1);
    expect(r.tables[0]).toMatchObject({ id: 'T1', variable: 'AWARE' });
    expect(r.tables[0].text).toContain('[LOW BASE]');
  });

  it('answers from the tables and drops findings without a real citation', async () => {
    const r = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/assistant`)
        .set(admin)
        .send({ question: 'Who knows brand 2? Email me at kunal@example.com', banner: 'AGEGRP', variables: ['AWARE'] })
        .expect(200)
    ).body;
    expect(r.findings).toEqual([{ statement: 'Everyone aged 35 plus is aware of brand 2.', tables: ['T1'] }]);
    expect(r.caveats).toEqual(
      expect.arrayContaining(['Small sample.', '2 statements that did not cite a table were left out.', 'Unweighted data.']),
    );
    expect(r.model).toBe('fake-analyst');
    const sent = fake.requests.at(-1)!;
    expect(sent.question).not.toContain('kunal@example.com');
    expect(sent.tables[0]!.text).toContain('100%');
    // Open answers are never tabulated for the assistant.
    await http
      .post(`/api/surveys/${surveyId}/analysis/assistant`)
      .set(admin)
      .send({ question: 'x?', variables: ['NOPE'] })
      .expect(400);
    const usage = await prisma.aiUsage.findMany({ where: { surveyId, task: 'insights' } });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage[0]!.redactions).toBe(1);
  });
});

describe('consented CAPI video', () => {
  const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 5)]);
  it('keeps a recording as video only when the survey records video', () => {
    expect(checkCapture('audio', WEBM)).toBe('audio/webm');
    expect(checkCapture('audio', WEBM, { video: true })).toBe('video/webm');
    expect(() => checkCapture('photo', WEBM, { video: true })).toThrow();
  });

  it('round-trips the video setting with the survey', async () => {
    const d = (await http.get(`/api/surveys/${surveyId}/draft`).set(admin).expect(200)).body.version;
    const next = {
      ...d.definition,
      settings: { ...d.definition.settings, capi: { ...d.definition.settings.capi, audio: 'consent', video: true } },
    };
    await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition: next }).expect(200);
    const back = (await http.get(`/api/surveys/${surveyId}/draft`).set(admin).expect(200)).body.version.definition;
    expect(back.settings.capi).toMatchObject({ audio: 'consent', video: true });
  });
});

describe('least-fill quota groups', () => {
  let sid: string;
  let vendorId: string;
  const counts = async () =>
    Object.fromEntries(
      ((await http.get(`/api/surveys/${sid}/quotas`).set(admin).expect(200)).body as Array<{ id: string; count: number }>).map((q) => [
        q.id,
        q.count,
      ]),
    );

  beforeAll(async () => {
    const pid = (await http.post('/api/projects').set(admin).send({ name: 'Quota groups' }).expect(201)).body.id;
    sid = (await http.post(`/api/projects/${pid}/surveys`).set(admin).send({ name: 'Brands' }).expect(201)).body.id;
    const brands = {
      schemaVersion: 1,
      title: 'Brands',
      pages: [
        {
          id: 'P1',
          questions: [
            { id: 'AWARE', type: 'multi', text: 'Which brands?', options: [1, 2, 3].map((code) => ({ code, label: `Brand ${code}` })) },
          ],
        },
      ],
      quotas: [
        ...[1, 2, 3].map((b) => ({ id: `QB${b}`, condition: `selected(AWARE, ${b})`, target: 2, group: 'BRAND' })),
        { id: 'QALL', condition: 'true', target: 100 },
      ],
    };
    await http.put(`/api/surveys/${sid}/draft`).set(admin).send({ definition: brands }).expect(200);
    await http.post(`/api/surveys/${sid}/publish`).set(admin).expect(201);
    vendorId = (await http.post(`/api/projects/${pid}/vendors`).set(admin).send({ name: 'Panel', code: 'PNL' }).expect(201)).body.id;
  });

  async function respond(uid: string, aware: number[]) {
    const { url } = (await http.post(`/api/surveys/${sid}/links`).set(admin).send({ vendorId, uid }).expect(201)).body;
    const s = (
      await http
        .post(`/api/public/s/${sid}/start`)
        .send({ query: Object.fromEntries(new URL(url).searchParams) })
        .expect(200)
    ).body;
    const st = (
      await http
        .post(`/api/public/r/${s.token}/answers`)
        .send({ pageId: 'P1', answers: { AWARE: aware } })
        .expect(200)
    ).body;
    return st.status as string;
  }

  it('counts someone who matches several cells once, in the least filled cell', async () => {
    expect(await respond('a1', [1])).toBe('complete');
    expect(await respond('a2', [1, 2, 3])).toBe('complete');
    expect(await counts()).toMatchObject({ QB1: 1, QB2: 1, QB3: 0, QALL: 2 });
    expect(await respond('a3', [1, 2, 3])).toBe('complete');
    expect(await counts()).toMatchObject({ QB1: 1, QB2: 1, QB3: 1 });
    for (const uid of ['a4', 'a5', 'a6']) expect(await respond(uid, [1, 2, 3])).toBe('complete');
    expect(await counts()).toMatchObject({ QB1: 2, QB2: 2, QB3: 2, QALL: 6 });
  });

  it('is over quota only when every matching cell is full, and releases the cell it counted', async () => {
    expect(await respond('a7', [2, 3])).toBe('quota_full');
    const r = await prisma.response.findFirstOrThrow({ where: { surveyId: sid, uid: 'a1' } });
    expect(r.quotaCells).toEqual(['QB1', 'QALL']);
    await http
      .post(`/api/surveys/${sid}/quality/decisions`)
      .set(admin)
      .send({ responseIds: [r.id], decision: 'reject' })
      .expect(200);
    expect(await counts()).toMatchObject({ QB1: 1, QB2: 2, QB3: 2, QALL: 5 });
    expect(await respond('a8', [1, 2])).toBe('complete');
    expect((await prisma.response.findFirstOrThrow({ where: { surveyId: sid, uid: 'a8' } })).quotaCells).toEqual(['QB1', 'QALL']);
  });
});

describe('question bank blocks', () => {
  it('saves a page of questions as a block and refuses invalid blocks', async () => {
    const page = def.pages[0];
    const item = (
      await http
        .post('/api/library')
        .set(admin)
        .send({ kind: 'BLOCK', name: 'Screener block', category: 'Demographics', content: { pages: [page] } })
        .expect(201)
    ).body;
    expect(item.kind).toBe('BLOCK');
    const list = (await http.get('/api/library?kind=BLOCK').set(admin).expect(200)).body;
    expect(list.map((i: { id: string }) => i.id)).toEqual([item.id]);
    expect(list[0].content.pages[0].questions.map((q: { id: string }) => q.id)).toEqual(['AGE', 'GENDER']);
    await http
      .post('/api/library')
      .set(admin)
      .send({ kind: 'BLOCK', name: 'Bad', content: { pages: [] } })
      .expect(400);
  });
});
