/**
 * Milestone 4: Redirect & Vendor Integration module (precedence, redirect log, callback outbox
 * with retries and dead letter, vendor API authentication, partial and technical-error
 * outcomes), the PROJEXA adapter against a mock of PROJEXA's documented contract, soft delete,
 * and the AI gateway (permissions, rate limits, cost, circuit breaker, redaction).
 *
 * The PROJEXA mock implements docs/SURVEY_INTEGRATION.md of the PROJEXA repository. It is not
 * a live PROJEXA, so these tests prove ZAPX follows the documented contract, nothing more.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.CALLBACK_ALLOW_PRIVATE_HOSTS = 'true';
  process.env.AI_BREAKER_FAILURES = '2';
  process.env.AI_PRICING = JSON.stringify({ 'fake-model': { input: 4, output: 20 } });
});

import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signRequest } from '@zapx/redirect-core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { CallbackWorker } from '../src/integrations/callback.worker';
import { isPrivateAddress } from '../src/integrations/http-delivery';
import { AiError, AiProvider, type ArchitectRequest, type ArchitectResult, type TranslateResult } from '../src/ai/ai-provider';
import { redactPii } from '../src/ai/redact';
import { costMicroUsd } from '../src/ai/ai-gateway';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m4${Date.now().toString(36)}`;
const PROJEXA_SECRET = 'projexa-client-secret-0123456789';

// ---- Mock partner server -------------------------------------------------------------------

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}
const seen: Seen[] = [];
/** Scripted status codes per path prefix for the direct-vendor endpoints. */
const script = new Map<string, number[]>();
/** PROJEXA's view: first outcome wins per token. */
const projexaOutcomes = new Map<string, string>();

function projexa(body: string): number {
  let b: { token?: string; status?: string; timestamp?: number; signature?: string };
  try {
    b = JSON.parse(body);
  } catch {
    return 400;
  }
  if (!b.token || !b.status || typeof b.timestamp !== 'number' || !b.signature) return 400;
  if (Math.abs(Date.now() / 1000 - b.timestamp) > 300) return 401;
  const expected = createHmac('sha256', PROJEXA_SECRET).update(`${b.token}.${b.status}.${b.timestamp}`).digest('hex');
  if (expected !== b.signature) return 401;
  if (b.token.startsWith('unknown')) return 404;
  const prior = projexaOutcomes.get(b.token);
  if (prior && prior !== b.status) return 409;
  projexaOutcomes.set(b.token, b.status);
  return 200;
}

let mock: Server;
let mockBase: string;

// ---- Fake AI provider ----------------------------------------------------------------------

class FakeAi extends AiProvider {
  readonly configured = true;
  readonly model = 'fake-model';
  readonly calls: Array<{ req: ArchitectRequest; model?: string }> = [];
  failNext = 0;
  async architect(req: ArchitectRequest, model?: string): Promise<ArchitectResult> {
    this.calls.push({ req, model });
    if (this.failNext > 0) {
      this.failNext--;
      throw new AiError('The AI service is unavailable right now.', 503, 'UNAVAILABLE');
    }
    return {
      summary: 'Built it.',
      assumptions: [],
      definitionJson: JSON.stringify(demo),
      model: 'fake-model',
      servedByFallback: false,
      usage: { inputTokens: 1000, outputTokens: 500 },
    };
  }
  async translate(): Promise<TranslateResult> {
    return { translations: {}, model: 'fake-model', usage: { inputTokens: 10, outputTokens: 10 } };
  }
}
const fakeAi = new FakeAi();

// ---- App -----------------------------------------------------------------------------------

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let worker: CallbackWorker;
let auth: Record<string, string>;
let projectId: string;
let surveyId: string;

async function signup(label: string) {
  const res = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${label} ${run}`, name: label, email: `${label}-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  return { Authorization: `Bearer ${res.body.token}` };
}

let members = 0;
/** A user with the given role in the main test organization. */
async function member(role: 'PROGRAMMER' | 'VIEWER') {
  const email = `${role.toLowerCase()}${++members}-${run}@test.zapx`;
  await http.post('/api/users').set(auth).send({ name: role, email, password: 'member-password-1', role }).expect(201);
  const login = await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200);
  return { Authorization: `Bearer ${login.body.token}` };
}

async function start(vid: string, uid: string, extra: Record<string, string> = {}) {
  return (
    await http
      .post(`/api/public/s/${surveyId}/start`)
      .send({ query: { vid, uid, ...extra } })
      .expect(200)
  ).body;
}

async function answer(token: string, pageId: string, answers: Record<string, unknown>) {
  return (await http.post(`/api/public/r/${token}/answers`).send({ pageId, answers }).expect(200)).body;
}

/** Answer the demo screener to the end as a woman who knows no brands. */
async function complete(vid: string, uid: string, extra: Record<string, string> = {}) {
  const s = await start(vid, uid, extra);
  await answer(s.token, 'P1', { AGE: 40, GENDER: 2 });
  await answer(s.token, 'P2', { AWARE: [99] });
  return answer(s.token, 'P4', { COMMENTS: 'fine' });
}

async function terminate(vid: string, uid: string, extra: Record<string, string> = {}) {
  const s = await start(vid, uid, extra);
  return answer(s.token, 'P1', { AGE: 16, GENDER: 2 });
}

async function vendor(body: Record<string, unknown>) {
  return (await http.post(`/api/projects/${projectId}/vendors`).set(auth).send(body).expect(201)).body;
}

/** Make every pending callback due now, then run one worker pass. */
async function deliverNow() {
  await prisma.outboundCallback.updateMany({ where: { state: 'PENDING' }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
  return worker.runOnce();
}

beforeAll(async () => {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      if (req.url === '/api/v1/s2s/outcome') {
        res.statusCode = projexa(body);
        return res.end();
      }
      const key = [...script.keys()].find((k) => req.url!.startsWith(k));
      res.statusCode = (key && script.get(key)!.shift()) || 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  mockBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiProvider)
    .useValue(fakeAi)
    .compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  worker = app.get(CallbackWorker);

  auth = await signup('admin');
  projectId = (await http.post('/api/projects').set(auth).send({ name: 'Integrations' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name: 'M4 survey' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(auth).send({ definition: demo }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(201);
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => mock?.close(r));
});

// ---- Redirects -----------------------------------------------------------------------------

describe('redirect precedence and the redirect log', () => {
  let vendorId: string;
  it('uses vendor+country > vendor > project+country > project > organization', async () => {
    await http
      .put('/api/organization/redirect-defaults')
      .set(auth)
      .send({ urls: { terminate: 'https://org.test/t?s=[STATUS]&u=[UID]' }, words: { terminate: 'screenout' } })
      .expect(200);
    await http
      .put(`/api/projects/${projectId}/redirect-defaults`)
      .set(auth)
      .send({
        urls: { complete: 'https://project.test/c?u=[UID]' },
        countries: { fr: { urls: { complete: 'https://project-fr.test/c?u=[UID]' } } },
      })
      .expect(200);
    const v = await vendor({
      name: 'Layered',
      code: 'LAY',
      countryRedirects: { DE: { urls: { complete: 'https://vendor-de.test/c?u=[UID]' } } },
    });
    vendorId = v.id;

    expect((await complete('LAY', 'L-DE', { cc: 'DE' })).redirectUrl).toBe('https://vendor-de.test/c?u=L-DE');
    expect((await complete('LAY', 'L-FR', { cc: 'FR' })).redirectUrl).toBe('https://project-fr.test/c?u=L-FR');
    expect((await complete('LAY', 'L-US', { cc: 'US' })).redirectUrl).toBe('https://project.test/c?u=L-US');
    expect((await terminate('LAY', 'L-T')).redirectUrl).toBe('https://org.test/t?s=screenout&u=L-T');

    const preview = (
      await http
        .post(`/api/vendors/${vendorId}/redirect-preview`)
        .set(auth)
        .send({ status: 'complete', uid: 'X', country: 'de' })
        .expect(201)
    ).body;
    expect(preview).toMatchObject({ url: 'https://vendor-de.test/c?u=X', level: 'vendor_country' });
  });

  it('records each outcome redirect once, with the level that supplied it', async () => {
    // Reloading a finished interview does not add a second entry.
    const s = await start('LAY', 'L-DE');
    expect(s).toMatchObject({ state: 'finished', status: 'duplicate' });
    const events = (await http.get(`/api/vendors/${vendorId}/redirect-events`).set(auth).expect(200)).body as Array<Record<string, string>>;
    const de = events.filter((e) => e.uid === 'L-DE');
    expect(de.map((e) => e.status).sort()).toEqual(['complete', 'duplicate']);
    expect(de.find((e) => e.status === 'complete')).toMatchObject({ level: 'vendor_country', source: 'static', statusWord: 'complete' });
    expect(events.find((e) => e.uid === 'L-T')).toMatchObject({ level: 'organization', statusWord: 'screenout', reason: 'T_UNDERAGE' });
  });

  it('only administrators change organization defaults; other organizations see nothing', async () => {
    const programmer = await member('PROGRAMMER');
    await http.put('/api/organization/redirect-defaults').set(programmer).send({ urls: {} }).expect(403);
    await http
      .put(`/api/projects/${projectId}/redirect-defaults`)
      .set(programmer)
      .send({ urls: { complete: 'javascript:alert(1)' } })
      .expect(400);
    const stranger = await signup('second-org');
    await http.get(`/api/projects/${projectId}/redirect-defaults`).set(stranger).expect(404);
  });
});

// ---- Callbacks -----------------------------------------------------------------------------

describe('direct vendor callbacks (outbox)', () => {
  let vendorId: string;
  let secret: string;

  it('queues one signed callback per outcome and retries transient failures', async () => {
    const v = await vendor({
      name: 'Postback panel',
      code: 'PB',
      staticUrls: { complete: 'https://panel.test/done' },
      statusWords: { complete: 'C' },
      callbackUrl: `${mockBase}/pb?uid=[UID]&s=[STATUS]`,
      callbackStatuses: ['complete', 'terminate'],
    });
    vendorId = v.id;
    secret = v.secret;
    script.set('/pb?uid=PB-1', [500, 200]);

    await complete('PB', 'PB-1');
    let r = await deliverNow();
    expect(r).toMatchObject({ retrying: 1 });
    let list = (await http.get(`/api/vendors/${vendorId}/callbacks`).set(auth).expect(200)).body;
    expect(list.items[0]).toMatchObject({ state: 'PENDING', attempts: 1, lastHttpStatus: 500, status: 'complete' });
    expect(new Date(list.items[0].nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 15_000);

    r = await deliverNow();
    expect(r).toMatchObject({ delivered: 1 });
    list = (await http.get(`/api/vendors/${vendorId}/callbacks`).set(auth).expect(200)).body;
    expect(list.items[0]).toMatchObject({ state: 'DELIVERED', attempts: 2, lastHttpStatus: 200 });
    expect(list.counts).toEqual({ DELIVERED: 1 });

    const hits = seen.filter((s) => s.url.startsWith('/pb?uid=PB-1'));
    expect(hits).toHaveLength(2);
    expect(hits[0]!.url).toBe('/pb?uid=PB-1&s=C');
    const h = hits[1]!.headers;
    expect(h['x-idempotency-key']).toBe(hits[0]!.headers['x-idempotency-key']);
    const expected = createHmac('sha256', secret).update(`${h['x-zapx-timestamp']}.${mockBase}/pb?uid=PB-1&s=C.`).digest('hex');
    expect(h['x-zapx-signature']).toBe(expected);
  });

  it('never queues the same outcome twice', async () => {
    // Re-entry (a duplicate) and reloading the finished interview queue nothing new.
    const again = await start('PB', 'PB-1');
    expect(again.status).toBe('duplicate');
    expect(await prisma.outboundCallback.count({ where: { vendorId, url: { contains: 'uid=PB-1&' } } })).toBe(1);
    const resp = await prisma.response.findFirstOrThrow({ where: { uid: 'PB-1' } });
    await expect(
      prisma.outboundCallback.create({
        data: {
          tenantId: resp.tenantId,
          vendorId,
          responseId: resp.id,
          status: 'complete',
          idempotencyKey: `${resp.id}:complete`,
          integration: 'DIRECT',
          method: 'GET',
          url: 'https://x.test',
        },
      }),
    ).rejects.toThrow();
  });

  it('stops on permanent failures and can be replayed', async () => {
    script.set('/pb?uid=PB-3', [400, 200]);
    await terminate('PB', 'PB-3');
    expect(await deliverNow()).toMatchObject({ failed: 1 });
    const cb = await prisma.outboundCallback.findFirstOrThrow({ where: { vendorId, url: { contains: 'PB-3' } } });
    expect(cb).toMatchObject({ state: 'FAILED', lastHttpStatus: 400 });

    await http.post(`/api/callbacks/${cb.id}/replay`).set(auth).expect(201);
    await worker.runOnce();
    expect(await prisma.outboundCallback.findUniqueOrThrow({ where: { id: cb.id } })).toMatchObject({ state: 'DELIVERED', attempts: 1 });
  });

  it('dead-letters a callback after its last attempt', async () => {
    await http
      .put(`/api/vendors/${vendorId}`)
      .set(auth)
      .send({
        name: 'Postback panel',
        code: 'PB',
        staticUrls: { complete: 'https://panel.test/done' },
        callbackUrl: `${mockBase}/pb?uid=[UID]&s=[STATUS]`,
        callbackStatuses: ['terminate'],
        callbackMaxAttempts: 2,
      })
      .expect(200);
    script.set('/pb?uid=PB-4', [503, 503, 503]);
    await terminate('PB', 'PB-4');
    expect(await deliverNow()).toMatchObject({ retrying: 1 });
    expect(await deliverNow()).toMatchObject({ dead: 1 });
    expect(await prisma.outboundCallback.findFirstOrThrow({ where: { vendorId, url: { contains: 'PB-4' } } })).toMatchObject({
      state: 'DEAD',
      attempts: 2,
    });
  });

  it('blocks callbacks to private networks outside development', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPrivateAddress(a)).toBe(false);
  });
});

// ---- PROJEXA -------------------------------------------------------------------------------

describe('PROJEXA adapter (against a mock of the documented contract)', () => {
  let vendorId: string;

  it('keeps the PROJEXA client secret write-only', async () => {
    const v = await vendor({
      name: 'PROJEXA',
      code: 'PX',
      integration: 'PROJEXA',
      partnerBaseUrl: `${mockBase}/`,
      partnerSecret: PROJEXA_SECRET,
    });
    vendorId = v.id;
    expect(v.partnerSecretSet).toBe(true);
    expect(v.partnerSecretEnc).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain(PROJEXA_SECRET);
    const stored = await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });
    expect(stored.partnerSecretEnc).toMatch(/^v1\./);
    expect(stored.partnerSecretEnc).not.toContain(PROJEXA_SECRET);
    await http
      .post(`/api/projects/${projectId}/vendors`)
      .set(auth)
      .send({ name: 'No base', code: 'PX2', integration: 'PROJEXA' })
      .expect(400);
  });

  it('sends the browser to /r/{status}?token= and confirms with a signed S2S outcome', async () => {
    const st = await complete('PX', 'ptok_ABC123');
    expect(st.redirectUrl).toBe(`${mockBase}/r/complete?token=ptok_ABC123`);
    expect(await deliverNow()).toMatchObject({ delivered: 1 });
    expect(projexaOutcomes.get('ptok_ABC123')).toBe('complete');
    const hit = seen.find((s) => s.url === '/api/v1/s2s/outcome' && s.body.includes('ptok_ABC123'))!;
    expect(hit.method).toBe('POST');
    expect(JSON.parse(hit.body)).toMatchObject({ token: 'ptok_ABC123', status: 'complete' });

    const t = await terminate('PX', 'ptok_T1');
    expect(t.redirectUrl).toBe(`${mockBase}/r/terminate?token=ptok_T1`);
  });

  it('treats a 409 from PROJEXA as a conflict, not something to retry', async () => {
    projexaOutcomes.set('ptok_CONFLICT', 'quota_full');
    await complete('PX', 'ptok_CONFLICT');
    expect(await deliverNow()).toMatchObject({ failed: 1 });
    const cb = await prisma.outboundCallback.findFirstOrThrow({
      where: { vendorId, responseId: { not: '' }, payload: { path: ['token'], equals: 'ptok_CONFLICT' } },
    });
    expect(cb).toMatchObject({ state: 'FAILED', lastHttpStatus: 409, attempts: 1 });
    expect(cb.lastError).toMatch(/conflict/);
  });

  it('records abandoned interviews as partial and tells PROJEXA', async () => {
    const s = await start('PX', 'ptok_GONE');
    expect(s.state).toBe('in_progress');
    await prisma.$executeRaw`UPDATE "Response" SET "updatedAt" = now() - interval '3 days' WHERE uid = 'ptok_GONE'`;
    const r = await deliverNow();
    expect(r.abandoned).toBeGreaterThanOrEqual(1);
    expect(projexaOutcomes.get('ptok_GONE')).toBe('partial');
    const again = (await http.get(`/api/public/r/${s.token}`).expect(200)).body;
    expect(again).toMatchObject({ state: 'finished', status: 'partial', redirectUrl: `${mockBase}/r/partial?token=ptok_GONE` });
  });

  it('ends the interview as technical_error when the server fails mid-survey', async () => {
    const s = await start('PX', 'ptok_ERR');
    const spy = vi.spyOn(prisma.quotaCount, 'findMany').mockImplementationOnce((() => Promise.reject(new Error('disk on fire'))) as never);
    const st = await answer(s.token, 'P1', { AGE: 40, GENDER: 2 });
    spy.mockRestore();
    expect(st).toMatchObject({ state: 'finished', status: 'technical_error', redirectUrl: `${mockBase}/r/technical_error?token=ptok_ERR` });
    const resp = await prisma.response.findFirstOrThrow({ where: { uid: 'ptok_ERR' } });
    expect(resp.status).toBe('TECHNICAL_ERROR');
    expect(resp.outcomeReason).toMatch(/^error:[0-9a-f]{12}$/);
    await deliverNow();
    expect(projexaOutcomes.get('ptok_ERR')).toBe('technical_error');
  });
});

// ---- Vendor API ----------------------------------------------------------------------------

describe('vendor API (HMAC-authenticated)', () => {
  it('lists outcomes for the calling vendor only', async () => {
    const v = await prisma.vendor.findFirstOrThrow({ where: { projectId, code: 'PB' } });
    const path = `/api/v1/vendor/outcomes?surveyId=${surveyId}`;
    const sig = signRequest(v.secret, 'GET', path);
    const res = (
      await http.get(path).set({ 'X-Zapx-Vendor': v.id, 'X-Zapx-Timestamp': sig.timestamp, 'X-Zapx-Signature': sig.signature }).expect(200)
    ).body;
    expect(res.items.map((i: { uid: string }) => i.uid)).toEqual(expect.arrayContaining(['PB-1', 'PB-3', 'PB-4']));
    expect(res.items.every((i: { uid: string }) => i.uid.startsWith('PB-'))).toBe(true);
    expect(res.items.find((i: { uid: string }) => i.uid === 'PB-1').status).toBe('complete');

    const one = signRequest(v.secret, 'GET', '/api/v1/vendor/outcomes/PB-1');
    const single = (
      await http
        .get('/api/v1/vendor/outcomes/PB-1')
        .set({ 'X-Zapx-Vendor': v.id, 'X-Zapx-Timestamp': one.timestamp, 'X-Zapx-Signature': one.signature })
        .expect(200)
    ).body;
    expect(single.items).toHaveLength(1);
  });

  it('rejects bad signatures, stale timestamps and unknown vendors the same way', async () => {
    const v = await prisma.vendor.findFirstOrThrow({ where: { projectId, code: 'PB' } });
    const path = '/api/v1/vendor/outcomes';
    const good = signRequest(v.secret, 'GET', path);
    await http
      .get(path)
      .set({ 'X-Zapx-Vendor': v.id, 'X-Zapx-Timestamp': good.timestamp, 'X-Zapx-Signature': 'ab'.repeat(32) })
      .expect(401);
    await http
      .get(`${path}?limit=5`)
      .set({ 'X-Zapx-Vendor': v.id, 'X-Zapx-Timestamp': good.timestamp, 'X-Zapx-Signature': good.signature })
      .expect(401);
    const old = signRequest(v.secret, 'GET', path, Date.now() - 600_000);
    await http.get(path).set({ 'X-Zapx-Vendor': v.id, 'X-Zapx-Timestamp': old.timestamp, 'X-Zapx-Signature': old.signature }).expect(401);
    await http
      .get(path)
      .set({ 'X-Zapx-Vendor': 'cnotavendor000000', 'X-Zapx-Timestamp': good.timestamp, 'X-Zapx-Signature': good.signature })
      .expect(401);
    await http.get(path).expect(401);
  });
});

// ---- Soft delete ---------------------------------------------------------------------------

describe('soft delete', () => {
  it('a deleted vendor disappears and its links stop working, but its code stays reserved', async () => {
    const v = await vendor({ name: 'Temp', code: 'TMP', staticUrls: { complete: 'https://tmp.test/c' } });
    await http.delete(`/api/vendors/${v.id}`).set(auth).expect(204);
    const list = (await http.get(`/api/projects/${projectId}/vendors`).set(auth).expect(200)).body;
    expect(list.some((x: { id: string }) => x.id === v.id)).toBe(false);
    expect((await start('TMP', 'T-1')).state).toBe('unavailable');
    await http.post(`/api/projects/${projectId}/vendors`).set(auth).send({ name: 'Again', code: 'TMP' }).expect(409);
    expect(await prisma.vendor.findUnique({ where: { id: v.id } })).toMatchObject({ deletedAt: expect.any(Date) });
  });

  it('a live survey must be paused before it is deleted; then its links stop working', async () => {
    const pid = (await http.post('/api/projects').set(auth).send({ name: 'Disposable' }).expect(201)).body.id;
    const sid = (await http.post(`/api/projects/${pid}/surveys`).set(auth).send({ name: 'Old' }).expect(201)).body.id;
    await http.put(`/api/surveys/${sid}/draft`).set(auth).send({ definition: demo }).expect(200);
    await http.post(`/api/surveys/${sid}/publish`).set(auth).expect(201);
    await http.delete(`/api/surveys/${sid}`).set(auth).expect(409);
    await http.delete(`/api/projects/${pid}`).set(auth).expect(409);
    await http.post(`/api/surveys/${sid}/status`).set(auth).send({ status: 'PAUSED' }).expect(201);
    await http.delete(`/api/projects/${pid}`).set(auth).expect(204);
    await http.get(`/api/surveys/${sid}`).set(auth).expect(404);
    await http.get(`/api/projects/${pid}`).set(auth).expect(404);
    const projects = (await http.get('/api/projects').set(auth).expect(200)).body;
    expect(projects.some((p: { id: string }) => p.id === pid)).toBe(false);
    expect(
      (
        await http
          .post(`/api/public/s/${sid}/start`)
          .send({ query: { test: '1', uid: 'x' } })
          .expect(200)
      ).body.state,
    ).toBe('unavailable');
  });
});

// ---- AI gateway ----------------------------------------------------------------------------

describe('AI gateway', () => {
  const propose = (instruction: string) => http.post(`/api/surveys/${surveyId}/ai/propose`).set(auth).field('instruction', instruction);

  it('redacts personal data, records tokens and cost, and audits the call', async () => {
    await propose('Ask about brands. Contact jane.doe@example.com or +44 20 7946 0958, card 4111 1111 1111 1111.').expect(201);
    const sent = fakeAi.calls.at(-1)!;
    expect(sent.model).toBe('fake-model');
    expect(sent.req.instruction).toBe('Ask about brands. Contact [EMAIL] or [PHONE], card [CARD].');
    const usage = (await http.get('/api/organization/ai/usage').set(auth).expect(200)).body;
    const ok = usage.groups.find((g: { outcome: string }) => g.outcome === 'ok');
    expect(ok).toMatchObject({ task: 'architect', model: 'fake-model', calls: 1, inputTokens: 1000, outputTokens: 500 });
    expect(ok.costUsd).toBeCloseTo(0.014, 6); // 1000 × $4/M + 500 × $20/M
    expect(usage.recent[0]).toMatchObject({ redactions: 3, outcome: 'ok' });
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'ai.architect.ok', entityId: usage.recent[0].id } });
    expect(audit).not.toBeNull();
  });

  it('applies tenant permissions and rate limits', async () => {
    const policy = {
      enabled: true,
      allowedTasks: ['translate'],
      requestsPerMinute: 100,
      requestsPerDay: 1000,
      monthlyBudgetUsd: 0,
      redactPii: true,
    };
    await http.put('/api/organization/ai').set(auth).send(policy).expect(200);
    expect((await propose('Add a question').expect(403)).body.code).toBe('NOT_PERMITTED');
    expect((await http.get('/api/ai/status').set(auth).expect(200)).body.tasks.architect.permitted).toBe(false);

    await http
      .put('/api/organization/ai')
      .set(auth)
      .send({ ...policy, allowedTasks: ['architect', 'translate'], requestsPerMinute: 1 })
      .expect(200);
    expect((await propose('Add a question').expect(429)).body.code).toBe('RATE_LIMITED');

    await http
      .put('/api/organization/ai')
      .set(auth)
      .send({ ...policy, allowedTasks: ['architect', 'translate'], monthlyBudgetUsd: 0.01 })
      .expect(200);
    expect((await propose('Add a question').expect(429)).body.code).toBe('BUDGET_EXCEEDED');
    const usage = (await http.get('/api/organization/ai/usage').set(auth).expect(200)).body;
    expect(usage.groups.map((g: { outcome: string }) => g.outcome)).toEqual(
      expect.arrayContaining(['not_permitted', 'rate_limited', 'budget_exceeded']),
    );
  });

  it('opens the circuit after repeated provider failures', async () => {
    await http
      .put('/api/organization/ai')
      .set(auth)
      .send({
        enabled: true,
        allowedTasks: ['architect', 'translate'],
        requestsPerMinute: 100,
        requestsPerDay: 1000,
        monthlyBudgetUsd: 0,
        redactPii: true,
      })
      .expect(200);
    fakeAi.failNext = 2;
    expect((await propose('Add a question').expect(503)).body.code).toBe('UNAVAILABLE');
    expect((await propose('Add a question').expect(503)).body.code).toBe('UNAVAILABLE');
    const calls = fakeAi.calls.length;
    expect((await propose('Add a question').expect(503)).body.code).toBe('CIRCUIT_OPEN');
    expect(fakeAi.calls.length).toBe(calls); // the provider was not called
  });

  it('keeps AI settings to administrators of the organization', async () => {
    const programmer = await member('PROGRAMMER');
    await http.get('/api/organization/ai').set(programmer).expect(403);
    await http.get('/api/organization/ai/usage').set(programmer).expect(403);
    const other = await signup('ai-other');
    const own = (await http.get('/api/organization/ai/usage').set(other).expect(200)).body;
    expect(own.totalCalls).toBe(0);
  });

  it('prices calls from the configured table and redacts only what looks personal', () => {
    expect(
      costMicroUsd({ input: 4, output: 20, cacheRead: 0.2 }, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 }),
    ).toBe(4_200_000n);
    expect(costMicroUsd(undefined, { inputTokens: 5, outputTokens: 5 })).toBe(0n);
    expect(redactPii('Rate 1 to 10. Ages 18-24, 25-34. Call 2024-2025 budget.').count).toBe(0);
    expect(redactPii('IBAN DE89 3704 0044 0532 0130 00 please').text).toBe('IBAN [IBAN] please');
  });
});
