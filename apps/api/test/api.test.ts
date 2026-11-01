/**
 * API integration tests against a real PostgreSQL database (DATABASE_URL).
 * Each run signs up fresh tenants, so tests do not interfere with other data.
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
import { signParams } from '../src/vendors/redirects';

process.env.ALLOW_SIGNUP = 'true';
const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = Date.now().toString(36);

let app: INestApplication;
let http: ReturnType<typeof request>;

async function signup(label: string) {
  const res = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${label} ${run}`, name: label, email: `${label}-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  return { token: res.body.token as string, auth: { Authorization: `Bearer ${res.body.token}` } };
}

/** Parse a runtime link into the query object the runtime sends to /start. */
function queryOf(url: string) {
  const u = new URL(url);
  return { surveyId: u.pathname.split('/').pop()!, query: Object.fromEntries(u.searchParams) };
}

async function startFromLink(url: string) {
  const { surveyId, query } = queryOf(url);
  return (await http.post(`/api/public/s/${surveyId}/start`).send({ query }).expect(200)).body;
}

async function answer(token: string, pageId: string, answers: Record<string, unknown>, expectStatus = 200) {
  return (await http.post(`/api/public/r/${token}/answers`).send({ pageId, answers }).expect(expectStatus)).body;
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app?.close();
});

describe('Milestone 1 flow: create, check, publish, respond, redirect, quota, export', () => {
  let auth: Record<string, string>;
  let projectId: string;
  let surveyId: string;
  let vendorId: string;

  it('creates a project and a survey with a starter draft', async () => {
    ({ auth } = await signup('programmer'));
    projectId = (await http.post('/api/projects').set(auth).send({ name: 'Demo project', client: 'ACME' }).expect(201)).body.id;
    const survey = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name: 'Demo screener' }).expect(201)).body;
    surveyId = survey.id;
    const draft = (await http.get(`/api/surveys/${surveyId}/draft`).set(auth).expect(200)).body;
    expect(draft.version.version).toBe(1);
    expect(draft.check.publishable).toBe(true);
  });

  it('rejects structurally invalid definitions and blocks publishing on logic errors', async () => {
    const bad = await http
      .put(`/api/surveys/${surveyId}/draft`)
      .set(auth)
      .send({ definition: { schemaVersion: 1, title: 'x', pages: [] } });
    expect(bad.status).toBe(400);
    expect(bad.body.issues[0].path).toBe('pages');

    const broken = structuredClone(demo);
    broken.pages[1].condition = 'NOPE == 1';
    const saved = (await http.put(`/api/surveys/${surveyId}/draft`).set(auth).send({ definition: broken }).expect(200)).body;
    expect(saved.check.publishable).toBe(false);
    expect(saved.check.analysis.issues[0].code).toBe('UNDEFINED_VARIABLE');
    const pub = await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(422);
    expect(pub.body.check.analysis.errors).toBe(1);
  });

  it('publishes a clean survey', async () => {
    await http.put(`/api/surveys/${surveyId}/draft`).set(auth).send({ definition: demo }).expect(200);
    const pub = (await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(201)).body;
    expect(pub.version.status).toBe('PUBLISHED');
    const detail = (await http.get(`/api/surveys/${surveyId}`).set(auth).expect(200)).body;
    expect(detail.status).toBe('LIVE');
    expect(detail.liveVersionId).toBe(pub.version.id);
  });

  it('adds a vendor from the Sampledge preset and previews its redirects', async () => {
    const v = (
      await http
        .post(`/api/projects/${projectId}/vendors`)
        .set(auth)
        .send({ name: 'Sampledge', code: 'SE', presetId: 'sampledge-platform' })
        .expect(201)
    ).body;
    vendorId = v.id;
    const preview = (
      await http.post(`/api/vendors/${vendorId}/redirect-preview`).set(auth).send({ status: 'quota_full', uid: 'U1' }).expect(201)
    ).body;
    expect(preview.url).toBe('https://platform.sampledge.com/response/status?status=overquota&uid=U1');
  });

  it('a respondent completes the survey and is sent to the complete redirect', async () => {
    const { url } = (
      await http.post(`/api/surveys/${surveyId}/links`).set(auth).send({ vendorId, uid: 'RESP-1', country: 'US' }).expect(201)
    ).body;
    const s = await startFromLink(url);
    expect(s.state).toBe('in_progress');
    expect(s.survey.welcome).toMatch(/Thank you for taking part/);
    expect(s.page.id).toBe('P1');

    // invalid answers are rejected with field errors
    const invalid = await answer(s.token, 'P1', { AGE: 200 }, 422);
    expect(invalid.errors.map((e: { questionId: string }) => e.questionId).sort()).toEqual(['AGE', 'GENDER']);

    let st = await answer(s.token, 'P1', { AGE: 40, GENDER: 1 });
    expect(st.page.id).toBe('P2');
    // randomized options keep anchors last
    expect(st.page.questions[0].options.slice(-2).map((o: { code: number }) => o.code)).toEqual([98, 99]);
    // same-page conditional question is sent with its condition for live show/hide
    expect(st.page.questions[1].condition).toBe('selected(AWARE, 98)');

    st = await answer(s.token, 'P2', { AWARE: [1, 3] });
    expect(st.page.id).toBe('P3');
    expect(st.page.questions[0].renderedText).toBe('You know Brand A, Brand C. How would you rate each brand?');

    // a stale page submission is refused
    await answer(s.token, 'P2', { AWARE: [1] }, 409);

    st = await answer(s.token, 'P3', { RATE: { a: 4, c: 2 } });
    st = await answer(s.token, 'P4', { COMMENTS: '=HYPERLINK("http://x")' });
    expect(st).toMatchObject({ state: 'finished', status: 'complete' });
    expect(st.redirectUrl).toBe('https://platform.sampledge.com/response/status?status=complete&uid=RESP-1');

    // re-entering with the same UID is a duplicate
    const again = await startFromLink(url);
    expect(again).toMatchObject({ state: 'finished', status: 'duplicate' });
    expect(again.redirectUrl).toContain('status=security');
  });

  it('a second man is over quota (target 1) and goes to the overquota redirect', async () => {
    const { url } = (await http.post(`/api/surveys/${surveyId}/links`).set(auth).send({ vendorId, uid: 'RESP-2' }).expect(201)).body;
    const s = await startFromLink(url);
    const st = await answer(s.token, 'P1', { AGE: 30, GENDER: 1 });
    expect(st).toMatchObject({ state: 'finished', status: 'quota_full' });
    expect(st.redirectUrl).toBe('https://platform.sampledge.com/response/status?status=overquota&uid=RESP-2');
    const quotas = (await http.get(`/api/surveys/${surveyId}/quotas`).set(auth).expect(200)).body;
    expect(quotas.find((q: { id: string }) => q.id === 'QT_MEN')).toMatchObject({ count: 1, target: 1 });
  });

  it('an under-18 respondent is terminated', async () => {
    const { url } = (await http.post(`/api/surveys/${surveyId}/links`).set(auth).send({ vendorId, uid: 'RESP-3' }).expect(201)).body;
    const s = await startFromLink(url);
    const st = await answer(s.token, 'P1', { AGE: 16, GENDER: 2 });
    expect(st).toMatchObject({ state: 'finished', status: 'terminate' });
    expect(st.redirectUrl).toContain('status=terminate&uid=RESP-3');
  });

  it('a respondent who knows no brands skips the ratings page', async () => {
    const { url } = (await http.post(`/api/surveys/${surveyId}/links`).set(auth).send({ vendorId, uid: 'RESP-4' }).expect(201)).body;
    const s = await startFromLink(url);
    await answer(s.token, 'P1', { AGE: 50, GENDER: 2 });
    const st = await answer(s.token, 'P2', { AWARE: [99] });
    expect(st.page.id).toBe('P4');
  });

  it('test links work, are flagged and never count toward quotas', async () => {
    const { url } = (await http.post(`/api/surveys/${surveyId}/links`).set(auth).send({ test: true }).expect(201)).body;
    const s = await startFromLink(url);
    expect(s.isTest).toBe(true);
    let st = await answer(s.token, 'P1', { AGE: 30, GENDER: 1 }); // men quota is full, but tests ignore quotas
    expect(st.page.id).toBe('P2');
    st = await answer(st.page && s.token, 'P2', { AWARE: [99] });
    st = await answer(s.token, 'P4', {});
    expect(st).toMatchObject({ state: 'finished', status: 'complete', redirectUrl: null, isTest: true });
    // a forged test signature is rejected
    const forged = new URL(url);
    forged.searchParams.set('tsig', '0'.repeat(64));
    expect((await startFromLink(forged.toString())).state).toBe('unavailable');
  });

  it('exports CSV with codes, one column per option/row, and formula protection', async () => {
    const res = await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(auth).expect(200);
    const [header, ...rows] = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    const cols = header!.split(',');
    expect(cols).toEqual(expect.arrayContaining(['uid', 'status', 'AGE', 'GENDER', 'AWARE_1', 'AWARE_99', 'RATE_a', 'COMMENTS']));
    expect(rows).toHaveLength(4); // test response excluded
    const resp1 = rows.map((r) => r.split(',')).find((r) => r[cols.indexOf('uid')] === 'RESP-1')!;
    expect(resp1[cols.indexOf('status')]).toBe('complete');
    expect(resp1[cols.indexOf('AWARE_1')]).toBe('1');
    expect(resp1[cols.indexOf('AWARE_2')]).toBe('0');
    expect(resp1[cols.indexOf('RATE_a')]).toBe('4');
    expect(res.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    const xlsx = await http.get(`/api/surveys/${surveyId}/export?format=xlsx`).set(auth).buffer(true).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('records an audit trail', async () => {
    const events = (await http.get(`/api/projects/${projectId}/audit`).set(auth).expect(200)).body;
    const actions = events.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['project.create', 'survey.create', 'survey.publish', 'vendor.create', 'survey.export']),
    );
  });

  describe('signed entry and dynamic redirects', () => {
    let vendor: { id: string; secret: string; code: string };

    it('rejects unsigned or tampered links when the vendor requires signatures', async () => {
      vendor = (
        await http
          .post(`/api/projects/${projectId}/vendors`)
          .set(auth)
          .send({
            name: 'Panel X',
            code: 'PX',
            redirectMode: 'HYBRID',
            requireSignedEntry: true,
            dynamicAllowedHosts: ['panel.example.com'],
            staticUrls: {
              complete: 'https://static.example.com/done?u=[UID]&s=[STATUS]',
              security_reject: 'https://static.example.com/sec?u=[UID]',
            },
          })
          .expect(201)
      ).body;
      const unsigned = await http
        .post(`/api/public/s/${surveyId}/start`)
        .send({ query: { vid: 'PX', uid: 'S1' } })
        .expect(200);
      expect(unsigned.body).toMatchObject({
        state: 'finished',
        status: 'security_reject',
        redirectUrl: 'https://static.example.com/sec?u=S1',
      });
    });

    it('accepts a signed link and honours an allowed dynamic return URL', async () => {
      const q: Record<string, string> = { vid: 'PX', uid: 'S2', rurl: 'https://panel.example.com/ret?id=[UID]' };
      q.sig = signParams(q, vendor.secret);
      const s = (await http.post(`/api/public/s/${surveyId}/start`).send({ query: q }).expect(200)).body;
      expect(s.state).toBe('in_progress');
      const st = await answer(s.token, 'P1', { AGE: 12, GENDER: 2 });
      expect(st.redirectUrl).toBe('https://panel.example.com/ret?id=S2&status=terminate');
    });

    it('ignores a dynamic return URL on a host that is not allowed (falls back to static)', async () => {
      const q: Record<string, string> = { vid: 'PX', uid: 'S3', rurl: 'https://evil.test/steal' };
      q.sig = signParams(q, vendor.secret);
      const s = (await http.post(`/api/public/s/${surveyId}/start`).send({ query: q }).expect(200)).body;
      await answer(s.token, 'P1', { AGE: 30, GENDER: 2 });
      await answer(s.token, 'P2', { AWARE: [99] });
      const st = await answer(s.token, 'P4', {});
      expect(st.redirectUrl).toBe('https://static.example.com/done?u=S3&s=complete');
    });
  });

  it('paused surveys send new respondents to the over-quota redirect', async () => {
    await http.post(`/api/surveys/${surveyId}/status`).set(auth).send({ status: 'PAUSED' }).expect(201);
    const { url } = (await http.post(`/api/surveys/${surveyId}/links`).set(auth).send({ vendorId, uid: 'RESP-9' }).expect(201)).body;
    const st = await startFromLink(url);
    expect(st).toMatchObject({ state: 'finished', status: 'quota_full' });
    await http.post(`/api/surveys/${surveyId}/status`).set(auth).send({ status: 'LIVE' }).expect(201);
  });

  describe('access control', () => {
    it('isolates tenants', async () => {
      const other = await signup('other');
      await http.get(`/api/surveys/${surveyId}`).set(other.auth).expect(404);
      await http.get(`/api/projects/${projectId}`).set(other.auth).expect(404);
      await http.get(`/api/surveys/${surveyId}/export`).set(other.auth).expect(404);
      const list = (await http.get('/api/projects').set(other.auth).expect(200)).body;
      expect(list).toEqual([]);
    });

    it('viewers can read but not change', async () => {
      const email = `viewer-${run}@test.zapx`;
      await http.post('/api/users').set(auth).send({ name: 'V', email, password: 'viewer-password-1', role: 'VIEWER' }).expect(201);
      const login = await http.post('/api/auth/login').send({ email, password: 'viewer-password-1' }).expect(200);
      const viewer = { Authorization: `Bearer ${login.body.token}` };
      await http.get(`/api/surveys/${surveyId}`).set(viewer).expect(200);
      await http.post(`/api/surveys/${surveyId}/publish`).set(viewer).expect(403);
      await http
        .post('/api/users')
        .set(viewer)
        .send({ name: 'X', email: `x-${run}@t.zapx`, password: 'whatever-12345', role: 'ADMIN' })
        .expect(403);
    });

    it('requires the CSRF header for cookie-authenticated changes', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/auth/login')
        .send({ email: `programmer-${run}@test.zapx`, password: 'correct-horse-battery' })
        .expect(200);
      await agent.get('/api/projects').expect(200);
      await agent.post('/api/projects').send({ name: 'nope' }).expect(403);
      await agent.post('/api/projects').set('x-zapx-csrf', '1').send({ name: 'yes' }).expect(201);
    });

    it('rejects bad credentials and anonymous access', async () => {
      await http
        .post('/api/auth/login')
        .send({ email: `programmer-${run}@test.zapx`, password: 'wrong' })
        .expect(401);
      await http.get('/api/projects').expect(401);
    });
  });
});
