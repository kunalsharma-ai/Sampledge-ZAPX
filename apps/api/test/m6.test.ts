/**
 * Milestone 6: project-level access (assigned project scope, project members, fresh roles),
 * organization API keys, signed outbound webhooks, the audit log viewer and row-level security on
 * respondent data.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.CALLBACK_ALLOW_PRIVATE_HOSTS = 'true';
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { WebhookService } from '../src/integrations/webhook.service';
import { verifyWebhook } from '../src/integrations/webhook-signing';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m6${Date.now().toString(36)}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let auth: Record<string, string>;
let tenantId: string;
let adminId: string;

let receiver: Server;
let receiverBase: string;
const received: Array<{ url: string; headers: IncomingHttpHeaders; body: string }> = [];
/** Status codes the receiver answers with, per path, in order (then 200). */
const script = new Map<string, number[]>();

let members = 0;
async function member(role: 'PROGRAMMER' | 'VIEWER' | 'ADMIN', projectScope: 'ALL' | 'ASSIGNED' = 'ALL') {
  const email = `${role.toLowerCase()}${++members}-${run}@test.zapx`;
  const created = (
    await http
      .post('/api/users')
      .set(auth)
      .send({ name: `${role} ${members}`, email, password: 'member-password-1', role, projectScope })
      .expect(201)
  ).body;
  const login = await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200);
  return { id: created.id as string, email, headers: { Authorization: `Bearer ${login.body.token}` } };
}

async function project(name: string, headers = auth) {
  return (await http.post('/api/projects').set(headers).send({ name }).expect(201)).body.id as string;
}

async function liveSurvey(projectId: string, name: string, quality: Record<string, unknown> = {}) {
  const id = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name }).expect(201)).body.id as string;
  await http
    .put(`/api/surveys/${id}/draft`)
    .set(auth)
    .send({ definition: { ...demo, settings: { quality } } })
    .expect(200);
  await http.post(`/api/surveys/${id}/publish`).set(auth).expect(201);
  return id;
}

async function complete(surveyId: string, uid: string) {
  const s = (
    await http
      .post(`/api/public/s/${surveyId}/start`)
      .send({ query: { vid: 'WV', uid } })
      .expect(200)
  ).body;
  await http
    .post(`/api/public/r/${s.token}/answers`)
    .send({ pageId: 'P1', answers: { AGE: 40, GENDER: 2 } })
    .expect(200);
  await http
    .post(`/api/public/r/${s.token}/answers`)
    .send({ pageId: 'P2', answers: { AWARE: [99] } })
    .expect(200);
  return (
    await http
      .post(`/api/public/r/${s.token}/answers`)
      .send({ pageId: 'P4', answers: { COMMENTS: 'Secret opinion text' } })
      .expect(200)
  ).body;
}

beforeAll(async () => {
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url!, headers: req.headers, body });
      const key = [...script.keys()].find((k) => req.url!.startsWith(k));
      res.statusCode = (key && script.get(key)!.shift()) || 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  receiverBase = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  const res = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  auth = { Authorization: `Bearer ${res.body.token}` };
  const me = (await http.get('/api/auth/me').set(auth).expect(200)).body;
  tenantId = me.tenant.id;
  adminId = me.id;
});

afterAll(async () => {
  if (tenantId) await prisma.webhookDelivery.updateMany({ where: { tenantId, state: 'PENDING' }, data: { state: 'DEAD' } });
  await app?.close();
  await new Promise((r) => receiver?.close(r));
});

// ---- Project-level access ----------------------------------------------------------------------

describe('project-level access', () => {
  let alpha: string;
  let beta: string;
  let alphaSurvey: string;
  let alphaVendor: string;
  let scoped: Awaited<ReturnType<typeof member>>;

  beforeAll(async () => {
    alpha = await project('Alpha');
    beta = await project('Beta');
    alphaSurvey = await liveSurvey(alpha, 'Alpha survey');
    alphaVendor = (await http.post(`/api/projects/${alpha}/vendors`).set(auth).send({ name: 'Alpha panel', code: 'AP' }).expect(201)).body
      .id;
    scoped = await member('PROGRAMMER', 'ASSIGNED');
  });

  it('hides every project from a member with assigned scope until they are added', async () => {
    expect((await http.get('/api/projects').set(scoped.headers).expect(200)).body).toEqual([]);
    await http.get(`/api/projects/${alpha}`).set(scoped.headers).expect(404);
    await http.get(`/api/surveys/${alphaSurvey}`).set(scoped.headers).expect(404);
    await http.get(`/api/surveys/${alphaSurvey}/export?format=csv`).set(scoped.headers).expect(404);
    await http.get(`/api/surveys/${alphaSurvey}/quality`).set(scoped.headers).expect(404);
    await http.get(`/api/vendors/${alphaVendor}/callbacks`).set(scoped.headers).expect(404);
    expect((await http.get(`/api/projects/${alpha}/vendors`).set(scoped.headers).expect(200)).body).toEqual([]);
    await http.post(`/api/projects/${alpha}/surveys`).set(scoped.headers).send({ name: 'Sneaky' }).expect(404);
  });

  it('shows exactly the assigned projects once an admin adds the member', async () => {
    await http.post(`/api/projects/${alpha}/members`).set(auth).send({ userId: scoped.id }).expect(201);
    const list = (await http.get('/api/projects').set(scoped.headers).expect(200)).body as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toEqual([alpha]);
    await http.get(`/api/surveys/${alphaSurvey}`).set(scoped.headers).expect(200);
    await http.get(`/api/projects/${beta}`).set(scoped.headers).expect(404);

    const people = (await http.get(`/api/projects/${alpha}/members`).set(auth).expect(200)).body as Array<{ id: string; access: string }>;
    expect(people.find((p) => p.id === adminId)?.access).toBe('organization');
    expect(people.find((p) => p.id === scoped.id)?.access).toBe('member');
    expect(
      (await http.get(`/api/projects/${beta}/members`).set(auth).expect(200)).body.some((p: { id: string }) => p.id === scoped.id),
    ).toBe(false);

    await http.delete(`/api/projects/${alpha}/members/${scoped.id}`).set(auth).expect(204);
    await http.get(`/api/surveys/${alphaSurvey}`).set(scoped.headers).expect(404);
  });

  it('only admins manage project members, and members with organization access cannot be added', async () => {
    await http.post(`/api/projects/${alpha}/members`).set(scoped.headers).send({ userId: scoped.id }).expect(403);
    const everyone = await member('VIEWER');
    const res = await http.post(`/api/projects/${alpha}/members`).set(auth).send({ userId: everyone.id }).expect(400);
    expect(res.body.message).toMatch(/already sees every project/);
  });

  it('adds a member with assigned scope to a project they create', async () => {
    const own = await project('Scoped own', scoped.headers);
    const list = (await http.get('/api/projects').set(scoped.headers).expect(200)).body as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toEqual([own]);
  });

  it('applies a role or scope change on the next request, without signing in again', async () => {
    const m = await member('PROGRAMMER');
    await http.post('/api/projects').set(m.headers).send({ name: 'Before' }).expect(201);
    await http.patch(`/api/users/${m.id}`).set(auth).send({ role: 'VIEWER' }).expect(200);
    await http.post('/api/projects').set(m.headers).send({ name: 'After' }).expect(403);
    await http.patch(`/api/users/${m.id}`).set(auth).send({ projectScope: 'ASSIGNED' }).expect(200);
    expect((await http.get('/api/projects').set(m.headers).expect(200)).body).toEqual([]);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId, action: 'user.update', entityId: m.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.data).toMatchObject({ before: { projectScope: 'ALL' }, after: { projectScope: 'ASSIGNED' } });
  });

  it('keeps admins on organization access and stops admins from demoting themselves', async () => {
    const other = await member('ADMIN', 'ASSIGNED');
    expect((await http.get('/api/users').set(auth).expect(200)).body.find((u: { id: string }) => u.id === other.id).projectScope).toBe(
      'ALL',
    );
    await http.patch(`/api/users/${adminId}`).set(auth).send({ role: 'VIEWER' }).expect(400);
  });
});

// ---- API keys -----------------------------------------------------------------------------------

describe('organization API keys', () => {
  let projectId: string;
  let programmer: Awaited<ReturnType<typeof member>>;

  beforeAll(async () => {
    projectId = await project('Keys');
    programmer = await member('PROGRAMMER');
  });

  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

  it('shows the key once, stores only a hash, and authenticates as its creator', async () => {
    const created = (
      await http.post('/api/api-keys').set(programmer.headers).send({ name: 'Nightly sync', role: 'PROGRAMMER' }).expect(201)
    ).body;
    expect(created.key).toMatch(/^zapx_[0-9a-f]{12}_[A-Za-z0-9_-]{32}$/);
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.secretHash).not.toContain(created.key.split('_')[2]);
    const listed = (await http.get('/api/api-keys').set(programmer.headers).expect(200)).body;
    expect(listed).toHaveLength(1);
    expect(listed[0].key).toBeUndefined();
    expect(listed[0].secretHash).toBeUndefined();

    const me = (await http.get('/api/auth/me').set(bearer(created.key)).expect(200)).body;
    expect(me).toMatchObject({ id: programmer.id, role: 'PROGRAMMER', viaApiKey: created.id });
    const p = (await http.post('/api/projects').set(bearer(created.key)).send({ name: 'Made by a key' }).expect(201)).body;
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId, action: 'project.create', entityId: p.id } });
    expect(ev.actorId).toBe(programmer.id);
    expect(ev.data).toMatchObject({ viaApiKey: created.id });
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } })).lastUsedAt).not.toBeNull();
  });

  it('never exceeds the key role or the creator role', async () => {
    const viewerKey = (await http.post('/api/api-keys').set(auth).send({ name: 'Read only', role: 'VIEWER' }).expect(201)).body.key;
    await http.get(`/api/projects/${projectId}`).set(bearer(viewerKey)).expect(200);
    await http.post('/api/projects').set(bearer(viewerKey)).send({ name: 'Nope' }).expect(403);

    // An admin's programmer key cannot reach admin-only endpoints.
    const adminKey = (await http.post('/api/api-keys').set(auth).send({ name: 'Admin script', role: 'PROGRAMMER' }).expect(201)).body.key;
    await http.get('/api/users').set(bearer(adminKey)).expect(403);
    await http.get('/api/audit').set(bearer(adminKey)).expect(403);
    await http.post('/api/api-keys').set(auth).send({ name: 'x', role: 'ADMIN' }).expect(400);

    // When the creator is demoted, their keys are too.
    const m = await member('PROGRAMMER');
    const key = (await http.post('/api/api-keys').set(m.headers).send({ name: 'Mine', role: 'PROGRAMMER' }).expect(201)).body.key;
    await http.post('/api/projects').set(bearer(key)).send({ name: 'Ok' }).expect(201);
    await http.patch(`/api/users/${m.id}`).set(auth).send({ role: 'VIEWER' }).expect(200);
    await http.post('/api/projects').set(bearer(key)).send({ name: 'Not now' }).expect(403);
  });

  it('cannot manage keys with a key', async () => {
    const key = (await http.post('/api/api-keys').set(programmer.headers).send({ name: 'Bot', role: 'PROGRAMMER' }).expect(201)).body.key;
    await http.get('/api/api-keys').set(bearer(key)).expect(403);
    await http.post('/api/api-keys').set(bearer(key)).send({ name: 'Child', role: 'VIEWER' }).expect(403);
  });

  it('rejects revoked, expired, malformed and wrong keys', async () => {
    const k = (
      await http.post('/api/api-keys').set(programmer.headers).send({ name: 'Short lived', role: 'VIEWER', expiresInDays: 1 }).expect(201)
    ).body;
    await http.get('/api/projects').set(bearer(k.key)).expect(200);
    const [, prefix] = k.key.split('_');
    await http
      .get('/api/projects')
      .set(bearer(`zapx_${prefix}_${'A'.repeat(32)}`))
      .expect(401);
    await http.get('/api/projects').set(bearer('zapx_nothex_short')).expect(401);

    await prisma.apiKey.update({ where: { id: k.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await http.get('/api/projects').set(bearer(k.key)).expect(401)).body.message).toMatch(/expired/);

    const r = (await http.post('/api/api-keys').set(programmer.headers).send({ name: 'To revoke', role: 'VIEWER' }).expect(201)).body;
    // Programmers revoke only their own keys; admins any key in the organization.
    const other = await member('PROGRAMMER');
    await http.delete(`/api/api-keys/${r.id}`).set(other.headers).expect(404);
    await http.delete(`/api/api-keys/${r.id}`).set(auth).expect(204);
    expect((await http.get('/api/projects').set(bearer(r.key)).expect(401)).body.message).toMatch(/revoked/);
  });

  it('sees only the projects its creator sees', async () => {
    const scoped = await member('VIEWER', 'ASSIGNED');
    const key = (await http.post('/api/api-keys').set(auth).send({ name: 'For scoped', role: 'VIEWER' }).expect(201)).body;
    // Re-assign the key to the scoped member, as if they had created it.
    await prisma.apiKey.update({ where: { id: key.id }, data: { createdById: scoped.id } });
    expect((await http.get('/api/projects').set(bearer(key.key)).expect(200)).body).toEqual([]);
    await http.get(`/api/projects/${projectId}`).set(bearer(key.key)).expect(404);
  });
});

// ---- Webhooks -----------------------------------------------------------------------------------

describe('outbound webhooks', () => {
  let projectId: string;
  let surveyId: string;
  let hookId: string;
  let secret: string;
  const deliver = () => app.get(WebhookService).deliverDue();
  /** The studio actions start a delivery pass themselves; wait until nothing is left in flight. */
  const settled = async () => {
    for (let i = 0; i < 50; i++) {
      await deliver();
      const busy = await prisma.webhookDelivery.count({
        where: { tenantId, state: 'PENDING', nextAttemptAt: { lte: new Date(Date.now() + 130_000) }, attempts: 0 },
      });
      if (busy === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const due = () =>
    prisma.webhookDelivery.updateMany({ where: { tenantId, state: 'PENDING' }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });

  beforeAll(async () => {
    projectId = await project('Hooks');
    await http.post(`/api/projects/${projectId}/vendors`).set(auth).send({ name: 'Hook panel', code: 'WV' }).expect(201);
    surveyId = await liveSurvey(projectId, 'Hooked');
    const created = (
      await http
        .post('/api/webhooks')
        .set(auth)
        .send({ url: `${receiverBase}/hooks/main`, events: ['response.finished', 'response.review_decided', 'survey.status_changed'] })
        .expect(201)
    ).body;
    hookId = created.id;
    secret = created.secret;
    expect(secret).toMatch(/^whsec_/);
    expect((await prisma.webhook.findUniqueOrThrow({ where: { id: hookId } })).secretEnc).not.toContain(secret);
  });

  it('sends a signed response.finished event without answers', async () => {
    received.length = 0;
    await complete(surveyId, 'W-1');
    expect((await deliver()).delivered).toBeGreaterThanOrEqual(1);
    const got = received.find((r) => r.headers['x-zapx-event'] === 'response.finished');
    expect(got).toBeDefined();
    expect(verifyWebhook(secret, got!.body, String(got!.headers['x-zapx-signature']))).toBe(true);
    expect(verifyWebhook('whsec_wrong', got!.body, String(got!.headers['x-zapx-signature']))).toBe(false);
    const payload = JSON.parse(got!.body);
    expect(payload).toMatchObject({
      type: 'response.finished',
      id: got!.headers['x-zapx-delivery'],
      data: { surveyId, projectId, status: 'complete', mode: 'CAWI', vendor: 'WV', uid: 'W-1' },
    });
    expect(got!.body).not.toContain('Secret opinion text');
    expect(got!.body).not.toContain('AGE');
  });

  it('sends survey.status_changed and skips events nobody subscribed to', async () => {
    received.length = 0;
    await http.post(`/api/surveys/${surveyId}/status`).set(auth).send({ status: 'PAUSED' }).expect(201);
    await http.post(`/api/surveys/${surveyId}/status`).set(auth).send({ status: 'LIVE' }).expect(201);
    await http.put(`/api/surveys/${surveyId}/draft`).set(auth).send({ definition: demo }).expect(200);
    await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(201);
    await deliver();
    // Delivery order is not guaranteed; receivers order by createdAt.
    const events = received.map((r) => JSON.parse(r.body));
    expect(events.map((e) => [e.type, e.data.to]).sort()).toEqual([
      ['survey.status_changed', 'LIVE'],
      ['survey.status_changed', 'PAUSED'],
    ]);
  });

  it('retries server errors with backoff and stops at client errors', async () => {
    const flaky = (
      await http
        .post('/api/webhooks')
        .set(auth)
        .send({ url: `${receiverBase}/hooks/flaky`, events: ['survey.status_changed'] })
        .expect(201)
    ).body;
    script.set('/hooks/flaky', [503, 400]);
    await http.post(`/api/surveys/${surveyId}/status`).set(auth).send({ status: 'PAUSED' }).expect(201);
    await deliver();
    let d = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: flaky.id } });
    expect(d).toMatchObject({ state: 'PENDING', attempts: 1, lastHttpStatus: 503 });
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 10_000);
    await due();
    await deliver();
    d = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId: flaky.id } });
    expect(d).toMatchObject({ state: 'FAILED', attempts: 2, lastHttpStatus: 400 });

    // Redeliver from the studio: it goes again and succeeds.
    await http.post(`/api/webhook-deliveries/${d.id}/redeliver`).set(auth).expect(201);
    await settled();
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).state).toBe('DELIVERED');
    const listed = (await http.get(`/api/webhooks/${flaky.id}/deliveries`).set(auth).expect(200)).body;
    expect(listed[0]).toMatchObject({ event: 'survey.status_changed', state: 'DELIVERED' });
    expect(listed[0].payload).toBeUndefined();
    await http.delete(`/api/webhooks/${flaky.id}`).set(auth).expect(204);
    await http.post(`/api/surveys/${surveyId}/status`).set(auth).send({ status: 'LIVE' }).expect(201);
  });

  it('sends review decisions, and a rejected complete does not send a second response.finished', async () => {
    const q = await liveSurvey(projectId, 'Reviewed');
    await complete(q, 'W-R');
    const r = await prisma.response.findFirstOrThrow({ where: { surveyId: q, uid: 'W-R' } });
    await deliver();
    received.length = 0;
    await http
      .post(`/api/surveys/${q}/quality/decisions`)
      .set(auth)
      .send({ responseIds: [r.id], decision: 'reject' })
      .expect(200);
    await deliver();
    const types = received.map((x) => JSON.parse(x.body)).map((e) => [e.type, e.data.decision ?? e.data.status]);
    expect(types).toEqual([['response.review_decided', 'rejected']]);
  });

  it('sends a test event, rotates the secret, pauses, and is admin only', async () => {
    received.length = 0;
    await http.post(`/api/webhooks/${hookId}/test`).set(auth).expect(201);
    await settled();
    expect(received.map((r) => r.headers['x-zapx-event'])).toContain('webhook.test');

    const { secret: next } = (await http.post(`/api/webhooks/${hookId}/rotate-secret`).set(auth).expect(201)).body;
    expect(next).not.toBe(secret);
    received.length = 0;
    await http.post(`/api/webhooks/${hookId}/test`).set(auth).expect(201);
    await settled();
    expect(verifyWebhook(next, received[0]!.body, String(received[0]!.headers['x-zapx-signature']))).toBe(true);
    secret = next;

    await http.patch(`/api/webhooks/${hookId}`).set(auth).send({ active: false }).expect(200);
    received.length = 0;
    await http.post(`/api/surveys/${surveyId}/status`).set(auth).send({ status: 'PAUSED' }).expect(201);
    await deliver();
    expect(received).toHaveLength(0);
    await http.patch(`/api/webhooks/${hookId}`).set(auth).send({ active: true }).expect(200);

    const p = await member('PROGRAMMER');
    await http.get('/api/webhooks').set(p.headers).expect(403);
    await http
      .post('/api/webhooks')
      .set(auth)
      .send({ url: 'ftp://example.com/x', events: ['survey.published'] })
      .expect(400);
    await http
      .post('/api/webhooks')
      .set(auth)
      .send({ url: `${receiverBase}/x`, events: ['response.answers'] })
      .expect(400);
  });
});

// ---- Audit log ----------------------------------------------------------------------------------

describe('audit log viewer', () => {
  it('lists, filters and pages the organization audit trail for admins only', async () => {
    const page1 = (await http.get('/api/audit?take=3').set(auth).expect(200)).body;
    expect(page1.items).toHaveLength(3);
    expect(page1.next).toBeTruthy();
    const page2 = (await http.get(`/api/audit?take=3&after=${page1.next}`).set(auth).expect(200)).body;
    expect(page2.items.map((i: { id: string }) => i.id)).not.toContain(page1.items[0].id);
    expect(new Date(page2.items[0].createdAt).getTime()).toBeLessThanOrEqual(new Date(page1.items[2].createdAt).getTime());

    const webhooks = (await http.get('/api/audit?action=webhook.&take=200').set(auth).expect(200)).body.items as Array<{
      action: string;
      actor: { email: string };
    }>;
    expect(webhooks.length).toBeGreaterThan(3);
    expect(webhooks.every((e) => e.action.startsWith('webhook.'))).toBe(true);
    expect(webhooks[0]!.actor.email).toBe(`admin-${run}@test.zapx`);
    const actions = (await http.get('/api/audit/actions').set(auth).expect(200)).body;
    expect(actions).toEqual(expect.arrayContaining(['api_key.create', 'project.member_add', 'user.update', 'webhook.create']));

    const viewer = await member('VIEWER');
    await http.get('/api/audit').set(viewer.headers).expect(403);
    const future = (
      await http
        .get(`/api/audit?from=${new Date(Date.now() + 86_400_000).toISOString()}`)
        .set(auth)
        .expect(200)
    ).body;
    expect(future.items).toEqual([]);
  });

  it('exports CSV safely and records the export', async () => {
    await http.post('/api/projects').set(auth).send({ name: '=HYPERLINK("http://evil")' }).expect(201);
    const res = await http.get('/api/audit/export.csv?action=project.create').set(auth).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = res.text.replace(/^\uFEFF/, '');
    expect(text.split('\r\n')[0]).toBe('time,actor_email,actor_name,action,entity_type,entity_id,details');
    expect(text).toContain('project.create');
    expect(text).not.toMatch(/\r\n=/);
    expect(await prisma.auditEvent.count({ where: { tenantId, action: 'audit.export' } })).toBe(1);
  });
});

// ---- Row-level security ------------------------------------------------------------------------

describe('row-level security on respondent data', () => {
  it('reports whether Postgres applies it', async () => {
    const s = (await http.get('/api/audit/security').set(auth).expect(200)).body;
    expect(['enforced', 'bypassed']).toContain(s.rowLevelSecurity);
  });

  it("hides other organizations' responses from the tenant-scoped client", async () => {
    if (prisma.rls !== 'enforced') return; // superuser or BYPASSRLS role: Postgres skips policies.
    const other = await http
      .post('/api/auth/register')
      .send({ organization: `Other ${run}`, name: 'Other', email: `other-${run}@test.zapx`, password: 'correct-horse-battery' })
      .expect(201);
    const otherAuth = { Authorization: `Bearer ${other.body.token}` };
    const otherTenant = (await http.get('/api/auth/me').set(otherAuth).expect(200)).body.tenant.id as string;
    const mine = await prisma.response.findFirstOrThrow({ where: { tenantId } });

    expect(await prisma.forTenant(otherTenant).response.findMany({ where: { id: mine.id } })).toEqual([]);
    expect(await prisma.forTenant(otherTenant).response.count({ where: { tenantId } })).toBe(0);
    expect((await prisma.forTenant(tenantId).response.findMany({ where: { id: mine.id } })).length).toBe(1);
    const changed = await prisma.forTenant(otherTenant).response.updateMany({ where: { id: mine.id }, data: { reviewNote: 'tampered' } });
    expect(changed.count).toBe(0);
    // System paths (no tenant set) are unaffected.
    expect(await prisma.response.count({ where: { id: mine.id } })).toBe(1);
  });
});
