/**
 * Milestone 8: OpenID Connect single sign-on (against a mock provider), disabling members, SCIM 2.0
 * provisioning, and plan limits (seats, live surveys, monthly completes, features).
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SSO_ALLOW_INSECURE_ISSUER = 'true';
  process.env.STUDIO_URL = 'http://studio.test';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { MockOidc } from './support/mock-oidc';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m8${Date.now().toString(36)}`;
const domain = `${run}.example.com`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let idp: MockOidc;
let admin: Record<string, string>;
let tenantId: string;

async function register(org: string, email: string) {
  const res = await http.post('/api/auth/register').send({ organization: org, name: 'Admin', email, password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const auth = { Authorization: `Bearer ${res.body.token}` };
  const me = (await http.get('/api/auth/me').set(auth).expect(200)).body;
  return { auth, tenantId: me.tenant.id as string };
}

async function login(email: string, password = 'member-password-1') {
  return http.post('/api/auth/login').send({ email, password });
}

function addMember(auth: Record<string, string>, email: string, role = 'PROGRAMMER') {
  return http
    .post('/api/users')
    .set(auth)
    .send({ name: email.split('@')[0], email, password: 'member-password-1', role });
}

const ssoConfig = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  issuer: idp.issuer,
  clientId: idp.clientId,
  clientSecret: idp.clientSecret,
  domains: [domain],
  enforced: false,
  jitRole: null,
  ...over,
});

/** Runs the whole browser round trip: start, sign in at the provider, come back to the callback. */
async function ssoLogin(
  email: string,
  claims: Record<string, unknown>,
  opts: { next?: string; audience?: string; nonce?: string; state?: string } = {},
) {
  const start = await http.post('/api/auth/sso/start').send({ email, next: opts.next }).expect(200);
  const cookie = start.headers['set-cookie'] as unknown as string[];
  expect(cookie.join(';')).toMatch(/zapx_sso=.*Path=\/api\/auth\/sso.*HttpOnly/i);
  const { code, state, redirectUri } = idp.authorize(start.body.url, {
    claims: { email, ...claims },
    audience: opts.audience,
    nonce: opts.nonce,
  });
  expect(redirectUri).toBe('http://studio.test/api/auth/sso/callback');
  const back = await http
    .get('/api/auth/sso/callback')
    .query({ code, state: opts.state ?? state })
    .set('Cookie', cookie.map((c) => c.split(';')[0]).join('; '))
    .expect(302);
  const session = ((back.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) => c.startsWith('zapx_token='));
  return { location: back.headers.location as string, session: session?.split(';')[0] };
}

beforeAll(async () => {
  idp = await new MockOidc().start();
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  ({ auth: admin, tenantId } = await register(`Org ${run}`, `admin@${domain}`));
});

afterAll(async () => {
  await app?.close();
  await idp?.stop();
});

describe('single sign-on (OpenID Connect)', () => {
  it('saves the provider without ever returning the secret, and checks it first', async () => {
    await http
      .put('/api/sso')
      .set(admin)
      .send(ssoConfig({ issuer: 'http://127.0.0.1:1/nothing' }))
      .expect(400);
    const saved = (await http.put('/api/sso').set(admin).send(ssoConfig()).expect(200)).body;
    expect(saved).toMatchObject({ available: true, callbackUrl: 'http://studio.test/api/auth/sso/callback' });
    expect(saved.config).toMatchObject({ enabled: true, clientSecretSet: true, domains: [domain] });
    expect(JSON.stringify(saved)).not.toContain(idp.clientSecret);
    const sealed = await prisma.tenantSso.findUniqueOrThrow({ where: { tenantId } });
    expect(sealed.clientSecretSealed).not.toContain(idp.clientSecret);
    // Saving again without a secret keeps the stored one.
    await http
      .put('/api/sso')
      .set(admin)
      .send(ssoConfig({ clientSecret: undefined }))
      .expect(200);
  });

  it('refuses a domain another organization already signs in with', async () => {
    const other = await register(`Other ${run}`, `admin@other-${domain}`);
    await http.put('/api/sso').set(other.auth).send(ssoConfig()).expect(409);
  });

  it('signs in an existing member and links their identity', async () => {
    await addMember(admin, `pat@${domain}`).expect(201);
    const { location, session } = await ssoLogin(`pat@${domain}`, { sub: 'idp-pat', name: 'Pat' }, { next: '/projects?x=1' });
    expect(location).toBe('/projects?x=1');
    expect(session).toBeDefined();
    const me = (await http.get('/api/auth/me').set('Cookie', session!).expect(200)).body;
    expect(me).toMatchObject({ email: `pat@${domain}`, role: 'PROGRAMMER' });
    expect((await prisma.user.findUniqueOrThrow({ where: { email: `pat@${domain}` } })).ssoSubject).toBe('idp-pat');
    expect(await prisma.auditEvent.count({ where: { tenantId, action: 'auth.sso_login' } })).toBe(1);
    // A second sign-in finds the member by subject, even if the provider now reports a new email.
    await prisma.user.update({ where: { email: `pat@${domain}` }, data: { email: `pat.old@${domain}` } });
    const again = await ssoLogin(`pat@${domain}`, { sub: 'idp-pat' });
    expect(again.session).toBeDefined();
  });

  it('only allows same-site paths after sign-in', async () => {
    await addMember(admin, `nina@${domain}`).expect(201);
    const { location } = await ssoLogin(`nina@${domain}`, { sub: 'idp-nina' }, { next: '//evil.example/steal' });
    expect(location).toBe('/');
  });

  it('refuses people without an account unless just-in-time provisioning is on', async () => {
    const refused = await ssoLogin(`new@${domain}`, { sub: 'idp-new' });
    expect(refused.session).toBeUndefined();
    expect(decodeURIComponent(refused.location)).toContain('do not have a ZAPX account');
    await http
      .put('/api/sso')
      .set(admin)
      .send(ssoConfig({ jitRole: 'VIEWER' }))
      .expect(200);
    const ok = await ssoLogin(`new@${domain}`, { sub: 'idp-new', name: 'New Person' });
    expect(ok.session).toBeDefined();
    expect(await prisma.user.findUniqueOrThrow({ where: { email: `new@${domain}` } })).toMatchObject({
      role: 'VIEWER',
      name: 'New Person',
      ssoSubject: 'idp-new',
    });
  });

  it('refuses tampered or unverifiable sign-ins', async () => {
    const cases: Array<[Parameters<typeof ssoLogin>[2], Record<string, unknown>, RegExp]> = [
      [{ state: 'forged' }, {}, /did not match/],
      [{ nonce: 'replayed' }, {}, /did not match/],
      [{ audience: 'another-app' }, {}, /could not be verified/],
      [{}, { email_verified: false }, /not verified/],
    ];
    for (const [opts, claims, message] of cases) {
      const r = await ssoLogin(`pat.old@${domain}`, { sub: 'idp-pat', ...claims }, opts);
      expect(r.session).toBeUndefined();
      expect(decodeURIComponent(r.location)).toMatch(message);
    }
    // An email outside the configured domains is refused even if the provider vouches for it.
    const start = await http
      .post('/api/auth/sso/start')
      .send({ email: `pat@${domain}` })
      .expect(200);
    const cookie = (start.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    const { code, state } = idp.authorize(start.body.url, { claims: { sub: 'idp-x', email: 'someone@gmail.com' } });
    const back = await http.get('/api/auth/sso/callback').query({ code, state }).set('Cookie', cookie).expect(302);
    expect(decodeURIComponent(back.headers.location as string)).toMatch(/not in a domain/);
    // No cookie: the sign-in was started elsewhere.
    const lost = await http.get('/api/auth/sso/callback').query({ code: 'x', state: 'y' }).expect(302);
    expect(decodeURIComponent(lost.headers.location as string)).toMatch(/another browser/);
  });

  it('answers 404 for domains without single sign-on', async () => {
    await http.post('/api/auth/sso/start').send({ email: 'someone@unknown.example' }).expect(404);
  });

  it('can require single sign-on for everyone except admins', async () => {
    await addMember(admin, `sam@${domain}`).expect(201);
    expect((await login(`sam@${domain}`)).status).toBe(200);
    await http
      .put('/api/sso')
      .set(admin)
      .send(ssoConfig({ enforced: true }))
      .expect(200);
    const blocked = await login(`sam@${domain}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('SSO_REQUIRED');
    // Admins keep password sign-in as a way back in if the provider breaks.
    expect((await http.post('/api/auth/login').send({ email: `admin@${domain}`, password: 'correct-horse-battery' })).status).toBe(200);
    await http
      .put('/api/sso')
      .set(admin)
      .send(ssoConfig({ enforced: false }))
      .expect(200);
  });

  it('non-admins cannot read or change the settings', async () => {
    const sam = { Authorization: `Bearer ${(await login(`sam@${domain}`)).body.token}` };
    await http.get('/api/sso').set(sam).expect(403);
    await http.put('/api/sso').set(sam).send(ssoConfig()).expect(403);
  });
});

describe('disabling members', () => {
  it('stops sessions, API keys and sign-in at once, and can be undone', async () => {
    await addMember(admin, `dee@${domain}`).expect(201);
    const dee = (await prisma.user.findUniqueOrThrow({ where: { email: `dee@${domain}` } })).id;
    const session = { Authorization: `Bearer ${(await login(`dee@${domain}`)).body.token}` };
    const key = (await http.post('/api/api-keys').set(session).send({ name: 'script', role: 'VIEWER' }).expect(201)).body.key as string;
    await http
      .get('/api/projects')
      .set({ Authorization: `Bearer ${key}` })
      .expect(200);

    const off = (await http.patch(`/api/users/${dee}`).set(admin).send({ disabled: true }).expect(200)).body;
    expect(off.disabledAt).not.toBeNull();
    await http.get('/api/projects').set(session).expect(401);
    await http
      .get('/api/projects')
      .set({ Authorization: `Bearer ${key}` })
      .expect(401);
    expect((await login(`dee@${domain}`)).status).toBe(401);
    expect(await prisma.auditEvent.count({ where: { tenantId, action: 'user.disable', entityId: dee } })).toBe(1);

    await http.patch(`/api/users/${dee}`).set(admin).send({ disabled: false }).expect(200);
    await http.get('/api/projects').set(session).expect(200);
  });

  it('admins cannot disable themselves', async () => {
    const me = (await http.get('/api/auth/me').set(admin).expect(200)).body;
    await http.patch(`/api/users/${me.id}`).set(admin).send({ disabled: true }).expect(400);
  });
});

describe('SCIM provisioning', () => {
  let token: string;
  const scim = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' });

  it('creates a token shown once, and refuses requests without it', async () => {
    const created = (await http.post('/api/scim/token').set(admin).expect(201)).body;
    token = created.token;
    expect(token).toMatch(/^scim_[0-9a-f]{12}_/);
    const status = (await http.get('/api/scim/token').set(admin).expect(200)).body;
    expect(status).toMatchObject({ available: true, baseUrl: 'http://studio.test/api/scim/v2', token: { prefix: created.prefix } });
    expect(JSON.stringify(status)).not.toContain(token);
    const denied = await http
      .get('/api/scim/v2/Users')
      .set({ Authorization: 'Bearer scim_000000000000_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' })
      .expect(401);
    expect(denied.headers['content-type']).toContain('application/scim+json');
    expect(JSON.parse(denied.text)).toMatchObject({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '401' });
    // A studio session is not a SCIM credential.
    await http.get('/api/scim/v2/Users').set(admin).expect(401);
  });

  it('publishes its capabilities', async () => {
    const res = await http.get('/api/scim/v2/ServiceProviderConfig').set(scim()).expect(200);
    expect(JSON.parse(res.text)).toMatchObject({ patch: { supported: true }, bulk: { supported: false }, filter: { supported: true } });
  });

  it('creates, finds, updates, deactivates and deletes users', async () => {
    const body = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: `Lee@${domain}`,
      externalId: 'okta-123',
      name: { givenName: 'Lee', familyName: 'Park' },
      emails: [{ value: `lee@${domain}`, primary: true }],
      active: true,
      roles: [{ value: 'programmer', primary: true }],
    };
    const created = JSON.parse((await http.post('/api/scim/v2/Users').set(scim()).send(JSON.stringify(body)).expect(201)).text);
    expect(created).toMatchObject({
      userName: `lee@${domain}`,
      externalId: 'okta-123',
      displayName: 'Lee Park',
      active: true,
      roles: [{ value: 'programmer' }],
    });
    expect(created.meta.location).toBe(`http://studio.test/api/scim/v2/Users/${created.id}`);
    const dup = await http.post('/api/scim/v2/Users').set(scim()).send(JSON.stringify(body)).expect(409);
    expect(JSON.parse(dup.text).scimType).toBe('uniqueness');

    const found = JSON.parse(
      (
        await http
          .get('/api/scim/v2/Users')
          .query({ filter: `userName eq "lee@${domain}"` })
          .set(scim())
          .expect(200)
      ).text,
    );
    expect(found).toMatchObject({ totalResults: 1, Resources: [{ id: created.id }] });
    const byExternal = JSON.parse(
      (await http.get('/api/scim/v2/Users').query({ filter: 'externalId eq "okta-123"' }).set(scim()).expect(200)).text,
    );
    expect(byExternal.totalResults).toBe(1);
    await http.get('/api/scim/v2/Users').query({ filter: 'title co "x"' }).set(scim()).expect(400);

    // Azure-style PATCH: capitalised op, string boolean.
    const patched = JSON.parse(
      (
        await http
          .patch(`/api/scim/v2/Users/${created.id}`)
          .set(scim())
          .send(
            JSON.stringify({
              schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
              Operations: [
                { op: 'Replace', path: 'active', value: 'False' },
                { op: 'Replace', path: 'roles', value: [{ value: 'viewer', primary: true }] },
                { op: 'replace', value: { displayName: 'Lee P.' } },
              ],
            }),
          )
          .expect(200)
      ).text,
    );
    expect(patched).toMatchObject({ active: false, displayName: 'Lee P.', roles: [{ value: 'viewer' }] });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).disabledAt).not.toBeNull();

    const put = JSON.parse(
      (
        await http
          .put(`/api/scim/v2/Users/${created.id}`)
          .set(scim())
          .send(JSON.stringify({ ...body, userName: `lee.park@${domain}`, active: true }))
          .expect(200)
      ).text,
    );
    expect(put).toMatchObject({ userName: `lee.park@${domain}`, active: true, roles: [{ value: 'programmer' }] });

    await http.delete(`/api/scim/v2/Users/${created.id}`).set(scim()).expect(204);
    const after = JSON.parse((await http.get(`/api/scim/v2/Users/${created.id}`).set(scim()).expect(200)).text);
    expect(after.active).toBe(false);
    expect(
      await prisma.auditEvent.count({ where: { tenantId, action: { startsWith: 'scim.user_' }, entityId: created.id } }),
    ).toBeGreaterThanOrEqual(4);
  });

  it('cannot see or change another organization', async () => {
    const other = await register(`Scim other ${run}`, `admin@scim-other-${run}.example.com`);
    const foreignId = (await prisma.user.findFirstOrThrow({ where: { tenantId: other.tenantId } })).id;
    await http.get(`/api/scim/v2/Users/${foreignId}`).set(scim()).expect(404);
    await http.delete(`/api/scim/v2/Users/${foreignId}`).set(scim()).expect(404);
    const list = JSON.parse((await http.get('/api/scim/v2/Users').query({ count: 200 }).set(scim()).expect(200)).text);
    expect(list.Resources.every((u: { userName: string }) => u.userName.endsWith(domain))).toBe(true);
  });

  it('rotating the token stops the old one', async () => {
    const old = token;
    token = (await http.post('/api/scim/token').set(admin).expect(201)).body.token;
    await http
      .get('/api/scim/v2/Users')
      .set({ Authorization: `Bearer ${old}` })
      .expect(401);
    await http.get('/api/scim/v2/Users').set(scim()).expect(200);
    await http.delete('/api/scim/token').set(admin).expect(204);
    await http.get('/api/scim/v2/Users').set(scim()).expect(401);
  });
});

describe('plans and limits', () => {
  it('reports the plan and usage', async () => {
    const summary = (await http.get('/api/plan').set(admin).expect(200)).body;
    expect(summary.plan).toEqual({ code: 'enterprise', name: 'Enterprise' });
    expect(summary.limits).toMatchObject({ seats: null, sso: true, scim: true });
    expect(summary.usage.seats).toBeGreaterThan(1);
  });

  it('enforces seats, separately for interviewers, and counts only active members', async () => {
    const t = await register(`Free ${run}`, `admin@free-${run}.example.com`);
    await prisma.tenant.update({ where: { id: t.tenantId }, data: { plan: 'free' } });
    await addMember(t.auth, `a@free-${run}.example.com`).expect(201);
    await addMember(t.auth, `b@free-${run}.example.com`, 'VIEWER').expect(201);
    const full = await addMember(t.auth, `c@free-${run}.example.com`);
    expect(full.status).toBe(403);
    expect(full.body).toMatchObject({ code: 'PLAN_LIMIT', limit: 'seats' });
    // Interviewers have their own allowance.
    await addMember(t.auth, `i1@free-${run}.example.com`, 'INTERVIEWER').expect(201);
    // Disabling someone frees a seat; re-enabling them needs one.
    const b = (await prisma.user.findUniqueOrThrow({ where: { email: `b@free-${run}.example.com` } })).id;
    await http.patch(`/api/users/${b}`).set(t.auth).send({ disabled: true }).expect(200);
    await addMember(t.auth, `c@free-${run}.example.com`).expect(201);
    expect((await http.patch(`/api/users/${b}`).set(t.auth).send({ disabled: false })).status).toBe(403);
    // Features outside the plan.
    expect(
      (
        await http
          .put('/api/sso')
          .set(t.auth)
          .send(ssoConfig({ domains: [`free-${run}.example.com`] }))
      ).body.code,
    ).toBe('PLAN_LIMIT');
    expect((await http.post('/api/scim/token').set(t.auth)).status).toBe(403);
    const summary = (await http.get('/api/plan').set(t.auth).expect(200)).body;
    expect(summary).toMatchObject({ plan: { code: 'free' }, usage: { seats: 3, interviewers: 1 }, limits: { seats: 3, sso: false } });
  });

  it('limits live surveys and monthly completes', async () => {
    const t = await register(`Free2 ${run}`, `admin@free2-${run}.example.com`);
    await prisma.tenant.update({ where: { id: t.tenantId }, data: { plan: 'free' } });
    const pid = (await http.post('/api/projects').set(t.auth).send({ name: 'P' }).expect(201)).body.id;
    await http.post(`/api/projects/${pid}/vendors`).set(t.auth).send({ name: 'V', code: 'V1' }).expect(201);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = (
        await http
          .post(`/api/projects/${pid}/surveys`)
          .set(t.auth)
          .send({ name: `S${i}` })
          .expect(201)
      ).body.id;
      await http.put(`/api/surveys/${id}/draft`).set(t.auth).send({ definition: demo }).expect(200);
      ids.push(id);
    }
    await http.post(`/api/surveys/${ids[0]}/publish`).set(t.auth).expect(201);
    await http.post(`/api/surveys/${ids[1]}/publish`).set(t.auth).expect(201);
    const third = await http.post(`/api/surveys/${ids[2]}/publish`).set(t.auth);
    expect(third.status).toBe(403);
    expect(third.body.limit).toBe('liveSurveys');
    // Pausing one makes room; putting it live again is then refused.
    await http.post(`/api/surveys/${ids[1]}/status`).set(t.auth).send({ status: 'PAUSED' }).expect(201);
    await http.post(`/api/surveys/${ids[2]}/publish`).set(t.auth).expect(201);
    expect((await http.post(`/api/surveys/${ids[1]}/status`).set(t.auth).send({ status: 'LIVE' })).status).toBe(403);

    // A respondent resuming can finish; new respondents are turned away once the month's completes are used.
    const started = (
      await http
        .post(`/api/public/s/${ids[0]}/start`)
        .send({ query: { vid: 'V1', uid: 'R-1' } })
        .expect(200)
    ).body;
    expect(started.token).toBeDefined();
    const version = await prisma.surveyVersion.findFirstOrThrow({ where: { surveyId: ids[0], status: 'PUBLISHED' } });
    await prisma.response.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        tenantId: t.tenantId,
        surveyId: ids[0]!,
        versionId: version.id,
        uid: `bulk-${i}`,
        status: 'COMPLETE' as const,
        completedAt: new Date(),
        sessionTokenHash: `${run}-bulk-${i}`,
      })),
    });
    expect((await http.get('/api/plan').set(t.auth).expect(200)).body.usage.completesThisMonth).toBe(250);
    const turnedAway = (
      await http
        .post(`/api/public/s/${ids[0]}/start`)
        .send({ query: { vid: 'V1', uid: 'R-2' } })
        .expect(200)
    ).body;
    expect(turnedAway.token).toBeUndefined();
    expect(await prisma.response.count({ where: { surveyId: ids[0], uid: 'R-2' } })).toBe(0);
    const resumed = (
      await http
        .post(`/api/public/s/${ids[0]}/start`)
        .send({ query: { vid: 'V1', uid: 'R-1' } })
        .expect(200)
    ).body;
    expect(resumed.token).toBeDefined();
  });
});
