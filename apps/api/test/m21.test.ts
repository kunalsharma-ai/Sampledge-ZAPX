/**
 * Integrations in the CRM: the platform operator's administrators set provider keys in
 * Settings > Integrations instead of the server environment. Only they can see or change them,
 * secrets are sealed and never sent back, every change and test is audited, the providers follow a
 * change without a restart, and clearing a value falls back to the environment.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  // One local stand-in plays every provider.
  for (const k of ['ANTHROPIC_API_BASE', 'IPINFO_API_BASE', 'DEEPGRAM_API_BASE', 'TWILIO_API_BASE', 'STRIPE_API_BASE'])
    process.env[k] = 'http://127.0.0.1:5296';
  for (const k of ['NETWORK_REPUTATION', 'TRANSCRIPTION', 'TELEPHONY', 'BILLING', 'FILE_STORE', 'ANTHROPIC_API_KEY']) delete process.env[k];
  process.env.DEEPGRAM_MODEL = 'env-model';
});

import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { AiGateway } from '../src/ai/ai-gateway';
import { TelephonyService } from '../src/cati/telephony.service';
import { TranscriptionService } from '../src/captures/transcription.service';
import { FileStore, LocalFileStore, S3FileStore, type SwitchingFileStore } from '../src/jobs/file-store';
import { integration } from '../src/platform/integrations';
import { twilioSignature } from '../src/cati/telephony.service';

const run = `m21${Date.now().toString(36)}`;
const IPINFO_TOKEN = 'ipinfo-token-0123456789-secret';
const CLAUDE_KEY = 'sk-ant-test-0123456789abcdef-SECRET'; // secret-scan:allow (fake test value)
const SID = `AC${'2'.repeat(32)}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let tenantId: string;
let otherAdmin: Record<string, string>;
let programmer: Record<string, string>;
let adminKey: Record<string, string>;
let operatorsBefore: string[] = [];
let stand: Server;
const seen: Array<{ url: string; auth?: string; key?: string }> = [];

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function register(label: string) {
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${label} ${run}`, name: 'Admin', email: `${label}-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  const me = await http.get('/api/auth/me').set(bearer(reg.body.token)).expect(200);
  return { headers: bearer(reg.body.token), tenantId: me.body.tenant.id as string };
}

beforeAll(async () => {
  stand = createServer((req, res) => {
    seen.push({ url: req.url ?? '', auth: req.headers.authorization, key: req.headers['x-api-key'] as string | undefined });
    const json = (status: number, body: unknown) =>
      void res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    const url = req.url ?? '';
    if (url.startsWith('/v1/models/')) {
      if (req.headers['x-api-key'] !== CLAUDE_KEY) return json(401, { error: { message: 'invalid x-api-key' } });
      return url.endsWith('/no-such-model') ? json(404, {}) : json(200, { id: url.split('/').pop() });
    }
    if (url === '/8.8.8.8/privacy')
      return req.headers.authorization === `Bearer ${IPINFO_TOKEN}` ? json(200, { vpn: false, proxy: false }) : json(403, {});
    if (url === '/v1/projects')
      return req.headers.authorization === 'Token dg-key-0123456789abcdef' ? json(200, { projects: [] }) : json(401, {});
    if (url.startsWith(`/2010-04-01/Accounts/${SID}.json`)) return json(200, { sid: SID, status: 'active' });
    if (url.startsWith(`/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json`)) return json(200, { incoming_phone_numbers: [{}] });
    if (url.startsWith('/v1/prices/'))
      return url.endsWith('price_gone') ? json(404, { error: { message: 'No such price' } }) : json(200, { active: true });
    json(404, {});
  });
  await new Promise<void>((r) => stand.listen(5296, '127.0.0.1', r));

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  await prisma.platformIntegration.deleteMany();

  const a = await register('operator');
  admin = a.headers;
  tenantId = a.tenantId;
  otherAdmin = (await register('customer')).headers;
  // This organization runs the installation for the test (the others are put back afterwards).
  operatorsBefore = (await prisma.tenant.findMany({ where: { platformOperator: true }, select: { id: true } })).map((t) => t.id);
  await prisma.tenant.updateMany({ data: { platformOperator: false } });
  await prisma.tenant.update({ where: { id: tenantId }, data: { platformOperator: true } });

  const email = `prog-${run}@test.zapx`;
  await http.post('/api/users').set(admin).send({ name: 'Pat', email, password: 'member-password-1', role: 'PROGRAMMER' }).expect(201);
  programmer = bearer((await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token);
  adminKey = bearer((await http.post('/api/api-keys').set(admin).send({ name: 'Script', role: 'PROGRAMMER' }).expect(201)).body.key);
});

afterAll(async () => {
  await prisma?.platformIntegration.deleteMany();
  if (prisma) {
    await prisma.tenant.updateMany({ data: { platformOperator: false } });
    await prisma.tenant.updateMany({ where: { id: { in: operatorsBefore } }, data: { platformOperator: true } });
  }
  await app?.close();
  await new Promise<void>((r) => (stand ? stand.close(() => r()) : r()));
});

describe('who can manage integrations', () => {
  it('only administrators of the operator organization, signed in', async () => {
    expect((await http.get('/api/auth/me').set(admin).expect(200)).body.canManageIntegrations).toBe(true);
    expect((await http.get('/api/auth/me').set(otherAdmin).expect(200)).body.canManageIntegrations).toBe(false);
    await http.get('/api/platform/integrations').set(otherAdmin).expect(403);
    await http
      .put('/api/platform/integrations/ipinfo')
      .set(otherAdmin)
      .send({ enabled: true, values: { token: 'x' } })
      .expect(403);
    await http.get('/api/platform/integrations').set(programmer).expect(403);
    await http.get('/api/platform/integrations').set(adminKey).expect(403);
    await http.get('/api/platform/integrations').expect(401);
  });

  it('lists every integration with where each value comes from', async () => {
    const list = (await http.get('/api/platform/integrations').set(admin).expect(200)).body.integrations;
    expect(list.map((i: { key: string }) => i.key)).toEqual(['anthropic', 'ipinfo', 'deepgram', 'twilio', 'stripe', 's3']);
    const dg = list.find((i: { key: string }) => i.key === 'deepgram');
    expect(dg).toMatchObject({ enabled: false, source: 'env' });
    expect(dg.fields.find((f: { name: string }) => f.name === 'model')).toMatchObject({
      origin: 'env',
      value: 'env-model',
      env: 'DEEPGRAM_MODEL',
    });
    const stripe = list.find((i: { key: string }) => i.key === 'stripe');
    expect(stripe.callbacks[0].url).toMatch(/\/api\/billing\/webhook$/);
  });
});

describe('saving and secrets', () => {
  it('refuses invalid values and turning on without the required ones', async () => {
    const bad = await http
      .put('/api/platform/integrations/twilio')
      .set(admin)
      .send({ enabled: false, values: { accountSid: 'nope', callerId: '0207' } })
      .expect(400);
    expect(bad.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['accountSid', 'callerId']);
    const missing = await http.put('/api/platform/integrations/ipinfo').set(admin).send({ enabled: true, values: {} }).expect(400);
    expect(missing.body.message).toMatch(/Access token/);
    await http
      .put('/api/platform/integrations/ipinfo')
      .set(admin)
      .send({ enabled: true, values: { nonsense: 'x' } })
      .expect(400);
    await http.put('/api/platform/integrations/nothing').set(admin).send({ enabled: true, values: {} }).expect(404);
  });

  it('seals secrets, never sends them back, and audits without the value', async () => {
    const saved = (
      await http
        .put('/api/platform/integrations/ipinfo')
        .set(admin)
        .send({ enabled: true, values: { token: IPINFO_TOKEN } })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ enabled: true, source: 'crm' });
    expect(saved.fields[0]).toMatchObject({ value: null, isSet: true, hint: '…cret', origin: 'crm' });
    expect(JSON.stringify(saved)).not.toContain(IPINFO_TOKEN);
    const listed = (await http.get('/api/platform/integrations').set(admin).expect(200)).text;
    expect(listed).not.toContain(IPINFO_TOKEN);

    const row = await prisma.platformIntegration.findUniqueOrThrow({ where: { key: 'ipinfo' } });
    expect(row.secretsSealed).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(IPINFO_TOKEN);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId, action: 'platform.integration_saved', entityId: 'ipinfo' },
    });
    expect(audit.data).toMatchObject({ enabledBefore: false, enabledAfter: true, changed: [{ field: 'token', secret: true }] });
    expect(JSON.stringify(audit.data)).not.toContain(IPINFO_TOKEN);
  });

  it('keeps a saved secret when it is left empty, and turns off without losing it', async () => {
    await http
      .put('/api/platform/integrations/ipinfo')
      .set(admin)
      .send({ enabled: false, values: { token: '' } })
      .expect(200);
    expect(integration('ipinfo')).toMatchObject({ enabled: false, source: 'crm', values: { token: IPINFO_TOKEN } });
    await http.put('/api/platform/integrations/ipinfo').set(admin).send({ enabled: true, values: {} }).expect(200);
    expect(integration('ipinfo').enabled).toBe(true);
  });
});

describe('test connection', () => {
  it('uses the saved key, or one typed but not saved yet, and says what is wrong', async () => {
    const ok = (await http.post('/api/platform/integrations/ipinfo/test').set(admin).send({}).expect(200)).body;
    expect(ok).toMatchObject({ ok: true });
    expect(seen.at(-1)).toMatchObject({ url: '/8.8.8.8/privacy', auth: `Bearer ${IPINFO_TOKEN}` });
    const wrong = (
      await http
        .post('/api/platform/integrations/ipinfo/test')
        .set(admin)
        .send({ values: { token: 'typed-but-wrong' } })
        .expect(200)
    ).body;
    expect(wrong).toMatchObject({ ok: false });
    expect(wrong.message).toMatch(/privacy detection/);

    const untested = (await http.post('/api/platform/integrations/anthropic/test').set(admin).send({}).expect(200)).body;
    expect(untested).toMatchObject({ ok: false, message: 'Fill in API key first.' });
    const model = (
      await http
        .post('/api/platform/integrations/anthropic/test')
        .set(admin)
        .send({ values: { apiKey: CLAUDE_KEY, model: 'no-such-model' } })
        .expect(200)
    ).body;
    expect(model.message).toMatch(/model "no-such-model" does not exist/);
    const stripe = (
      await http
        .post('/api/platform/integrations/stripe/test')
        .set(admin)
        .send({ values: { secretKey: 'sk_test_abc', webhookSecret: 'whsec_abc', prices: '{"team":"price_gone"}' } })
        .expect(200)
    ).body;
    expect(stripe.message).toMatch(/price for "team" \(price_gone\) does not exist/);

    const tests = await prisma.auditEvent.count({ where: { tenantId, action: 'platform.integration_tested' } });
    expect(tests).toBe(5);
  });
});

describe('providers follow the CRM without a restart', () => {
  it('Claude: the AI gateway uses the saved key and models', async () => {
    const gateway = app.get(AiGateway);
    expect(gateway.configured).toBe(false);
    await http
      .put('/api/platform/integrations/anthropic')
      .set(admin)
      .send({ enabled: true, values: { apiKey: CLAUDE_KEY, model: 'claude-test-1', modelTranslate: 'claude-test-small' } })
      .expect(200);
    expect(gateway.configured).toBe(true);
    expect(gateway.modelFor('architect')).toBe('claude-test-1');
    expect(gateway.modelFor('translate')).toBe('claude-test-small');
    const status = (await http.get('/api/organization/ai').set(admin).expect(200)).body.status;
    expect(status).toMatchObject({ configured: true, model: 'claude-test-1' });

    await http.put('/api/platform/integrations/anthropic').set(admin).send({ enabled: false, values: {} }).expect(200);
    expect(gateway.configured).toBe(false);
  });

  it('Deepgram: a saved key with the model from the environment', async () => {
    const t = app.get(TranscriptionService);
    expect(t.current()).toBeNull();
    await http
      .put('/api/platform/integrations/deepgram')
      .set(admin)
      .send({ enabled: true, values: { apiKey: 'dg-key-0123456789abcdef' } })
      .expect(200);
    expect(t.current()?.name).toBe('deepgram');
    expect(integration('deepgram').values.model).toBe('env-model');
    expect((await http.post('/api/platform/integrations/deepgram/test').set(admin).send({}).expect(200)).body.ok).toBe(true);
  });

  it('Twilio: dialer on, webhooks signed with the saved token and the studio address by default', async () => {
    const tel = app.get(TelephonyService);
    expect(tel.current()).toBeNull();
    await http
      .put('/api/platform/integrations/twilio')
      .set(admin)
      .send({ enabled: true, values: { accountSid: SID, authToken: 'twilio-token-123', callerId: '+442070000001' } })
      .expect(200);
    expect(tel.current()?.name).toBe('twilio');
    const base = integration('twilio').values.webhookBase!;
    expect(base).toMatch(/\/api$/);
    const path = '/telephony/twilio/status?d=abc';
    const sig = twilioSignature('twilio-token-123', `${base}${path}`, { CallStatus: 'ringing' });
    expect(tel.verifyTwilio(path, { CallStatus: 'ringing' }, sig)).toBe(true);
    expect(tel.verifyTwilio(path, { CallStatus: 'ringing' }, twilioSignature('other', `${base}${path}`, { CallStatus: 'ringing' }))).toBe(
      false,
    );
    const tested = (await http.post('/api/platform/integrations/twilio/test').set(admin).send({}).expect(200)).body;
    expect(tested.message).toMatch(/\+442070000001 is a number on this account/);
  });

  it('S3: file storage switches to the bucket, and back when reset', async () => {
    const store = app.get(FileStore) as SwitchingFileStore;
    expect(store.current()).toBeInstanceOf(LocalFileStore);
    await http
      .put('/api/platform/integrations/s3')
      .set(admin)
      .send({
        enabled: true,
        values: { bucket: 'zapx-crm-test', region: 'eu-west-2', accessKeyId: 'AKIAEXAMPLE000000000', secretAccessKey: 's3-secret' }, // secret-scan:allow (fake test value)
      })
      .expect(200);
    expect(store.current()).toBeInstanceOf(S3FileStore);
    const reset = (await http.delete('/api/platform/integrations/s3').set(admin).expect(200)).body;
    expect(reset).toMatchObject({ source: 'env', enabled: false });
    expect(store.current()).toBeInstanceOf(LocalFileStore);
    expect(await prisma.auditEvent.count({ where: { tenantId, action: 'platform.integration_reset', entityId: 's3' } })).toBe(1);
  });

  it('clearing a field falls back to the environment', async () => {
    await http
      .put('/api/platform/integrations/deepgram')
      .set(admin)
      .send({ enabled: true, values: { model: 'crm-model' } })
      .expect(200);
    expect(integration('deepgram').values.model).toBe('crm-model');
    const cleared = (
      await http
        .put('/api/platform/integrations/deepgram')
        .set(admin)
        .send({ enabled: true, values: {}, clear: ['model'] })
        .expect(200)
    ).body;
    expect(cleared.fields.find((f: { name: string }) => f.name === 'model')).toMatchObject({ origin: 'env', value: 'env-model' });
  });
});
