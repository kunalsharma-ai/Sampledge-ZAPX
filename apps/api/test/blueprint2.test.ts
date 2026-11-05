/**
 * Blueprint phase 2 over the API: glossary sent with AI translation, translation memory reused
 * across surveys, per-language QA.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AiProvider, type TranslateRequest, type TranslateResult } from '../src/ai/ai-provider';

process.env.ALLOW_SIGNUP = 'true';
const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `bp2${Date.now().toString(36)}`;

class FakeTranslator extends AiProvider {
  readonly configured = true;
  readonly model = 'fake-translator';
  requests: TranslateRequest[] = [];
  architect(): Promise<never> {
    throw new Error('not used');
  }
  async translate(req: TranslateRequest): Promise<TranslateResult> {
    this.requests.push(req);
    return { model: this.model, translations: Object.fromEntries(req.items.map((i) => [i.key, `FR ${i.text}`])) };
  }
}

const fake = new FakeTranslator();
let app: INestApplication;
let http: ReturnType<typeof request>;
let auth: Record<string, string>;
let other: Record<string, string>;
let projectId: string;

async function register(tag: string) {
  const res = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${tag} ${run}`, name: 'Prog', email: `${tag}-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  return { Authorization: `Bearer ${res.body.token}` };
}

async function surveyWithFrench(name: string) {
  const id = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name }).expect(201)).body.id as string;
  await http.put(`/api/surveys/${id}/draft`).set(auth).send({ definition: demo }).expect(200);
  const d = (await http.get(`/api/surveys/${id}/draft`).set(auth).expect(200)).body.version;
  await http
    .put(`/api/surveys/${id}/draft/presentation`)
    .set(auth)
    .send({ presentation: { ...d.presentation, languages: [{ tag: 'fr', name: 'Français' }] }, expectedUpdatedAt: d.updatedAt })
    .expect(200);
  return id;
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiProvider)
    .useValue(fake)
    .compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  auth = await register('a');
  other = await register('b');
  projectId = (await http.post('/api/projects').set(auth).send({ name: 'P2' }).expect(201)).body.id;
});

afterAll(async () => {
  await app?.close();
});

describe('glossary', () => {
  it('is per organization and per language, and replaces a term on save', async () => {
    await http.post('/api/glossary').set(auth).send({ language: 'fr', source: 'Brand A', target: 'Marque Alpha' }).expect(201);
    const t = (
      await http
        .post('/api/glossary')
        .set(auth)
        .send({ language: 'fr', source: 'Brand A', target: 'Marque A', note: 'Client name' })
        .expect(201)
    ).body;
    await http.post('/api/glossary').set(auth).send({ language: 'not a tag', source: 'x', target: 'y' }).expect(400);
    expect((await http.get('/api/glossary?language=fr').set(auth).expect(200)).body).toMatchObject([
      { source: 'Brand A', target: 'Marque A' },
    ]);
    expect((await http.get('/api/glossary').set(other).expect(200)).body).toEqual([]);
    await http.delete(`/api/glossary/${t.id}`).set(other).expect(404);
  });
});

describe('translation memory and QA', () => {
  let first: string;

  it('sends matching glossary terms with AI translation', async () => {
    first = await surveyWithFrench('Wave 1');
    await http.post(`/api/surveys/${first}/translate`).set(auth).send({ language: 'fr' }).expect(201);
    const sent = fake.requests.flatMap((r) => r.glossary ?? []);
    expect(sent).toContainEqual({ source: 'Brand A', target: 'Marque A', note: 'Client name' });
  });

  it('QA lists unreviewed texts as errors and glossary misses as warnings', async () => {
    const qa = (await http.get(`/api/surveys/${first}/translation-qa?language=fr`).set(auth).expect(200)).body;
    expect(qa.errors).toBeGreaterThan(0);
    expect(qa.issues.some((i: { kind: string }) => i.kind === 'unreviewed')).toBe(true);
    expect(qa.issues.find((i: { kind: string }) => i.kind === 'glossary')).toMatchObject({ severity: 'warning' });
    await http.get(`/api/surveys/${first}/translation-qa?language=de`).set(auth).expect(404);
  });

  it('reuses only reviewed translations in another survey', async () => {
    const second = await surveyWithFrench('Wave 2');
    let r = (await http.post(`/api/surveys/${second}/translation-memory`).set(auth).send({ language: 'fr' }).expect(201)).body;
    expect(r.reused).toBe(0);

    // A person reviews wave 1.
    const d = (await http.get(`/api/surveys/${first}/draft`).set(auth).expect(200)).body.version;
    const fr = d.presentation.languages[0];
    for (const e of Object.values(fr.texts) as Array<{ status: string }>) e.status = 'reviewed';
    await http
      .put(`/api/surveys/${first}/draft/presentation`)
      .set(auth)
      .send({ presentation: d.presentation, expectedUpdatedAt: d.updatedAt })
      .expect(200);

    r = (await http.post(`/api/surveys/${second}/translation-memory`).set(auth).send({ language: 'fr' }).expect(201)).body;
    expect(r.reused).toBeGreaterThan(20);
    const status = r.check.translations.find((t: { tag: string }) => t.tag === 'fr');
    expect(status.missing).toEqual([]);
    expect(status.unreviewed).toEqual([]);

    // Another organization's memory is empty.
    const otherProject = (await http.post('/api/projects').set(other).send({ name: 'O' }).expect(201)).body.id;
    const otherSurvey = (await http.post(`/api/projects/${otherProject}/surveys`).set(other).send({ name: 'O' }).expect(201)).body.id;
    const od = (await http.get(`/api/surveys/${otherSurvey}/draft`).set(other).expect(200)).body.version;
    await http.put(`/api/surveys/${otherSurvey}/draft`).set(other).send({ definition: demo }).expect(200);
    const od2 = (await http.get(`/api/surveys/${otherSurvey}/draft`).set(other).expect(200)).body.version;
    await http
      .put(`/api/surveys/${otherSurvey}/draft/presentation`)
      .set(other)
      .send({ presentation: { ...od.presentation, languages: [{ tag: 'fr', name: 'Français' }] }, expectedUpdatedAt: od2.updatedAt })
      .expect(200);
    expect(
      (await http.post(`/api/surveys/${otherSurvey}/translation-memory`).set(other).send({ language: 'fr' }).expect(201)).body.reused,
    ).toBe(0);
    await http.post(`/api/surveys/${second}/translation-memory`).set(other).send({ language: 'fr' }).expect(404);
  });
});

describe('URL variables and least-fill blocks in live interviews', () => {
  const def = {
    schemaVersion: 1,
    title: 'Concepts',
    pages: [
      { id: 'S', questions: [{ id: 'OK', type: 'single', text: 'Ready?', options: [{ code: 1, label: 'Yes' }] }] },
      { id: 'C1', questions: [{ id: 'A1', type: 'open', text: 'Concept 1?' }] },
      { id: 'C2', questions: [{ id: 'A2', type: 'open', text: 'Concept 2?' }] },
      { id: 'C3', questions: [{ id: 'A3', type: 'open', text: 'Concept 3?' }] },
      { id: 'B', condition: 'SEG == "B2B"', questions: [{ id: 'BIZ', type: 'open', text: 'Company size, {{SEG}}?' }] },
    ],
    urlVariables: [{ id: 'SEG', param: 'seg', label: 'Segment' }],
    blocks: [{ id: 'CON', pages: ['C1', 'C2', 'C3'], pick: 1, balance: 'least_fill' }],
  };
  let surveyId: string;
  let vendorId: string;

  beforeAll(async () => {
    surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name: 'Concepts' }).expect(201)).body.id;
    await http.put(`/api/surveys/${surveyId}/draft`).set(auth).send({ definition: def }).expect(200);
    await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(201);
    vendorId = (await http.post(`/api/projects/${projectId}/vendors`).set(auth).send({ name: 'Panel', code: 'PNL' }).expect(201)).body.id;
  });

  async function run(uid: string, seg?: string) {
    const { url } = (await http.post(`/api/surveys/${surveyId}/links`).set(auth).send({ vendorId, uid }).expect(201)).body;
    const query = Object.fromEntries(new URL(url).searchParams);
    if (seg) query.seg = seg;
    const s = (await http.post(`/api/public/s/${surveyId}/start`).send({ query }).expect(200)).body;
    let st = (
      await http
        .post(`/api/public/r/${s.token}/answers`)
        .send({ pageId: 'S', answers: { OK: 1 } })
        .expect(200)
    ).body;
    const pages: string[] = [];
    const rendered: string[] = [];
    while (st.state === 'in_progress') {
      pages.push(st.page.id);
      const answers = Object.fromEntries((st.page.questions as Array<{ id: string; renderedText: string }>).map((q) => [q.id, 'ok']));
      rendered.push(...(st.page.questions as Array<{ renderedText: string }>).map((q) => q.renderedText));
      st = (await http.post(`/api/public/r/${s.token}/answers`).send({ pageId: st.page.id, answers }).expect(200)).body;
    }
    return { pages, status: st.status as string, rendered };
  }

  it('shows each concept equally often and routes on the link parameter', async () => {
    const counts: Record<string, number> = {};
    let sawB2B = false;
    for (let i = 0; i < 9; i++) {
      const r = await run(`LF-${i}`, i % 3 === 0 ? 'B2B' : undefined);
      counts[r.pages[0]!] = (counts[r.pages[0]!] ?? 0) + 1;
      expect(r.pages.filter((p) => p.startsWith('C'))).toHaveLength(1);
      if (i % 3 === 0) {
        expect(r.pages).toContain('B');
        expect(r.rendered).toContain('Company size, B2B?');
        sawB2B = true;
      } else expect(r.pages).not.toContain('B');
      expect(r.status).toBe('complete');
    }
    expect(sawB2B).toBe(true);
    expect(counts).toEqual({ C1: 3, C2: 3, C3: 3 });
  });

  it('exports the URL variable as a column', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(auth).expect(200)).text;
    const [head, ...rows] = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    const col = head!.split(',').indexOf('SEG');
    expect(col).toBeGreaterThan(-1);
    expect(rows.filter((r) => r.split(',')[col] === 'B2B')).toHaveLength(3);
  });
});

describe('saved QA test cases', () => {
  let surveyId: string;
  beforeAll(async () => {
    surveyId = (
      await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name: 'Cases', template: 'customer-nps' }).expect(201)
    ).body.id;
  });

  it('stores cases per survey and runs them against the draft', async () => {
    const draft = (await http.get(`/api/surveys/${surveyId}/draft`).set(auth).expect(200)).body.version;
    const first = draft.definition.pages[0].questions[0];
    const good = (
      await http
        .post(`/api/surveys/${surveyId}/test-cases`)
        .set(auth)
        .send({ name: 'First page shows', answers: {}, expect: { shows: [draft.definition.pages[0].id, first.id] } })
        .expect(201)
    ).body;
    await http
      .post(`/api/surveys/${surveyId}/test-cases`)
      .set(auth)
      .send({ name: 'Renamed', expect: { shows: ['NOT_THERE'] } })
      .expect(201);
    await http.post(`/api/surveys/${surveyId}/test-cases`).set(auth).send({ name: '' }).expect(400);
    await http.get(`/api/surveys/${surveyId}/test-cases`).set(other).expect(404);

    const run = (await http.post(`/api/surveys/${surveyId}/test-cases/run`).set(auth).expect(201)).body;
    expect(run).toMatchObject({ passed: 1, failed: 1 });
    expect(run.results[0]).toMatchObject({ id: good.id, passed: true });
    expect(run.results[1].checks[0]).toMatchObject({ passed: false, actual: 'NOT_THERE is not in the survey' });

    const list = (await http.get(`/api/surveys/${surveyId}/test-cases`).set(auth).expect(200)).body;
    expect(list.map((c: { name: string }) => c.name)).toEqual(['First page shows', 'Renamed']);
    await http.delete(`/api/surveys/${surveyId}/test-cases/${list[1].id}`).set(other).expect(404);
    await http.delete(`/api/surveys/${surveyId}/test-cases/${list[1].id}`).set(auth).expect(204);
    expect((await http.post(`/api/surveys/${surveyId}/test-cases/run`).set(auth).expect(201)).body).toMatchObject({ passed: 1, failed: 0 });
  });
});
