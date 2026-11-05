/**
 * Super admin: a platform-level role above organization administrators. Registers organizations,
 * manages plans and their features for the web CRM and the mobile app, switches features per
 * organization and per member, suspends organizations, sees every organization's activity and
 * integrations, and runs subscription automation. Feature changes apply on the next request.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.PLATFORM_AUTOMATION = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
});

import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { hash } from 'bcryptjs';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { FEATURE_KEYS, featureForRoute, resolveEntitlements } from '../src/super-admin/features';

const run = `sa${Date.now().toString(36)}`;
const PLAN = `t-${run}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let superAdmin: Record<string, string>;
let admin: Record<string, string>;
let tenantId: string;
let adminId: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const mobile = { 'X-ZAPX-Client': 'mobile' };

async function register(label: string) {
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${label} ${run}`, name: 'Admin', email: `${label}-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  const me = await http.get('/api/auth/me').set(bearer(reg.body.token)).expect(200);
  return { headers: bearer(reg.body.token), tenantId: me.body.tenant.id as string, userId: me.body.id as string };
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);

  const t = await prisma.tenant.create({ data: { name: `Operator ${run}` } });
  await prisma.user.create({
    data: {
      tenantId: t.id,
      email: `super-${run}@test.zapx`,
      name: 'Super',
      role: 'ADMIN',
      superAdmin: true,
      passwordHash: await hash('super-password-1', 4),
    },
  });
  superAdmin = bearer(
    (
      await http
        .post('/api/auth/login')
        .send({ email: `super-${run}@test.zapx`, password: 'super-password-1' })
        .expect(200)
    ).body.token,
  );
  const a = await register('customer');
  admin = a.headers;
  tenantId = a.tenantId;
  adminId = a.userId;
});

afterAll(async () => {
  if (prisma) {
    await prisma.platformAutomation.deleteMany({ where: { name: { contains: run } } });
    await prisma.tenant.updateMany({ where: { plan: PLAN }, data: { plan: 'enterprise' } });
    await prisma.subscriptionPlan.deleteMany({ where: { code: PLAN } });
  }
  await app?.close();
});

describe('feature rules', () => {
  it('maps routes to features, writes and reads separately', () => {
    expect(featureForRoute('GET', '/api/surveys/:id/analysis/variables')).toBe('analysis');
    expect(featureForRoute('POST', '/api/surveys/:id/analysis/assistant')).toBe('ai_assist');
    expect(featureForRoute('GET', '/api/surveys/:id')).toBe('surveys.view');
    expect(featureForRoute('PUT', '/api/surveys/:id/draft')).toBe('surveys.edit');
    expect(featureForRoute('POST', '/api/surveys/:id/publish')).toBe('surveys.publish');
    expect(featureForRoute('POST', '/api/cati/cases/:id/dial')).toBe('calls');
    expect(featureForRoute('GET', '/api/cati/surveys')).toBe('cati');
    expect(featureForRoute('POST', '/api/auth/login')).toBeNull();
    expect(featureForRoute('GET', '/api/public/r/:token')).toBeNull();
  });

  it('organization overrides add or remove; a member can only lose; edit needs view', () => {
    const plan = { code: 'x', webFeatures: ['dashboard', 'surveys.view', 'surveys.edit'], mobileFeatures: [] };
    const e = resolveEntitlements({
      surface: 'web',
      plan,
      tenant: { suspendedAt: null, featureOverrides: { web: { analysis: true, 'surveys.view': false } } },
      user: { superAdmin: false, mobileAccess: true, featureOverrides: { web: { dashboard: false, team: true } } },
    });
    expect(e.features).toMatchObject({ analysis: true, dashboard: false, 'surveys.view': false, 'surveys.edit': false, team: false });
    expect(Object.keys(e.features).sort()).toEqual([...FEATURE_KEYS].sort());
  });
});

describe('access to the console', () => {
  it('only a signed-in super admin; never an organization admin or an API key', async () => {
    expect((await http.get('/api/auth/me').set(superAdmin).expect(200)).body.superAdmin).toBe(true);
    expect((await http.get('/api/auth/me').set(admin).expect(200)).body.superAdmin).toBe(false);
    await http.get('/api/super/overview').set(superAdmin).expect(200);
    const denied = await http.get('/api/super/organizations').set(admin).expect(403);
    expect(denied.body.code).toBe('SUPER_ADMIN_ONLY');
    const key = (await http.post('/api/api-keys').set(superAdmin).send({ name: 'k', role: 'PROGRAMMER' }).expect(201)).body.key;
    await http.get('/api/super/overview').set(bearer(key)).expect(403);
    await http.get('/api/super/overview').expect(401);
  });

  it('the super admin also manages the platform integrations', async () => {
    const r = await http.get('/api/super/integrations').set(superAdmin).expect(200);
    expect(r.body.platform.map((p: { key: string }) => p.key)).toContain('anthropic');
    expect(r.body.organizations.find((o: { id: string }) => o.id === tenantId)).toMatchObject({ allowed: { webhooks: true } });
  });
});

describe('registering organizations', () => {
  it('creates the organization and its administrator with a setup link, audited in that organization', async () => {
    const r = await http
      .post('/api/super/organizations')
      .set(superAdmin)
      .send({
        organization: `New ${run}`,
        adminName: 'Ada',
        adminEmail: `ada-${run}@test.zapx`,
        plan: 'team',
        subscriptionStatus: 'trialing',
      })
      .expect(201);
    expect(r.body.setup.url).toMatch(/\/reset-password\?token=/);
    const org = await prisma.tenant.findUniqueOrThrow({ where: { id: r.body.organization.id } });
    expect(org).toMatchObject({ plan: 'team', subscriptionStatus: 'trialing' });
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: org.id, action: 'super.organization_created' } });
    expect(ev.data).toMatchObject({ admin: `ada-${run}@test.zapx` });
    await http
      .post('/api/super/organizations')
      .set(superAdmin)
      .send({ organization: 'Dup', adminName: 'Ada', adminEmail: `ada-${run}@test.zapx`, plan: 'team' })
      .expect(409);
  });
});

describe('features follow the plan, the organization and the member', () => {
  it('a plan change applies on the next request, separately for web and mobile', async () => {
    await http
      .post('/api/super/plans')
      .set(superAdmin)
      .send({
        code: PLAN,
        name: 'Test plan',
        limits: { seats: 10, interviewers: 5, liveSurveys: 5, completesPerMonth: 100, sso: false, scim: false },
        webFeatures: ['dashboard', 'projects', 'team'],
        mobileFeatures: ['projects'],
      })
      .expect(201);
    await http.patch(`/api/super/organizations/${tenantId}`).set(superAdmin).send({ plan: PLAN }).expect(200);

    await http.get('/api/dashboard').set(admin).expect(200);
    const off = await http.get('/api/dashboard').set(admin).set(mobile).expect(403);
    expect(off.body).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'dashboard' });
    const audit = await http.get('/api/audit').set(admin).expect(403);
    expect(audit.body.feature).toBe('audit_log');
    expect((await http.get('/api/plan').set(admin).expect(200)).body.limits.seats).toBe(10);

    const web = (await http.get('/api/me/entitlements?surface=web').set(admin).expect(200)).body;
    expect(web).toMatchObject({ plan: PLAN, surface: 'web', features: { dashboard: true, analysis: false } });
    const mob = (await http.get('/api/me/entitlements').set(admin).set(mobile).expect(200)).body;
    expect(mob).toMatchObject({ surface: 'mobile', features: { dashboard: false, projects: true } });
  });

  it('ETag and 304 until something changes', async () => {
    const first = await http.get('/api/me/entitlements?surface=web').set(admin).expect(200);
    await http.get('/api/me/entitlements?surface=web').set(admin).set('If-None-Match', first.headers.etag).expect(304);
    await http
      .patch(`/api/super/organizations/${tenantId}/features`)
      .set(superAdmin)
      .send({ feature: 'analysis', surface: 'web', on: true })
      .expect(200);
    const after = await http.get('/api/me/entitlements?surface=web').set(admin).set('If-None-Match', first.headers.etag).expect(200);
    expect(after.body.features.analysis).toBe(true);
  });

  it('organization overrides and member overrides', async () => {
    await http
      .put(`/api/super/organizations/${tenantId}/features`)
      .set(superAdmin)
      .send({ web: { team: false, library: true } })
      .expect(200);
    await http.get('/api/users').set(admin).expect(403);
    await http.get('/api/library').set(admin).expect(200);
    await http
      .patch(`/api/super/users/${adminId}`)
      .set(superAdmin)
      .send({ featureOverrides: { web: { library: false, analysis: true } } })
      .expect(200);
    await http.get('/api/library').set(admin).expect(403);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(u.featureOverrides).toEqual({ web: { library: false } });
    await http.patch(`/api/super/users/${adminId}`).set(superAdmin).send({ featureOverrides: {} }).expect(200);
    await http.put(`/api/super/organizations/${tenantId}/features`).set(superAdmin).send({}).expect(200);
    await http.get('/api/users').set(admin).expect(200);
  });

  it('the mobile app can be switched off for one member', async () => {
    await http.patch(`/api/super/users/${adminId}`).set(superAdmin).send({ mobileAccess: false }).expect(200);
    const r = await http.get('/api/projects').set(admin).set(mobile).expect(403);
    expect(r.body.code).toBe('MOBILE_DISABLED');
    expect((await http.get('/api/me/entitlements').set(admin).set(mobile).expect(200)).body).toMatchObject({
      surfaceAllowed: false,
      features: { projects: false },
    });
    await http.get('/api/projects').set(admin).expect(200);
    await http.patch(`/api/super/users/${adminId}`).set(superAdmin).send({ mobileAccess: true }).expect(200);
  });

  it('streams changes as server-sent events', async () => {
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/me/entitlements/stream?surface=web`, { headers: admin, signal: ctl.signal });
    const reader = res.body!.getReader();
    const events: Array<{ features: Record<string, boolean> }> = [];
    let buf = '';
    const readUntil = async (n: number) => {
      while (events.length < n) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        for (const m of buf.matchAll(/event: entitlements\nid: .*\ndata: (.*)\n\n/g)) events.push(JSON.parse(m[1]!));
        buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
      }
    };
    await readUntil(1);
    expect(events[0]!.features.projects).toBe(true);
    await http
      .patch(`/api/super/organizations/${tenantId}/features`)
      .set(superAdmin)
      .send({ feature: 'projects', surface: 'web', on: false })
      .expect(200);
    await readUntil(2);
    expect(events[1]!.features.projects).toBe(false);
    ctl.abort();
    await http
      .patch(`/api/super/organizations/${tenantId}/features`)
      .set(superAdmin)
      .send({ feature: 'projects', surface: 'web', on: null })
      .expect(200);
  });
});

describe('suspending', () => {
  it('blocks every feature and sign-in, keeps /auth/me, and reactivates', async () => {
    await http.post(`/api/super/organizations/${tenantId}/suspend`).set(superAdmin).send({ reason: 'Unpaid' }).expect(204);
    expect((await http.get('/api/projects').set(admin).expect(403)).body.code).toBe('ORG_SUSPENDED');
    expect((await http.get('/api/me/entitlements').set(admin).expect(200)).body.suspended).toBe(true);
    await http.get('/api/auth/me').set(admin).expect(200);
    const login = await http
      .post('/api/auth/login')
      .send({ email: `customer-${run}@test.zapx`, password: 'correct-horse-battery' })
      .expect(403);
    expect(login.body.code).toBe('ORG_SUSPENDED');
    await http.post(`/api/super/organizations/${tenantId}/reactivate`).set(superAdmin).expect(204);
    await http.get('/api/projects').set(admin).expect(200);
  });
});

describe('activity', () => {
  it('shows actions of every organization with who did them', async () => {
    await http
      .post('/api/projects')
      .set(admin)
      .send({ name: `P ${run}` })
      .expect(201);
    const r = await http.get(`/api/super/activity?tenantId=${tenantId}&limit=50`).set(superAdmin).expect(200);
    const actions = r.body.events.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['project.create', 'super.organization_suspended', 'super.features_changed']));
    const ev = r.body.events.find((e: { action: string }) => e.action === 'project.create');
    expect(ev.actor.email).toBe(`customer-${run}@test.zapx`);
  });
});

describe('automation', () => {
  it('expires and suspends an organization whose subscription ended, once', async () => {
    const o = await register('ending');
    await http
      .patch(`/api/super/organizations/${o.tenantId}`)
      .set(superAdmin)
      .send({ subscriptionEndsAt: new Date(Date.now() - 60_000).toISOString(), subscriptionStatus: 'active' })
      .expect(200);
    const vocab = (await http.get('/api/super/automation/vocabulary').set(superAdmin).expect(200)).body;
    const tpl = vocab.templates.find((t: { id: string }) => t.id === 'expire-and-suspend').rule;
    const rule = (
      await http
        .post('/api/super/automation/rules')
        .set(superAdmin)
        .send({ ...tpl, name: `Expire ${run}` })
        .expect(201)
    ).body;

    const preview = (await http.get(`/api/super/automation/rules/${rule.id}/preview`).set(superAdmin).expect(200)).body;
    expect(preview.organizations.map((x: { id: string }) => x.id)).toContain(o.tenantId);

    const first = (await http.post(`/api/super/automation/run?rule=${rule.id}`).set(superAdmin).expect(200)).body;
    expect(first.fired).toBeGreaterThanOrEqual(1);
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: o.tenantId } });
    expect(t.subscriptionStatus).toBe('expired');
    expect(t.suspendedAt).not.toBeNull();
    await http.get('/api/projects').set(o.headers).expect(403);

    // The same firing never runs twice.
    await prisma.tenant.update({ where: { id: o.tenantId }, data: { suspendedAt: null, subscriptionStatus: 'active' } });
    await http.post(`/api/super/automation/run?rule=${rule.id}`).set(superAdmin).expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: o.tenantId } })).suspendedAt).toBeNull();
    const runs = (await http.get(`/api/super/automation/runs?rule=${rule.id}`).set(superAdmin).expect(200)).body;
    expect(runs.filter((r: { organization: { id: string } }) => r.organization.id === o.tenantId)).toHaveLength(1);
    const notes = await prisma.notification.count({ where: { body: { contains: `Org ending ${run}` } } });
    expect(notes).toBeGreaterThanOrEqual(1);
  });

  it('refuses rules with unknown triggers or features', async () => {
    await http.post('/api/super/automation/rules').set(superAdmin).send({ name: 'x', trigger: 'nope', actions: [] }).expect(400);
    await http
      .post('/api/super/automation/rules')
      .set(superAdmin)
      .send({ name: 'x', trigger: 'seats_full', actions: [{ type: 'set_feature', feature: 'nope', on: true }] })
      .expect(400);
  });
});
