/**
 * Blueprint phase 1 over the API: surveys created from templates and the question bank, loops and
 * dynamic lists in a live interview, live quota target changes and the version list.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.LOGIN_RATE_PER_MINUTE = '100';
});

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const run = `bp${Date.now().toString(36)}`;
let app: INestApplication;
let http: ReturnType<typeof request>;
let admin: Record<string, string>;
let other: Record<string, string>;
let projectId: string;
let surveyId: string;
let vendorId: string;

async function register(tag: string) {
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${tag} ${run}`, name: 'Admin', email: `${tag}-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  return { Authorization: `Bearer ${reg.body.token as string}` };
}

async function start(uid: string) {
  const { url } = (await http.post(`/api/surveys/${surveyId}/links`).set(admin).send({ vendorId, uid }).expect(201)).body;
  const u = new URL(url);
  return (
    await http
      .post(`/api/public/s/${surveyId}/start`)
      .send({ query: Object.fromEntries(u.searchParams) })
      .expect(200)
  ).body;
}
const answer = async (token: string, pageId: string, answers: Record<string, unknown>) =>
  (await http.post(`/api/public/r/${token}/answers`).send({ pageId, answers }).expect(200)).body;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  admin = await register('a');
  other = await register('b');
  projectId = (await http.post('/api/projects').set(admin).send({ name: 'Blueprint' }).expect(201)).body.id;
  vendorId = (await http.post(`/api/projects/${projectId}/vendors`).set(admin).send({ name: 'Panel', code: 'PANEL' }).expect(201)).body.id;
});

afterAll(async () => {
  await app?.close();
});

describe('templates and question bank', () => {
  it('lists the built-in templates', async () => {
    const t = (await http.get('/api/library/templates').set(admin).expect(200)).body;
    expect(t.map((x: { key: string }) => x.key)).toContain('brand-health');
    expect(t[0]).not.toHaveProperty('definition');
  });

  it('creates a survey from a template, titled with the new name', async () => {
    surveyId = (
      await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name: 'Brand Q4', template: 'brand-health' }).expect(201)
    ).body.id;
    const d = (await http.get(`/api/surveys/${surveyId}/draft`).set(admin).expect(200)).body;
    expect(d.version.definition.title).toBe('Brand Q4');
    expect(d.version.definition.loops).toHaveLength(1);
    expect(d.check.publishable).toBe(true);
    await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name: 'x', template: 'nope' }).expect(400);
  });

  it('saves questions and surveys to the bank, only for the same organization', async () => {
    const q = (
      await http
        .post('/api/library')
        .set(admin)
        .send({
          kind: 'QUESTION',
          name: 'Age bands',
          category: 'Demographics',
          tags: ['age', 'age'],
          content: { id: 'AGE', type: 'single', text: 'Age?', options: [{ code: 1, label: '18-34' }] },
        })
        .expect(201)
    ).body;
    expect(q.tags).toEqual(['age']);
    await http
      .post('/api/library')
      .set(admin)
      .send({ kind: 'QUESTION', name: 'Bad', content: { id: 'X', type: 'nope' } })
      .expect(400);
    const draft = (await http.get(`/api/surveys/${surveyId}/draft`).set(admin).expect(200)).body.version.definition;
    const s = (await http.post('/api/library').set(admin).send({ kind: 'SURVEY', name: 'Our tracker', content: draft }).expect(201)).body;

    expect((await http.get('/api/library?kind=QUESTION').set(admin).expect(200)).body.map((i: { id: string }) => i.id)).toEqual([q.id]);
    expect((await http.get('/api/library?q=demo').set(admin).expect(200)).body).toHaveLength(1);
    expect((await http.get('/api/library').set(other).expect(200)).body).toEqual([]);
    await http.put(`/api/library/${q.id}`).set(other).send({ name: 'Mine' }).expect(404);
    await http.delete(`/api/library/${q.id}`).set(other).expect(404);

    const renamed = (await http.put(`/api/library/${q.id}`).set(admin).send({ name: 'Age (3 bands)' }).expect(200)).body;
    expect(renamed.name).toBe('Age (3 bands)');

    const copy = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name: 'Copy', libraryItemId: s.id }).expect(201))
      .body.id;
    const cd = (await http.get(`/api/surveys/${copy}/draft`).set(admin).expect(200)).body.version.definition;
    expect(cd.pages.map((p: { id: string }) => p.id)).toEqual(draft.pages.map((p: { id: string }) => p.id));
    const otherProject = (await http.post('/api/projects').set(other).send({ name: 'O' }).expect(201)).body.id;
    await http.post(`/api/projects/${otherProject}/surveys`).set(other).send({ name: 'Steal', libraryItemId: s.id }).expect(404);

    await http.delete(`/api/library/${q.id}`).set(admin).expect(204);
  });
});

describe('a live interview with a loop and a dynamic list', () => {
  it('asks the loop once per chosen brand and offers only chosen brands', async () => {
    await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);
    const s = await start('LOOP-1');
    expect(s.page.id).toBe('S1');
    let st = await answer(s.token, 'S1', { AGE: 1, GENDER: 1 });
    st = await answer(s.token, 'A1', { AWARE: [3, 1] });
    expect(st.page.id).toBe('L1_1');
    expect(st.page.questions[0].renderedText).toBe('Overall, how would you rate Northwind?');
    st = await answer(s.token, 'L1_1', { RATING_1: 8, CONSIDER_1: 3 });
    expect(st.page.id).toBe('L1_3');
    st = await answer(s.token, 'L1_3', { RATING_3: 4, CONSIDER_3: 2 });
    expect(st.page.questions[0].options.map((o: { code: number }) => o.code).sort()).toEqual([1, 3]);
    while (st.state === 'in_progress') {
      const p = st.page;
      const a: Record<string, unknown> = {};
      for (const q of p.questions) {
        if (q.type === 'single') a[q.id] = q.options[0].code;
        else if (q.type === 'multi') a[q.id] = [q.options[0].code];
        else if (q.type === 'scale') a[q.id] = q.min ?? 0;
        else if (q.type === 'open') a[q.id] = 'ok';
      }
      st = await answer(s.token, p.id, a);
    }
    expect(st.status).toBe('complete');
  });
});

describe('live quota targets', () => {
  it('lowers a target without republishing, then goes back to the published one', async () => {
    let q = (await http.put(`/api/surveys/${surveyId}/quotas/QT_AGE1`).set(admin).send({ target: 1 }).expect(200)).body;
    expect(q).toMatchObject({ target: 1, publishedTarget: 100, overridden: true, count: 1 });

    const s = await start('LOOP-2');
    const st = await answer(s.token, 'S1', { AGE: 1, GENDER: 2 });
    expect(st).toMatchObject({ state: 'finished', status: 'quota_full' });

    await http.put(`/api/surveys/${surveyId}/quotas/QT_AGE1`).set(admin).send({ target: -1 }).expect(400);
    await http.put(`/api/surveys/${surveyId}/quotas/NOPE`).set(admin).send({ target: 5 }).expect(404);
    await http.put(`/api/surveys/${surveyId}/quotas/QT_AGE1`).set(other).send({ target: 5 }).expect(404);
    q = (await http.put(`/api/surveys/${surveyId}/quotas/QT_AGE1`).set(admin).send({ target: null }).expect(200)).body;
    expect(q).toMatchObject({ target: 100, overridden: false });
    const audit = (await http.get('/api/audit?action=survey.quota_target').set(admin).expect(200)).body;
    const items = Array.isArray(audit) ? audit : audit.items;
    expect(items.some((e: { action: string }) => e.action === 'survey.quota_target')).toBe(true);
  });

  it('lists versions with who made them and how many responses each has', async () => {
    const v = (await http.get(`/api/surveys/${surveyId}/versions`).set(admin).expect(200)).body;
    expect(v[0]).toMatchObject({ version: 1 });
    expect(JSON.stringify(v)).toMatch(/Admin/);
  });
});
