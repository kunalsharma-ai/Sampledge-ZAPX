/**
 * Security fixes from the maintainer handbook review: the vendor shared secret only for roles that
 * can edit vendors, changing one's own password, administrator reset links and "forgot password".
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.LOGIN_RATE_PER_MINUTE = '100';
  process.env.EMAIL_PROVIDER = 'sendgrid';
  process.env.SENDGRID_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'noreply@test.zapx';
  // Replaced with the local stand-in's address in beforeAll (config is read lazily).
  process.env.SENDGRID_API_BASE = 'http://127.0.0.1:9';
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { resetConfig } from '../src/config';
import { tokenHash } from '../src/auth/password-reset.service';

const run = `sec${Date.now().toString(36)}`;
const password = 'correct-horse-battery';
let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let mailServer: Server;
const mails: Array<{ to: string; text: string }> = [];

let members = 0;
async function member(role: 'PROGRAMMER' | 'VIEWER' | 'ADMIN') {
  const email = `${role.toLowerCase()}${++members}-${run}@test.zapx`;
  const created = (
    await http
      .post('/api/users')
      .set(admin)
      .send({ name: `${role} ${members}`, email, password, role })
      .expect(201)
  ).body;
  const login = await http.post('/api/auth/login').send({ email, password }).expect(200);
  return { id: created.id as string, email, headers: { Authorization: `Bearer ${login.body.token}` } };
}

const linkToken = (text: string) => /reset-password\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1];

beforeAll(async () => {
  mailServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = JSON.parse(body) as { personalizations: Array<{ to: Array<{ email: string }> }>; content: Array<{ value: string }> };
      mails.push({ to: m.personalizations[0].to[0].email, text: m.content[0].value });
      res.writeHead(202).end();
    });
  });
  await new Promise<void>((r) => mailServer.listen(0, '127.0.0.1', r));
  process.env.SENDGRID_API_BASE = `http://127.0.0.1:${(mailServer.address() as AddressInfo).port}`;
  resetConfig();
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
});

afterAll(async () => {
  await app?.close();
  await new Promise<void>((r) => (mailServer ? mailServer.close(() => r()) : r()));
});

describe('vendor shared secret', () => {
  it('is returned to admins and programmers but not to viewers', async () => {
    const projectId = (await http.post('/api/projects').set(admin).send({ name: 'Secrets' }).expect(201)).body.id as string;
    const created = (await http.post(`/api/projects/${projectId}/vendors`).set(admin).send({ name: 'Panel', code: 'SX' }).expect(201)).body;
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/);

    const programmer = await member('PROGRAMMER');
    const viewer = await member('VIEWER');
    const asProgrammer = (await http.get(`/api/vendors/${created.id}`).set(programmer.headers).expect(200)).body;
    expect(asProgrammer.secret).toBe(created.secret);

    const one = (await http.get(`/api/vendors/${created.id}`).set(viewer.headers).expect(200)).body;
    const list = (await http.get(`/api/projects/${projectId}/vendors`).set(viewer.headers).expect(200)).body;
    for (const v of [one, list[0]]) {
      expect(v.code).toBe('SX');
      expect(v).not.toHaveProperty('secret');
      expect(v).not.toHaveProperty('partnerSecretEnc');
      expect(JSON.stringify(v)).not.toContain(created.secret);
    }
    // Rotating stays an editor's action.
    await http.post(`/api/vendors/${created.id}/rotate-secret`).set(viewer.headers).expect(403);
  });
});

describe('change my password', () => {
  it('needs the current password, signs out other sessions and keeps this one', async () => {
    const m = await member('PROGRAMMER');
    const other = await http.post('/api/auth/login').send({ email: m.email, password }).expect(200);
    const otherHeaders = { Authorization: `Bearer ${other.body.token}` };

    await http
      .post('/api/auth/change-password')
      .set(m.headers)
      .send({ currentPassword: 'wrong-password-1', newPassword: 'new-password-xyz' })
      .expect(400);
    await http.post('/api/auth/change-password').set(m.headers).send({ currentPassword: password, newPassword: 'password123' }).expect(400);
    await http.post('/api/auth/change-password').set(m.headers).send({ currentPassword: password, newPassword: password }).expect(400);

    const res = await http
      .post('/api/auth/change-password')
      .set(m.headers)
      .send({ currentPassword: password, newPassword: 'new-password-xyz' })
      .expect(200);
    const cookie = res.headers['set-cookie'] as unknown as string[];
    expect(cookie.some((c) => c.startsWith('zapx_token='))).toBe(true);

    // The session that made the change was issued before it, so it is signed out with the others;
    // the new cookie keeps the member signed in.
    await http.get('/api/auth/me').set(otherHeaders).expect(401);
    await http.get('/api/auth/me').set('Cookie', cookie).expect(200);

    await http.post('/api/auth/login').send({ email: m.email, password }).expect(401);
    await http.post('/api/auth/login').send({ email: m.email, password: 'new-password-xyz' }).expect(200);
    expect(await prisma.auditEvent.count({ where: { action: 'auth.password_change', entityId: m.id } })).toBe(1);
  });
});

describe('administrator reset link', () => {
  it('is admin-only, works once, emails the member and clears a lockout', async () => {
    const m = await member('VIEWER');
    const viewer = await member('VIEWER');
    await http.post(`/api/users/${m.id}/password-reset`).set(viewer.headers).expect(403);

    await prisma.user.update({ where: { id: m.id }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    const before = mails.length;
    const first = (await http.post(`/api/users/${m.id}/password-reset`).set(admin).expect(201)).body;
    const second = (await http.post(`/api/users/${m.id}/password-reset`).set(admin).expect(201)).body;
    expect(second.emailed).toBe(true);
    expect(mails.length).toBe(before + 2);
    expect(mails.at(-1)!.to).toBe(m.email);
    expect(linkToken(mails.at(-1)!.text)).toBe(linkToken(second.url));

    // Only the hash is stored.
    const token = linkToken(second.url)!;
    const row = await prisma.passwordReset.findUniqueOrThrow({ where: { tokenHash: tokenHash(token) } });
    expect(JSON.stringify(row)).not.toContain(token);

    // A newer link voids the older one.
    await http
      .post('/api/auth/reset-password')
      .send({ token: linkToken(first.url), password: 'reset-password-1' })
      .expect(400);
    await http.post('/api/auth/reset-password').send({ token, password: 'password123' }).expect(400);
    await http.post('/api/auth/reset-password').send({ token, password: 'reset-password-1' }).expect(204);
    await http.post('/api/auth/reset-password').send({ token, password: 'reset-password-2' }).expect(400);

    await http.get('/api/auth/me').set(m.headers).expect(401); // old sessions signed out
    await http.post('/api/auth/login').send({ email: m.email, password: 'reset-password-1' }).expect(200); // lock cleared
  });

  it('refuses expired links and disabled members', async () => {
    const m = await member('PROGRAMMER');
    const { url } = (await http.post(`/api/users/${m.id}/password-reset`).set(admin).expect(201)).body;
    await prisma.passwordReset.updateMany({ where: { userId: m.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http
      .post('/api/auth/reset-password')
      .send({ token: linkToken(url), password: 'reset-password-3' })
      .expect(400);

    await http.patch(`/api/users/${m.id}`).set(admin).send({ disabled: true }).expect(200);
    await http.post(`/api/users/${m.id}/password-reset`).set(admin).expect(400);
  });
});

describe('forgot password', () => {
  it('answers the same for unknown and known emails and emails a link only to members', async () => {
    const m = await member('PROGRAMMER');
    const before = mails.length;
    await http
      .post('/api/auth/forgot-password')
      .send({ email: `nobody-${run}@test.zapx` })
      .expect(204);
    expect(mails.length).toBe(before);

    await http.post('/api/auth/forgot-password').send({ email: m.email }).expect(204);
    expect(mails.length).toBe(before + 1);
    // Asking again right away does not send another email.
    await http.post('/api/auth/forgot-password').send({ email: m.email }).expect(204);
    expect(mails.length).toBe(before + 1);

    const token = linkToken(mails.at(-1)!.text)!;
    await http.post('/api/auth/reset-password').send({ token, password: 'forgot-password-1' }).expect(204);
    await http.post('/api/auth/login').send({ email: m.email, password: 'forgot-password-1' }).expect(200);
    expect((await http.get('/api/auth/password-options').expect(200)).body).toEqual({ forgotPasswordEmail: true });
  });
});

describe('AWS app secret', () => {
  const infra = (f: string) => readFileSync(join(__dirname, '../../../infra/terraform', f), 'utf8');
  const keys = JSON.parse(/variable "app_secret_keys"[\s\S]*?default\s*=\s*(\[[^\]]*\])/.exec(infra('variables.tf'))![1]) as string[];

  it('lists every secret setting of the API', () => {
    for (const k of [
      'JWT_SECRET',
      'SECRETS_KEY',
      'ANTHROPIC_API_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'IPINFO_TOKEN',
      'DEEPGRAM_API_KEY',
      'TWILIO_AUTH_TOKEN',
      'SENDGRID_API_KEY',
    ])
      expect(keys).toContain(k);
  });

  it('matches the example secret JSON in the Terraform README, so the first release can start', () => {
    const json = /--secret-string '(\{[\s\S]*?\})'/.exec(infra('README.md'))![1];
    const documented = Object.keys(JSON.parse(json));
    for (const k of keys) expect(documented).toContain(k);
  });
});
