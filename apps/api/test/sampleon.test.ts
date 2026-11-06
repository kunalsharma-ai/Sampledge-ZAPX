/**
 * SAMPLEON integration (SAMPLEON docs/ECOSYSTEM_ARCHITECTURE.md): an independent SampCode survey asks
 * SAMPLEON for an audience with a signed request, respondents SAMPLEON sends in are answered with
 * SAMPLEON's survey-host contract (redirect + signed S2S outcome), and SAMPLEON's signed events
 * update the studio's view of the request.
 *
 * The SAMPLEON here is a mock that checks signatures with its own HMAC code (not SampCode's), following
 * the documented contract. The cross-service run lives in the SAMPLEON repository (e2e).
 */
import { vi } from 'vitest';

const ports = vi.hoisted(() => {
  const port = 41000 + Math.floor(Math.random() * 2000);
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.CALLBACK_ALLOW_PRIVATE_HOSTS = 'true';
  process.env.SAMPLEON_URL = `http://127.0.0.1:${port}`;
  process.env.SAMPLEON_CLIENT_ID = 'zapx';
  process.env.SAMPLEON_CLIENT_SECRET = 'zapx-client-secret-at-sampleon';
  process.env.SAMPLEON_OUTCOME_SECRET = 'zapx-outcome-secret-at-sampleon';
  return { port };
});

import 'reflect-metadata';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { CallbackWorker } from '../src/integrations/callback.worker';

const CLIENT_SECRET = 'zapx-client-secret-at-sampleon';
const OUTCOME_SECRET = 'zapx-outcome-secret-at-sampleon';
const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `son${Date.now().toString(36)}`;
const AR = `AR-01JC9Y3V8Q6K2N4R7T0W5X${Math.floor(Math.random() * 9000 + 1000)}`.replace(/[ILOU]/g, 'A');

// ---- Mock SAMPLEON ----------------------------------------------------------------------------

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const mac = (k: string, m: string) => createHmac('sha256', k).update(m).digest('hex');
interface Hit {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}
const hits: Hit[] = [];
const outcomes = new Map<string, string>();
let mock: Server;

function sampleonVerify(h: Hit): boolean {
  const ts = String(h.headers['x-sampledge-timestamp'] ?? '');
  const sig = String(h.headers['x-sampledge-signature'] ?? '');
  return h.headers['x-sampledge-client'] === 'zapx' && sig === `v1=${mac(CLIENT_SECRET, `${ts}.${h.method}.${h.url}.${sha(h.body)}`)}`;
}

function handle(h: Hit): [number, unknown] {
  if (h.url === '/api/v1/s2s/outcome') {
    const b = JSON.parse(h.body) as { token: string; status: string; timestamp: number; signature: string };
    if (Math.abs(Date.now() / 1000 - b.timestamp) > 300 || mac(OUTCOME_SECRET, `${b.token}.${b.status}.${b.timestamp}`) !== b.signature)
      return [401, {}];
    const prior = outcomes.get(b.token);
    if (prior && prior !== b.status) return [409, {}];
    outcomes.set(b.token, b.status);
    return [200, { recorded: true }];
  }
  if (h.url === '/api/v1/audience-requests' && h.method === 'POST') {
    if (!sampleonVerify(h)) return [401, { message: 'Bad signature' }];
    const b = JSON.parse(h.body);
    if (b.source?.platform !== 'ZAPX') return [403, { message: 'A SampCode client can only create SampCode requests' }];
    return [201, { audienceRequestId: AR, status: 'submitted', requiredCompletes: b.requiredCompletes, source: b.source }];
  }
  return [404, {}];
}

/** A SAMPLEON event, signed the way SAMPLEON's outbox signs webhooks. */
function event(type: string, payload: Record<string, unknown>, surveyId: string, over: { eventId?: string; secret?: string } = {}) {
  const body = JSON.stringify({
    specVersion: '1.0',
    eventId: over.eventId ?? randomUUID(),
    type,
    version: 1,
    source: 'SAMPLEON',
    occurredAt: new Date().toISOString(),
    correlationId: AR,
    causationId: null,
    subject: { sourcePlatform: 'ZAPX', sourceProjectId: projectId, surveyId, organizationId: 'org' },
    payload,
  });
  const path = '/api/v1/sampleon/events';
  const ts = String(Math.floor(Date.now() / 1000));
  return http
    .post(path)
    .set('content-type', 'application/json')
    .set('x-sampledge-client', 'sampleon')
    .set('x-sampledge-timestamp', ts)
    .set('x-sampledge-signature', `v1=${mac(over.secret ?? CLIENT_SECRET, `${ts}.POST.${path}.${sha(body)}`)}`)
    .send(body);
}

// ---- App --------------------------------------------------------------------------------------

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let worker: CallbackWorker;
let auth: Record<string, string>;
let projectId: string;
let surveyId: string;

beforeAll(async () => {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const h = { method: req.method!, url: req.url!, headers: req.headers, body };
      hits.push(h);
      const [status, out] = handle(h);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => mock.listen(ports.port, '127.0.0.1', r));

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  worker = app.get(CallbackWorker);

  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  auth = { Authorization: `Bearer ${reg.body.token}` };
  projectId = (await http.post('/api/projects').set(auth).send({ name: 'Independent study' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name: 'Cardiology tracker' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(auth).send({ definition: demo }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(201);
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => mock?.close(r));
});

const request1 = {
  countries: ['US', 'GB'],
  requiredCompletes: 300,
  targeting: { naturalLanguage: 'Cardiologists with at least five years of professional experience' },
  expectedIncidence: 0.4,
  loiMinutes: 15,
  reward: { points: 500 },
  fieldwork: { start: '2026-11-10', end: '2026-12-10' },
};

describe('independent SampCode survey → SAMPLEON audience request', () => {
  it('shows the launch URL SAMPLEON or PROJEXA should use', async () => {
    const r = (await http.get(`/api/surveys/${surveyId}/sampleon`).set(auth).expect(200)).body;
    expect(r.configured).toBe(true);
    expect(r.launchUrl).toMatch(new RegExp(`/s/${surveyId}\\?vid=SAMPLEON&uid=\\{token\\}$`));
    expect(r.requests).toEqual([]);
  });

  it('connects a PROJEXA-linked survey: creates the SAMPLEON vendor once and returns the launch URL', async () => {
    const other = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name: 'PROJEXA-linked' }).expect(201)).body.id;
    const a = (await http.post(`/api/surveys/${other}/sampleon/connect`).set(auth).expect(201)).body;
    const b = (await http.post(`/api/surveys/${other}/sampleon/connect`).set(auth).expect(201)).body;
    expect(a.launchUrl).toContain(`/s/${other}?vid=SAMPLEON&uid={token}`);
    expect(a.vendorId).toBe(b.vendorId);
    expect(await prisma.vendor.count({ where: { projectId, code: 'SAMPLEON' } })).toBe(1);
  });

  it('validates the request before calling SAMPLEON', async () => {
    const before = hits.length;
    await http
      .post(`/api/surveys/${surveyId}/sampleon/audience-requests`)
      .set(auth)
      .send({ ...request1, targeting: {} })
      .expect(400);
    expect(hits.length).toBe(before);
  });

  it('sends a signed SampCode audience request and records it', async () => {
    const r = await http.post(`/api/surveys/${surveyId}/sampleon/audience-requests`).set(auth).send(request1).expect(201);
    expect(r.body.audienceRequest).toMatchObject({ audienceRequestId: AR, status: 'submitted' });
    const hit = hits.find((h) => h.url === '/api/v1/audience-requests')!;
    expect(sampleonVerify(hit)).toBe(true);
    expect(hit.headers['idempotency-key']).toMatch(/^zapx:/);
    const sent = JSON.parse(hit.body);
    expect(sent.source).toEqual({ platform: 'ZAPX', projectId, surveyId });
    expect(sent.title).toBe('Cardiology tracker');
    expect(sent.survey).toMatchObject({ language: 'en', hostId: 'zapx' });
    expect(sent.survey.launchUrl).toContain(`/s/${surveyId}?vid=SAMPLEON&uid={token}`);
    expect(sent.targeting.naturalLanguage).toContain('Cardiologists');

    const vendor = await prisma.vendor.findFirstOrThrow({ where: { projectId, code: 'SAMPLEON' } });
    expect(vendor.integration).toBe('SAMPLEON');
    expect(vendor.partnerSecretEnc).not.toContain(OUTCOME_SECRET);
    const rows = (await http.get(`/api/surveys/${surveyId}/sampleon`).set(auth).expect(200)).body.requests;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      audienceRequestId: AR,
      status: 'submitted',
      sourcePlatform: 'ZAPX',
      requiredCompletes: 300,
      completes: 0,
    });
  });

  it('passes SAMPLEON refusals on, and keeps viewers out', async () => {
    const email = `viewer-${run}@test.zapx`;
    await http.post('/api/users').set(auth).send({ name: 'Viewer', email, password: 'member-password-1', role: 'VIEWER' }).expect(201);
    const login = await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200);
    await http
      .post(`/api/surveys/${surveyId}/sampleon/audience-requests`)
      .set({ Authorization: `Bearer ${login.body.token}` })
      .send(request1)
      .expect(403);
  });
});

describe('respondents SAMPLEON sends in', () => {
  async function finish(uid: string) {
    const s = (
      await http
        .post(`/api/public/s/${surveyId}/start`)
        .send({ query: { vid: 'SAMPLEON', uid } })
        .expect(200)
    ).body;
    const answer = (pageId: string, answers: Record<string, unknown>) =>
      http.post(`/api/public/r/${s.token}/answers`).send({ pageId, answers }).expect(200);
    await answer('P1', { AGE: 40, GENDER: 2 });
    await answer('P2', { AWARE: [99] });
    return (await answer('P4', { COMMENTS: 'fine' })).body;
  }

  it('returns the browser to SAMPLEON and confirms the outcome with a signed S2S call', async () => {
    const st = await finish('ses_CARDIO1');
    expect(st.redirectUrl).toBe(`${process.env.SAMPLEON_URL}/r/complete?token=ses_CARDIO1`);
    const tenantId = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).tenantId;
    await prisma.outboundCallback.updateMany({
      where: { state: 'PENDING', tenantId: { not: tenantId } },
      data: { nextAttemptAt: new Date(Date.now() + 365 * 86_400_000) },
    });
    await prisma.outboundCallback.updateMany({
      where: { state: 'PENDING', tenantId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    expect(await worker.runOnce()).toMatchObject({ delivered: 1 });
    expect(outcomes.get('ses_CARDIO1')).toBe('complete');
    const cb = await prisma.outboundCallback.findFirstOrThrow({ where: { tenantId, url: { endsWith: '/api/v1/s2s/outcome' } } });
    expect(cb).toMatchObject({ integration: 'SAMPLEON', state: 'DELIVERED' });
  });
});

describe('SAMPLEON events', () => {
  const row = () => prisma.sampleonAudienceRequest.findUniqueOrThrow({ where: { audienceRequestId: AR } });

  it('refuses unsigned or wrongly signed events', async () => {
    await http.post('/api/v1/sampleon/events').send({}).expect(401);
    await event('audience.approved', { approvedBy: 'usr_x', allocation: {} }, surveyId, { secret: 'wrong' }).expect(401);
    expect((await row()).status).toBe('submitted');
  });

  it('follows the request through approval, launch, completes and closing, once per event', async () => {
    await event('feasibility.calculated', { feasible: true }, surveyId).expect(200);
    expect((await row()).status).toBe('feasibility_ready');
    const eventId = randomUUID();
    expect(
      (await event('audience.approved', { approvedBy: 'usr_1', allocation: { US: 200, GB: 100 } }, surveyId, { eventId }).expect(200)).body,
    ).toEqual({ status: 'processed' });
    expect((await event('audience.approved', { approvedBy: 'usr_1', allocation: {} }, surveyId, { eventId }).expect(200)).body).toEqual({
      status: 'duplicate',
    });
    expect((await row()).status).toBe('approved');
    await event('batch.scheduled', { batchId: 'bat_1', size: 100, scheduledAt: new Date().toISOString(), mode: 'soft' }, surveyId).expect(
      200,
    );
    expect((await row()).status).toBe('soft_launch');
    await event('batch.scheduled', { batchId: 'bat_2', size: 900, scheduledAt: new Date().toISOString(), mode: 'full' }, surveyId).expect(
      200,
    );
    expect((await row()).status).toBe('live');

    const snap = (sequence: number, completes: number) => ({
      progress: { required: 300, completes, remaining: 300 - completes },
      byCountry: { US: { target: 200, completes } },
      quotas: [],
      sequence,
    });
    await event('project.quota_updated', snap(2, 40), surveyId).expect(200);
    await event('project.quota_updated', snap(1, 10), surveyId).expect(200); // late, older snapshot
    expect(await row()).toMatchObject({ completes: 40, remaining: 260, progressSequence: 2 });
    expect(((await row()).progress as { byCountry: Record<string, unknown> }).byCountry).toEqual({ US: { target: 200, completes: 40 } });

    await event('project.closed', { reason: 'target reached' }, surveyId).expect(200);
    expect(await row()).toMatchObject({ status: 'closed', lastEventType: 'project.closed' });
  });

  it('ignores events for another survey or an unknown request', async () => {
    expect((await event('project.closed', {}, 'some-other-survey').expect(200)).body).toEqual({ status: 'ignored' });
  });
});
