/**
 * Milestone 13: production readiness. Files in S3 (through the real AWS SDK against a fake S3),
 * SAML 2.0 single sign-on (against a test identity provider that signs with a throwaway key), and
 * Stripe billing (against a fake Stripe API, with real webhook signatures).
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.SSO_ALLOW_INSECURE_ISSUER = 'true';
  process.env.AWS_ACCESS_KEY_ID = 'AKIATESTZAPX';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-not-real';
  process.env.EDGE_SHARED_SECRET = 'edge-secret-for-tests-0123456789abcdef';
  process.env.EDGE_CLIENT_ADDRESS_HEADER = 'x-test-viewer';
  process.env.GEO_COUNTRY_HEADER = 'x-test-country';
});

import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { config, resetConfig } from '../src/config';
import { PrismaService } from '../src/common/prisma.service';
import { FileNotFoundError, FileStore, S3FileStore } from '../src/jobs/file-store';
import { verifyStripeSignature } from '../src/plans/billing.service';
import { databaseUrlFromParts } from '../src/database-url';
import { addressOnly } from '../src/bootstrap';
import { QualityService } from '../src/quality/quality.service';
import { MockS3 } from './support/mock-s3';
import { TEST_IDP_ISSUER, TEST_IDP_SSO_URL, readAuthnRequest, samlResponse, testIdpKeys } from './support/mock-saml';

const run = `m13${Date.now().toString(36)}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 9)]);
const WEBHOOK_SECRET = 'whsec_test_zapx_m13';

/** A fake Stripe API: Checkout and portal sessions, and subscriptions the test sets. */
class MockStripe {
  base = '';
  forms: Array<{ path: string; form: URLSearchParams; auth: string }> = [];
  subscriptions = new Map<string, Record<string, unknown>>();
  private server?: Server;
  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const json = (status: number, data: unknown) =>
          res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
        if (req.method === 'POST')
          this.forms.push({ path: url.pathname, form: new URLSearchParams(body), auth: req.headers.authorization ?? '' });
        if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions')
          return json(200, { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' });
        if (req.method === 'POST' && url.pathname === '/v1/billing_portal/sessions')
          return json(200, { url: 'https://billing.stripe.test/p/1' });
        const m = /^\/v1\/subscriptions\/(.+)$/.exec(url.pathname);
        if (req.method === 'GET' && m) {
          const sub = this.subscriptions.get(decodeURIComponent(m[1]!));
          return sub ? json(200, sub) : json(404, { error: { message: 'No such subscription' } });
        }
        json(404, { error: { message: 'Unknown path' } });
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  stop() {
    return new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let s3: MockS3;
let stripe: MockStripe;
let admin: Record<string, string>;
let tenantId: string;
let adminEmail: string;
let projectId: string;
const idp = testIdpKeys('ZAPX test IdP');
const otherIdp = testIdpKeys('Another IdP');
const domain = `${run}.example`;

beforeAll(async () => {
  s3 = await new MockS3().start();
  stripe = await new MockStripe().start();
  Object.assign(process.env, {
    FILE_STORE: 's3',
    S3_BUCKET: 'zapx-files-test',
    S3_PREFIX: 'zapx/test',
    S3_REGION: 'eu-west-1',
    S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:111122223333:key/test-key',
    S3_ENDPOINT: s3.endpoint,
    BILLING: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_zapx_m13',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICES: JSON.stringify({ team: 'price_team1', business: 'price_business1' }),
    STRIPE_API_BASE: stripe.base,
  });
  resetConfig();
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  adminEmail = `admin-${run}@test.zapx`;
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `M13 ${run}`, name: 'Admin', email: adminEmail, password: 'admin-password-1' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  tenantId = reg.body.user.tenantId ?? (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).tenantId;
  projectId = (await http.post('/api/projects').set(admin).send({ name: 'M13' }).expect(201)).body.id;
});

afterAll(async () => {
  await app?.close();
  await s3?.stop();
  await stripe?.stop();
  for (const k of [
    'FILE_STORE',
    'S3_BUCKET',
    'S3_PREFIX',
    'S3_KMS_KEY_ID',
    'S3_ENDPOINT',
    'BILLING',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICES',
    'STRIPE_API_BASE',
  ])
    delete process.env[k];
  resetConfig();
});

describe('files in S3', () => {
  it('the app uses the S3 store when FILE_STORE=s3', () => {
    expect(app.get(FileStore)).toBeInstanceOf(S3FileStore);
  });

  it('stores uploads as encrypted objects and serves them back', async () => {
    const surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name: 'Media' }).expect(201)).body.id;
    const img = (await http.post(`/api/surveys/${surveyId}/media`).set(admin).attach('file', PNG, 'pack.png').expect(201)).body;
    const put = s3.requests.find((r) => r.method === 'PUT' && r.key.endsWith(`/media/${img.id}`));
    expect(put).toBeTruthy();
    expect(put!.bucket).toBe('zapx-files-test');
    expect(put!.key).toBe(`zapx/test/${tenantId}/media/${img.id}`);
    expect(put!.headers['x-amz-server-side-encryption']).toBe('aws:kms');
    expect(put!.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBe('arn:aws:kms:eu-west-1:111122223333:key/test-key');
    expect(String(put!.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATESTZAPX\//);
    const stored = s3.objects.get(`zapx-files-test/${put!.key}`)!;
    expect(stored.body.equals(PNG)).toBe(true);
    expect(stored.contentType).toBe('image/png');
    const back = await http.get(`/api/public/media/${img.id}`).buffer(true).expect(200);
    expect(Buffer.from(back.body as Buffer).equals(PNG)).toBe(true);
  });

  it('missing objects, deletes, bad keys and S3 errors', async () => {
    const store = app.get(FileStore);
    await expect(store.get('nothing/here')).rejects.toBeInstanceOf(FileNotFoundError);
    await store.put('t1/x/abc', Buffer.from('hello'), 'text/plain');
    expect((await store.get('t1/x/abc')).toString()).toBe('hello');
    await store.delete('t1/x/abc');
    await store.delete('t1/x/abc'); // twice is fine
    await expect(store.get('t1/x/abc')).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(store.put('../escape', Buffer.from('x'))).rejects.toThrow('Invalid storage key');
    await expect(store.put('/abs', Buffer.from('x'))).rejects.toThrow('Invalid storage key');
    s3.failNext = 500;
    // The SDK retries a 500 (maxAttempts 3), so one failure is absorbed.
    await store.put('t1/x/retry', Buffer.from('ok'));
    expect((await store.get('t1/x/retry')).toString()).toBe('ok');
  });

  it('uses SSE-S3 when no KMS key is set, and refuses s3 without a bucket', async () => {
    process.env.S3_KMS_KEY_ID = '';
    resetConfig();
    const plain = new S3FileStore();
    await plain.put('t1/y/z', Buffer.from('a'));
    const last = s3.requests.filter((r) => r.method === 'PUT').at(-1)!;
    expect(last.headers['x-amz-server-side-encryption']).toBe('AES256');
    expect(last.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBeUndefined();
    process.env.S3_KMS_KEY_ID = 'arn:aws:kms:eu-west-1:111122223333:key/test-key';
    process.env.S3_BUCKET = '';
    resetConfig();
    expect(() => config()).toThrow(/S3_BUCKET/);
    process.env.S3_BUCKET = 'zapx-files-test';
    resetConfig();
  });
});

describe('SAML single sign-on', () => {
  const entity = () => `${config().STUDIO_URL}/api/auth/sso/saml/metadata`;
  const acs = () => `${config().STUDIO_URL}/api/auth/sso/saml/acs`;

  function setUp(extra: Record<string, unknown> = {}) {
    return http
      .put('/api/sso')
      .set(admin)
      .send({
        enabled: true,
        protocol: 'SAML',
        samlEntryPoint: TEST_IDP_SSO_URL,
        samlIdpIssuer: TEST_IDP_ISSUER,
        samlCerts: [idp.cert],
        domains: [domain],
        jitRole: 'VIEWER',
        ...extra,
      });
  }

  async function start(email: string, next = '/projects') {
    const { url } = (await http.post('/api/auth/sso/start').send({ email, next }).expect(200)).body as { url: string };
    return readAuthnRequest(url);
  }

  async function post(body: Record<string, string>) {
    const res = await http.post('/api/auth/sso/saml/acs').type('form').send(body).expect(303);
    const session = ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) => c.startsWith('zapx_token='));
    return { location: res.headers.location as string, session };
  }

  it('validates the settings and publishes service provider metadata', async () => {
    await setUp({ samlCerts: ['not a certificate'.repeat(10)] }).expect(400);
    await setUp({ samlEntryPoint: null }).expect(400);
    const saved = (await setUp().expect(200)).body;
    expect(saved.config).toMatchObject({ protocol: 'SAML', samlIdpIssuer: TEST_IDP_ISSUER, enabled: true, clientSecretSet: false });
    expect(saved.saml).toEqual({ entityId: entity(), acsUrl: acs(), metadataUrl: entity() });
    const meta = await http.get('/api/auth/sso/saml/metadata').expect(200);
    expect(meta.headers['content-type']).toContain('application/samlmetadata+xml');
    expect(meta.text).toContain(`entityID="${entity()}"`);
    expect(meta.text).toContain(`Location="${acs()}"`);
    expect(meta.text).toContain('WantAssertionsSigned="true"');
    const audit = await prisma.auditEvent.findFirst({ where: { tenantId, action: 'sso.update' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.data).toMatchObject({ protocol: 'SAML', certificates: 1 });
  });

  it('signs a new person in, creating them with the just-in-time role', async () => {
    const email = `ana@${domain}`;
    const req = await start(email);
    expect(`${req.url.origin}${req.url.pathname}`).toBe(TEST_IDP_SSO_URL);
    expect(req.relayState).toBe(req.id);
    expect(req.xml).toContain(`AssertionConsumerServiceURL="${acs()}"`);
    expect(req.xml).toContain(`>${entity()}</saml:Issuer>`);
    const response = samlResponse({
      key: idp.key,
      inResponseTo: req.id,
      audience: entity(),
      acsUrl: acs(),
      nameID: email,
      attributes: { 'http://schemas.microsoft.com/identity/claims/displayname': 'Ana Field' },
    });
    const ok = await post({ SAMLResponse: response, RelayState: req.relayState });
    expect(ok.location).toBe('/projects');
    expect(ok.session).toBeTruthy();
    const me = (await http.get('/api/auth/me').set('Cookie', ok.session!).expect(200)).body;
    expect(me).toMatchObject({ email, role: 'VIEWER', name: 'Ana Field' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.ssoSubject).toBe(`saml:${email}`);

    // The same response a second time (a replay) is refused: the request was used.
    const replay = await post({ SAMLResponse: response, RelayState: req.relayState });
    expect(replay.session).toBeUndefined();
    expect(decodeURIComponent(replay.location)).toContain('already used');
  });

  it('links an existing member by email and keeps their role', async () => {
    const email = `lead@${domain}`;
    await http.post('/api/users').set(admin).send({ name: 'Lead', email, password: 'member-password-1', role: 'PROGRAMMER' }).expect(201);
    const req = await start(email, '/');
    const ok = await post({
      SAMLResponse: samlResponse({
        key: idp.key,
        inResponseTo: req.id,
        audience: entity(),
        acsUrl: acs(),
        nameID: 'EMP-0042',
        attributes: { mail: email },
      }),
      RelayState: req.relayState,
    });
    expect(ok.session).toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).ssoSubject).toBe('saml:EMP-0042');
    expect((await http.get('/api/auth/me').set('Cookie', ok.session!).expect(200)).body.role).toBe('PROGRAMMER');
  });

  it('refuses responses that are not signed by the configured IdP, or are for someone else', async () => {
    const email = `bad@${domain}`;
    const cases: Array<[string, (id: string) => string, string]> = [
      [
        'unsigned',
        (id) => samlResponse({ key: 'none', inResponseTo: id, audience: entity(), acsUrl: acs(), nameID: email }),
        'could not be verified',
      ],
      [
        'another key',
        (id) => samlResponse({ key: otherIdp.key, inResponseTo: id, audience: entity(), acsUrl: acs(), nameID: email }),
        'could not be verified',
      ],
      [
        'wrong audience',
        (id) => samlResponse({ key: idp.key, inResponseTo: id, audience: 'https://evil.example/sp', acsUrl: acs(), nameID: email }),
        'could not be verified',
      ],
      [
        'wrong issuer',
        (id) =>
          samlResponse({
            key: idp.key,
            inResponseTo: id,
            audience: entity(),
            acsUrl: acs(),
            nameID: email,
            issuer: 'https://evil.example/idp',
          }),
        'could not be verified',
      ],
      [
        'expired',
        (id) => samlResponse({ key: idp.key, inResponseTo: id, audience: entity(), acsUrl: acs(), nameID: email, validForSeconds: -600 }),
        'could not be verified',
      ],
      [
        'other request',
        () =>
          samlResponse({
            key: idp.key,
            inResponseTo: '_0000000000000000000000000000000000000000',
            audience: entity(),
            acsUrl: acs(),
            nameID: email,
          }),
        'could not be verified',
      ],
      [
        'transient id',
        (id) =>
          samlResponse({
            key: idp.key,
            inResponseTo: id,
            audience: entity(),
            acsUrl: acs(),
            nameID: 'x8f3',
            nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
            attributes: { email },
          }),
        'transient',
      ],
      [
        'outside the domains',
        (id) => samlResponse({ key: idp.key, inResponseTo: id, audience: entity(), acsUrl: acs(), nameID: 'someone@elsewhere.example' }),
        'not in a domain',
      ],
      [
        'IdP refused',
        (id) =>
          samlResponse({
            key: idp.key,
            inResponseTo: id,
            audience: entity(),
            acsUrl: acs(),
            nameID: email,
            status: 'urn:oasis:names:tc:SAML:2.0:status:Responder',
          }),
        'refused the sign-in',
      ],
    ];
    for (const [what, make, message] of cases) {
      const req = await start(email);
      const r = await post({ SAMLResponse: make(req.id), RelayState: req.relayState });
      expect(r.session, what).toBeUndefined();
      expect(decodeURIComponent(r.location), what).toContain(message);
      // Every failed attempt uses up its request.
      expect(await prisma.ssoRequest.findUnique({ where: { id: req.id } }), what).toBeNull();
    }
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('refuses IdP-initiated sign-in and disabled members', async () => {
    const unsolicited = await post({
      SAMLResponse: samlResponse({ key: idp.key, inResponseTo: '', audience: entity(), acsUrl: acs(), nameID: `ana@${domain}` }),
    });
    expect(decodeURIComponent(unsolicited.location)).toContain('Sign in from the ZAPX login page');
    const email = `ana@${domain}`;
    await prisma.user.update({ where: { email }, data: { disabledAt: new Date() } });
    const req = await start(email);
    const r = await post({
      SAMLResponse: samlResponse({ key: idp.key, inResponseTo: req.id, audience: entity(), acsUrl: acs(), nameID: email }),
      RelayState: req.relayState,
    });
    expect(r.session).toBeUndefined();
    expect(decodeURIComponent(r.location)).toContain('disabled');
    await prisma.user.update({ where: { email }, data: { disabledAt: null } });
  });

  it('accepts a second certificate during a rotation, and enforcement blocks passwords', async () => {
    await setUp({ samlCerts: [otherIdp.cert, idp.cert], enforced: true }).expect(200);
    const email = `ana@${domain}`;
    const req = await start(email);
    const r = await post({
      SAMLResponse: samlResponse({ key: otherIdp.key, inResponseTo: req.id, audience: entity(), acsUrl: acs(), nameID: email }),
      RelayState: req.relayState,
    });
    expect(r.session).toBeTruthy();
    await http
      .post('/api/auth/login')
      .send({ email: `lead@${domain}`, password: 'member-password-1' })
      .expect(403);
    await setUp({ enforced: false }).expect(200);
  });
});

describe('billing with Stripe', () => {
  function sign(payload: string, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
    return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
  }
  function webhook(event: Record<string, unknown>, signature?: string) {
    const payload = JSON.stringify(event);
    return http
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature ?? sign(payload))
      .send(payload);
  }
  const tenant = () => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  it('checks webhook signatures', () => {
    const body = Buffer.from('{"id":"evt_1"}');
    const now = 1_800_000_000;
    const good = `t=${now},v1=${createHmac('sha256', 's').update(`${now}.`).update(body).digest('hex')}`;
    expect(() => verifyStripeSignature(body, good, 's', now)).not.toThrow();
    expect(() => verifyStripeSignature(body, good, 'other', now)).toThrow('does not match');
    expect(() => verifyStripeSignature(body, good, 's', now + 301)).toThrow('tolerance');
    expect(() => verifyStripeSignature(body, undefined, 's', now)).toThrow('missing');
    expect(() => verifyStripeSignature(body, 't=1', 's', now)).toThrow('malformed');
  });

  it('shows what can be bought and starts a Checkout for an admin', async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { plan: 'free' } });
    const summary = (await http.get('/api/billing').set(admin).expect(200)).body;
    expect(summary).toMatchObject({ enabled: true, plan: 'free', canManage: false, hasSubscription: false });
    expect(summary.purchasable.map((p: { code: string }) => p.code)).toEqual(['team', 'business']);
    await http.post('/api/billing/checkout').set(admin).send({ plan: 'enterprise' }).expect(400);
    const { url } = (await http.post('/api/billing/checkout').set(admin).send({ plan: 'team' }).expect(200)).body;
    expect(url).toBe('https://checkout.stripe.test/cs_test_1');
    const call = stripe.forms.find((f) => f.path === '/v1/checkout/sessions')!;
    expect(call.auth).toBe('Bearer sk_test_zapx_m13');
    expect(Object.fromEntries(call.form)).toMatchObject({
      mode: 'subscription',
      'line_items[0][price]': 'price_team1',
      client_reference_id: tenantId,
      'subscription_data[metadata][tenantId]': tenantId,
      customer_email: adminEmail,
    });
    await http.post('/api/billing/portal').set(admin).expect(400); // nothing bought yet
  });

  it('applies the subscription from signed webhooks, once', async () => {
    stripe.subscriptions.set(`sub_${run}`, {
      id: `sub_${run}`,
      customer: `cus_${run}`,
      status: 'active',
      metadata: { tenantId },
      items: { data: [{ price: { id: 'price_team1' }, current_period_end: 1_900_000_000 }] },
    });
    const completed = {
      id: `evt_cs_${run}`,
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', client_reference_id: tenantId, customer: `cus_${run}`, subscription: `sub_${run}` } },
    };
    await webhook(completed, 't=1,v1=00').expect(401);
    expect((await tenant()).plan).toBe('free');
    expect((await webhook(completed).expect(200)).body.result).toContain('active: plan free -> team');
    expect(await tenant()).toMatchObject({
      plan: 'team',
      billingStatus: 'active',
      billingCustomerId: `cus_${run}`,
      billingSubscriptionId: `sub_${run}`,
    });
    expect((await tenant()).billingPeriodEnd?.getTime()).toBe(1_900_000_000_000);
    expect((await webhook(completed).expect(200)).body.result).toBe('duplicate');

    // An upgrade in the portal: Stripe sends an update; ZAPX re-reads the subscription.
    stripe.subscriptions.set(`sub_${run}`, {
      ...stripe.subscriptions.get(`sub_${run}`)!,
      items: { data: [{ price: { id: 'price_business1' } }] },
    });
    await webhook({
      id: `evt_up_${run}`,
      type: 'customer.subscription.updated',
      data: { object: { id: `sub_${run}`, customer: `cus_${run}` } },
    }).expect(200);
    expect((await tenant()).plan).toBe('business');

    // A failed payment keeps the plan while Stripe retries; cancellation falls back to free.
    stripe.subscriptions.set(`sub_${run}`, { ...stripe.subscriptions.get(`sub_${run}`)!, status: 'past_due' });
    await webhook({
      id: `evt_pd_${run}`,
      type: 'customer.subscription.updated',
      data: { object: { id: `sub_${run}`, customer: `cus_${run}` } },
    }).expect(200);
    expect(await tenant()).toMatchObject({ plan: 'business', billingStatus: 'past_due' });
    stripe.subscriptions.set(`sub_${run}`, { ...stripe.subscriptions.get(`sub_${run}`)!, status: 'canceled' });
    await webhook({
      id: `evt_del_${run}`,
      type: 'customer.subscription.deleted',
      data: { object: { id: `sub_${run}`, customer: `cus_${run}` } },
    }).expect(200);
    expect(await tenant()).toMatchObject({ plan: 'free', billingStatus: 'canceled' });

    // Events about another subscription, or another customer, change nothing.
    const other = await webhook({
      id: `evt_other_${run}`,
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_old', customer: `cus_${run}` } },
    }).expect(200);
    expect(other.body.result).toBe('other subscription');
    const stranger = await webhook({
      id: `evt_x_${run}`,
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_x', customer: 'cus_unknown' } },
    }).expect(200);
    expect(stranger.body.result).toBe('unknown organization');

    // A checkout that names a customer already paying for another organization is not applied.
    const other2 = await prisma.tenant.create({ data: { name: `Other ${run}`, plan: 'free' } });
    const clash = await webhook({
      id: `evt_clash_${run}`,
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', client_reference_id: other2.id, customer: `cus_${run}`, subscription: `sub_${run}` } },
    }).expect(200);
    expect(clash.body.result).toBe('customer belongs to another organization');
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: other2.id } })).plan).toBe('free');

    const audits = await prisma.auditEvent.findMany({ where: { tenantId, action: 'billing.plan_sync' }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => (a.data as { to: string }).to)).toEqual(['team', 'business', 'business', 'free']);
    const { url } = (await http.post('/api/billing/portal').set(admin).expect(200)).body;
    expect(url).toBe('https://billing.stripe.test/p/1');
  });

  it('only admins can see or change billing', async () => {
    const email = `viewer-${run}@test.zapx`;
    // The cancellation above left the free plan, whose three seats are taken.
    await http.post('/api/users').set(admin).send({ name: 'V', email, password: 'member-password-1', role: 'VIEWER' }).expect(403);
    await prisma.tenant.update({ where: { id: tenantId }, data: { plan: 'enterprise' } });
    await http.post('/api/users').set(admin).send({ name: 'V', email, password: 'member-password-1', role: 'VIEWER' }).expect(201);
    const login = await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200);
    const viewer = { Authorization: `Bearer ${login.body.token}` };
    await http.get('/api/billing').set(viewer).expect(403);
    await http.post('/api/billing/checkout').set(viewer).send({ plan: 'team' }).expect(403);
  });
});

describe('running on AWS', () => {
  it('builds the database URL from the RDS secret parts', () => {
    expect(databaseUrlFromParts({ DATABASE_URL: 'postgresql://a/b' })).toBe('postgresql://a/b');
    expect(databaseUrlFromParts({ DB_HOST: 'db.internal' })).toBeUndefined();
    const url = databaseUrlFromParts({
      DB_HOST: 'zapx.abc.eu-west-1.rds.amazonaws.com',
      DB_USER: 'zapx',
      DB_PASSWORD: 'p@ss:w/rd?#%',
      DB_NAME: 'zapx',
      DB_SSLMODE: 'require',
    })!;
    expect(url).toBe('postgresql://zapx:p%40ss%3Aw%2Frd%3F%23%25@zapx.abc.eu-west-1.rds.amazonaws.com:5432/zapx?sslmode=require'); // secret-scan:allow (made-up test password)
    expect(decodeURIComponent(new URL(url).password)).toBe('p@ss:w/rd?#%');
  });

  it('reads viewer addresses as CloudFront sends them', () => {
    expect(addressOnly('198.51.100.7:46532')).toBe('198.51.100.7');
    expect(addressOnly('2001:db8::8a2e:370:7334:46532')).toBe('2001:db8::8a2e:370:7334');
    expect(addressOnly('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(addressOnly('203.0.113.9')).toBe('203.0.113.9');
    expect(addressOnly('not-an-address')).toBeNull();
  });

  it('trusts the viewer address and country only on requests from the CDN', async () => {
    const definition = { schemaVersion: 1, title: 'Edge', pages: [{ id: 'P1', questions: [{ id: 'Q1', type: 'open', text: 'Hi' }] }] };
    const surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name: 'Edge' }).expect(201)).body.id;
    await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition }).expect(200);
    await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);
    const quality = app.get(QualityService);
    const start = (uid: string, headers: Record<string, string>) =>
      http
        .post(`/api/public/s/${surveyId}/start`)
        .set(headers)
        .send({ query: { vid: 'PN', uid } })
        .expect(200);
    await http.post(`/api/projects/${projectId}/vendors`).set(admin).send({ name: 'Panel', code: 'PN' }).expect(201);

    await start(`edge-${run}`, {
      'X-Zapx-Edge': process.env.EDGE_SHARED_SECRET!,
      'x-test-viewer': '198.51.100.7:4431',
      'x-test-country': 'DE',
    });
    const viaEdge = await prisma.response.findFirstOrThrow({ where: { surveyId, uid: `edge-${run}` } });
    expect(viaEdge.geoCountry).toBe('DE');
    expect(viaEdge.ipHash).toBe(quality.networkHash(tenantId, '198.51.100.7'));

    await start(`direct-${run}`, { 'X-Zapx-Edge': 'wrong', 'x-test-viewer': '198.51.100.7:4431', 'x-test-country': 'DE' });
    const direct = await prisma.response.findFirstOrThrow({ where: { surveyId, uid: `direct-${run}` } });
    expect(direct.geoCountry).toBeNull();
    expect(direct.ipHash).not.toBe(quality.networkHash(tenantId, '198.51.100.7'));
  });
});
