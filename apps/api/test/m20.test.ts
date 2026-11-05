/**
 * Milestone 20: security hardening. SSRF guard (IPv6 spellings of private addresses, DNS
 * rebinding), the sign-in redirect, account lockout, server-side sign-out, session algorithm
 * pinning, common passwords, security headers and production settings.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.LOGIN_RATE_PER_MINUTE = '100';
  process.env.LOGIN_MAX_FAILURES = '3';
  process.env.LOGIN_LOCK_MINUTES = '15';
});

import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { config, resetConfig } from '../src/config';
import { embeddedIpv4, guardedFetch, isBlockedAddressError, isPrivateAddress } from '../src/common/net-guard';
import { HttpDelivery } from '../src/integrations/http-delivery';
import { safeNext } from '../src/auth/sso.service';
import { isCommonPassword } from '../src/auth/password-policy';

const run = `m20${Date.now().toString(36)}`;
let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let target: Server;
let targetPort: number;
let hits = 0;
const password = 'correct-horse-battery';

async function register(tag: string) {
  const email = `${tag}-${run}@test.zapx`;
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${tag} ${run}`, name: 'Admin', email, password })
    .expect(201);
  return { email, token: reg.body.token as string };
}

beforeAll(async () => {
  target = createServer((_req, res) => {
    hits++;
    res.writeHead(200).end('ok');
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  targetPort = (target.address() as AddressInfo).port;
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
  await new Promise<void>((r) => (target ? target.close(() => r()) : r()));
});

describe('SSRF guard', () => {
  it('treats every IPv6 spelling of a private IPv4 address as private', () => {
    // What the URL parser makes of http://[::ffff:127.0.0.1]/ and http://[::ffff:169.254.169.254]/
    expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    for (const a of [
      '::ffff:7f00:1',
      '[::ffff:7f00:1]',
      '::ffff:a9fe:a9fe',
      '::ffff:127.0.0.1',
      '0:0:0:0:0:ffff:0a00:0001',
      '::127.0.0.1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b::10.0.0.1',
      '::ffff:0:7f00:1',
      '2002:7f00:1::',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      'fe80::1%eth0',
      'fec0::1',
      '::',
      'not-an-address',
    ])
      expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['8.8.8.8', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2606:4700:4700::1111'])
      expect(isPrivateAddress(a), a).toBe(false);
    expect(embeddedIpv4('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    expect(embeddedIpv4('2606:4700:4700::1111')).toBeNull();
  });

  it('refuses private addresses written literally and names that resolve to them, at connect time', async () => {
    const before = hits;
    for (const url of [`http://127.0.0.1:${targetPort}/`, `http://[::ffff:7f00:1]:${targetPort}/`, `http://localhost:${targetPort}/`]) {
      const err = await guardedFetch(url).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isBlockedAddressError(err), url).toBe(true);
    }
    expect(hits).toBe(before);
    // Development and tests can opt out.
    expect((await guardedFetch(`http://localhost:${targetPort}/`, { allowPrivate: true })).status).toBe(200);
    expect(hits).toBe(before + 1);
  });

  it('marks blocked callbacks as permanent failures without sending them', async () => {
    const prev = process.env.CALLBACK_ALLOW_PRIVATE_HOSTS;
    process.env.CALLBACK_ALLOW_PRIVATE_HOSTS = 'false';
    resetConfig();
    try {
      const before = hits;
      const delivery = new HttpDelivery();
      for (const url of [`http://[::ffff:127.0.0.1]:${targetPort}/cb`, `http://localhost:${targetPort}/cb`]) {
        const r = await delivery.send({ method: 'GET', url, headers: {} } as never);
        expect(r).toMatchObject({ httpStatus: null, permanent: true, error: 'blocked: callback host resolves to a private address' });
      }
      expect(hits).toBe(before);
    } finally {
      if (prev === undefined) delete process.env.CALLBACK_ALLOW_PRIVATE_HOSTS;
      else process.env.CALLBACK_ALLOW_PRIVATE_HOSTS = prev;
      resetConfig();
    }
  });
});

describe('sign-in redirect', () => {
  it('only follows paths on this site', () => {
    for (const ok of ['/', '/surveys/abc?tab=2#top', '/a/b']) expect(safeNext(ok)).toBe(ok);
    for (const bad of [
      '//evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/ /evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/ /evil.example',
      `/${'a'.repeat(600)}`,
      42,
      undefined,
    ])
      expect(safeNext(bad), JSON.stringify(bad)).toBe('/');
  });
});

describe('account lockout', () => {
  it('locks an account after repeated wrong passwords, even for the right password, and unlocks later', async () => {
    const { email } = await register('lock');
    for (let i = 0; i < 2; i++) await http.post('/api/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    // A correct sign-in before the limit resets the count.
    await http.post('/api/auth/login').send({ email, password }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).failedLogins).toBe(0);

    for (let i = 0; i < 3; i++) await http.post('/api/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    const locked = await http.post('/api/auth/login').send({ email, password }).expect(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await prisma.auditEvent.count({ where: { tenantId: u.tenantId, action: 'auth.locked' } })).toBe(1);

    await prisma.user.update({ where: { email }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await http.post('/api/auth/login').send({ email, password }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).lockedUntil).toBeNull();
  });

  it('gives unknown emails the ordinary answer', async () => {
    for (let i = 0; i < 4; i++)
      await http
        .post('/api/auth/login')
        .send({ email: `nobody-${run}@test.zapx`, password: 'x' })
        .expect(401);
  });
});

describe('sessions', () => {
  it('signing out ends the session on the server, not only in the browser', async () => {
    const { email } = await register('logout');
    const login = await http.post('/api/auth/login').send({ email, password }).expect(200);
    const bearer = { Authorization: `Bearer ${login.body.token}` };
    await http.get('/api/auth/me').set(bearer).expect(200);
    await http.post('/api/auth/logout').set(bearer).expect(204);
    await http.get('/api/auth/me').set(bearer).expect(401);

    // The cookie session too: a copied cookie is useless after sign-out.
    const set = (await http.post('/api/auth/login').send({ email, password }).expect(200)).headers['set-cookie'] as unknown as string[];
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    await http.get('/api/auth/me').set('Cookie', cookie).expect(200);
    await http.post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await http.get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('"sign out everywhere" ends every session of that member only', async () => {
    const { email, token: first } = await register('everywhere');
    const other = await register('bystander');
    await new Promise((r) => setTimeout(r, 1100)); // session times have one-second resolution
    const second = (await http.post('/api/auth/login').send({ email, password }).expect(200)).body.token as string;
    await http.post('/api/auth/logout-all').set('Authorization', `Bearer ${second}`).expect(204);
    for (const t of [first, second]) await http.get('/api/auth/me').set('Authorization', `Bearer ${t}`).expect(401);
    await http.get('/api/auth/me').set('Authorization', `Bearer ${other.token}`).expect(200);
    await new Promise((r) => setTimeout(r, 1100));
    await http.post('/api/auth/login').send({ email, password }).expect(200);
  });

  it('refuses session tokens signed with another algorithm or none', async () => {
    const { token } = await register('alg');
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    const jwt = app.get(JwtService);
    const hs512 = await jwt.signAsync({ sub: payload.sub, tid: payload.tid }, { algorithm: 'HS512' });
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: payload.sub, tid: payload.tid, exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    for (const t of [hs512, none]) await http.get('/api/auth/me').set('Authorization', `Bearer ${t}`).expect(401);
    await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  });
});

describe('passwords', () => {
  it('refuses common and patterned passwords', async () => {
    for (const p of ['password123', 'Password123', '1234567890', 'aaaaaaaaaaaa', 'abcabcabcabc', 'abcdefghijk', 'zapx-admin-123'])
      expect(isCommonPassword(p), p).toBe(true);
    for (const p of [password, 'member-password-1', 'Tr0ub4dor&3-horse']) expect(isCommonPassword(p), p).toBe(false);
    const res = await http
      .post('/api/auth/register')
      .send({ organization: `Weak ${run}`, name: 'A', email: `weak-${run}@test.zapx`, password: 'password123' })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('too common');
  });
});

describe('security headers', () => {
  it('sends a locked-down policy on every API response', async () => {
    const res = await http.get('/api/health').expect(200);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('production settings', () => {
  it('refuses to start with settings that are only safe in development', () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, {
        NODE_ENV: 'production',
        JWT_SECRET: 'dev-only-secret-change-me-0123456789abcdef',
        SECRETS_KEY: 'dev-only-secret-change-me-0123456789abcdef',
        COOKIE_SECURE: 'false',
        CALLBACK_ALLOW_PRIVATE_HOSTS: 'false',
        SSO_ALLOW_INSECURE_ISSUER: 'false',
      });
      resetConfig();
      expect(() => config()).toThrow(/COOKIE_SECURE.*JWT_SECRET.*SECRETS_KEY/);
      Object.assign(process.env, {
        JWT_SECRET: 'a'.repeat(16) + 'b'.repeat(32),
        SECRETS_KEY: 'c'.repeat(48),
        SIGNING_KEYS_SECRET: 'd'.repeat(48),
        COOKIE_SECURE: 'true',
      });
      resetConfig();
      expect(config().COOKIE_SECURE).toBe(true);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      resetConfig();
    }
  });
});
