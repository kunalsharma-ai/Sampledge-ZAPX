/**
 * Quantum Design System: personal appearance preferences and the organization default.
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
import { DEFAULT_APPEARANCE } from '@zapx/quantum';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';

const run = `q${Date.now().toString(36)}`;
let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let programmer: Record<string, string>;
let otherAdmin: Record<string, string>;
let tenantId: string;

async function register(tag: string) {
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${tag} ${run}`, name: 'Admin', email: `${tag}-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  return { Authorization: `Bearer ${reg.body.token as string}` };
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  admin = await register('a');
  otherAdmin = await register('b');
  tenantId = (await http.get('/api/auth/me').set(admin).expect(200)).body.tenant.id;
  const email = `p-${run}@test.zapx`;
  await http.post('/api/users').set(admin).send({ name: 'P', email, password: 'programmer-pass-1', role: 'PROGRAMMER' }).expect(201);
  const login = await http.post('/api/auth/login').send({ email, password: 'programmer-pass-1' }).expect(200);
  programmer = { Authorization: `Bearer ${login.body.token as string}` };
});

afterAll(async () => {
  await app?.close();
});

describe('appearance preferences', () => {
  it('starts empty, then saves and returns a member’s own appearance', async () => {
    const empty = await http.get('/api/me/preferences').set(programmer).expect(200);
    expect(empty.body).toEqual({ appearance: null, organizationDefault: null });

    const mine = { ...DEFAULT_APPEARANCE, preset: 'cyber-pulse', mode: 'dark', density: 'compact', accent: '#FF0066' };
    const saved = await http.put('/api/me/preferences').set(programmer).send({ appearance: mine }).expect(200);
    expect(saved.body.appearance).toMatchObject({ preset: 'cyber-pulse', density: 'compact', accent: '#ff0066' });
    const again = await http.get('/api/me/preferences').set(programmer).expect(200);
    expect(again.body.appearance.preset).toBe('cyber-pulse');
    // Another member of the same organization is unaffected.
    expect((await http.get('/api/me/preferences').set(admin).expect(200)).body.appearance).toBeNull();
  });

  it('rejects invalid settings with the reasons', async () => {
    const res = await http
      .put('/api/me/preferences')
      .set(programmer)
      .send({ appearance: { preset: 'neon-overload', glass: 400, script: '<x>' } })
      .expect(400);
    const messages = (res.body.issues as Array<{ message: string }>).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining(['preset is not a known theme', 'glass must be a number from 0 to 100', 'Unknown setting: script']),
    );
    await http.put('/api/me/preferences').set(programmer).send({}).expect(400);
  });

  it('lets only admins set the organization default, and only for their organization', async () => {
    const org = { ...DEFAULT_APPEARANCE, preset: 'minimal-executive', mode: 'light' };
    await http.put('/api/tenant/appearance').set(programmer).send({ appearance: org }).expect(403);
    await http.put('/api/tenant/appearance').set(admin).send({ appearance: org }).expect(200);

    const p = await http.get('/api/me/preferences').set(programmer).expect(200);
    expect(p.body.organizationDefault.preset).toBe('minimal-executive');
    expect((await http.get('/api/me/preferences').set(otherAdmin).expect(200)).body.organizationDefault).toBeNull();

    const audit = await prisma.auditEvent.findFirst({ where: { tenantId, action: 'tenant.appearance_default_set' } });
    expect(audit?.data).toMatchObject({ preset: 'minimal-executive' });
  });

  it('resets a member to the organization default, and clears the default', async () => {
    await http.delete('/api/me/preferences/appearance').set(programmer).expect(204);
    const p = await http.get('/api/me/preferences').set(programmer).expect(200);
    expect(p.body.appearance).toBeNull();
    expect(p.body.organizationDefault.preset).toBe('minimal-executive');
    await http.delete('/api/tenant/appearance').set(admin).expect(204);
    expect((await http.get('/api/me/preferences').set(programmer).expect(200)).body.organizationDefault).toBeNull();
  });
});
