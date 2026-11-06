/**
 * Security review findings S4 to S9 (docs/handbook/SECURITY_REVIEW.md): rate-limit counters shared
 * by every API process, separate signing keys, no session token in browser response bodies, the lint
 * security rules and row-level security on more personal-data tables. S6 (studio script nonce) is
 * covered by the milestone 20 browser test.
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { DbThrottlerStorage, throttleStore } from '../src/common/db-throttler-storage';
import { PrismaService } from '../src/common/prisma.service';
import { signingKey } from '../src/common/signing-keys';
import { config, resetConfig } from '../src/config';
import { testSignature } from '../src/interview/interview.service';

const run = `hard${Date.now().toString(36)}`;
const password = 'correct-horse-battery';
let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    resetConfig();
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    resetConfig();
  }
}

beforeAll(async () => {
  resetConfig();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE ${`test-${run}%`}`;
  await app?.close();
});

describe('S4: shared rate-limit store', () => {
  it('is the database in production and memory elsewhere, unless THROTTLE_STORE says otherwise', () => {
    expect(withEnv({ NODE_ENV: 'test', THROTTLE_STORE: undefined }, throttleStore)).toBe('memory');
    expect(
      withEnv(
        {
          NODE_ENV: 'production',
          THROTTLE_STORE: undefined,
          JWT_SECRET: 'a'.repeat(48),
          SECRETS_KEY: 'b'.repeat(48),
          SIGNING_KEYS_SECRET: 'c'.repeat(48),
          COOKIE_SECURE: 'true',
        },
        throttleStore,
      ),
    ).toBe('database');
    expect(withEnv({ THROTTLE_STORE: 'database' }, throttleStore)).toBe('database');
  });

  it('counts hits from every process against one limit and blocks above it', async () => {
    // Two storages stand for two API tasks sharing the database.
    const a = new DbThrottlerStorage(prisma);
    const b = new DbThrottlerStorage(prisma);
    const key = `test-${run}-shared`;
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push(await (i % 2 ? b : a).increment(key, 60_000, 3, 30_000, 'default'));
    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3]);
    expect(hits.every((h) => !h.isBlocked)).toBe(true);
    expect(hits[0]!.timeToExpire).toBeGreaterThan(55);

    const fourth = await b.increment(key, 60_000, 3, 30_000, 'default');
    expect(fourth.isBlocked).toBe(true);
    expect(fourth.timeToBlockExpire).toBeGreaterThan(25);
    // While blocked, more hits are refused and not counted.
    const fifth = await a.increment(key, 60_000, 3, 30_000, 'default');
    expect(fifth).toMatchObject({ isBlocked: true, totalHits: 4 });
  });

  it('starts a new window once the old one ends, and sweeps finished counters', async () => {
    const s = new DbThrottlerStorage(prisma);
    const key = `test-${run}-window`;
    await s.increment(key, 60_000, 5, 60_000, 'default');
    await s.increment(key, 60_000, 5, 60_000, 'default');
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "windowEnds" = now() - interval '2 minutes' WHERE "key" = ${`default:${key}`}`;
    expect((await s.increment(key, 60_000, 5, 60_000, 'default')).totalHits).toBe(1);

    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "windowEnds" = now() - interval '2 minutes' WHERE "key" = ${`default:${key}`}`;
    expect(await s.sweep()).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitBucket.count({ where: { key: `default:${key}` } })).toBe(0);
  });
});

describe('S5: signing keys separate from JWT_SECRET', () => {
  it('derives every key from JWT_SECRET as before while SIGNING_KEYS_SECRET is unset', () => {
    withEnv({ SIGNING_KEYS_SECRET: undefined }, () => {
      expect(signingKey('test-link', (legacy) => legacy)).toBe(config().JWT_SECRET);
    });
  });

  it('keeps test links valid when JWT_SECRET is rotated, once SIGNING_KEYS_SECRET is set', () => {
    const keys = 'k'.repeat(48);
    const before = withEnv({ SIGNING_KEYS_SECRET: keys, JWT_SECRET: 'j'.repeat(48) }, () => testSignature('s1', 'u1'));
    const after = withEnv({ SIGNING_KEYS_SECRET: keys, JWT_SECRET: 'r'.repeat(48) }, () => testSignature('s1', 'u1'));
    expect(after).toBe(before);
    // A different purpose never shares a key.
    withEnv({ SIGNING_KEYS_SECRET: keys }, () => {
      expect(
        Buffer.compare(
          signingKey('network-hash', () => Buffer.alloc(0)),
          signingKey('sso-state', () => Buffer.alloc(0)),
        ) !== 0,
      ).toBe(true);
    });
  });

  it('is required in production and must be its own value', () => {
    const prod = { NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48), SECRETS_KEY: 'b'.repeat(48), COOKIE_SECURE: 'true' };
    expect(() => withEnv({ ...prod, SIGNING_KEYS_SECRET: undefined }, config)).toThrow(/SIGNING_KEYS_SECRET is required/);
    expect(() => withEnv({ ...prod, SIGNING_KEYS_SECRET: 'a'.repeat(48) }, config)).toThrow(/SIGNING_KEYS_SECRET: must be its own/);
    expect(withEnv({ ...prod, SIGNING_KEYS_SECRET: 'c'.repeat(48) }, () => config().SIGNING_KEYS_SECRET)).toBe('c'.repeat(48));
  });
});

describe('S7: session token in the response body', () => {
  const email = `s7-${run}@test.zapx`;

  it('is left out for browsers, which use the httpOnly cookie', async () => {
    const reg = await http
      .post('/api/auth/register')
      .set('Sec-Fetch-Mode', 'cors')
      .send({ organization: `S7 ${run}`, name: 'Sam', email, password })
      .expect(201);
    expect(reg.body.token).toBeUndefined();
    expect(String(reg.headers['set-cookie'])).toMatch(/httpOnly/i);

    const login = await http.post('/api/auth/login').set('Sec-Fetch-Mode', 'cors').send({ email, password }).expect(200);
    expect(login.body.token).toBeUndefined();
    expect(login.body.user.email).toBe(email);
  });

  it('is still returned to the mobile app and API scripts (no Sec-Fetch-Mode header)', async () => {
    const login = await http.post('/api/auth/login').set('X-ZAPX-Client', 'mobile').send({ email, password }).expect(200);
    expect(login.body.token).toEqual(expect.any(String));
    await http
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${login.body.token}` })
      .expect(200);
  });
});

describe('S8: static security rules in the lint', () => {
  it('runs eslint-plugin-security with every pnpm lint', () => {
    const cfg = readFileSync(join(__dirname, '../../../eslint.config.mjs'), 'utf8');
    expect(cfg).toContain("import security from 'eslint-plugin-security'");
    for (const rule of ['security/detect-eval-with-expression', 'security/detect-child-process', 'no-new-func'])
      expect(cfg).toContain(`'${rule}': 'error'`);
  });
});

describe('S9: row-level security on personal-data tables', () => {
  const tables = ['Response', 'Capture', 'CatiCase', 'CatiCall', 'DoNotCall', 'Contact', 'Invitation', 'BackCheck', 'QualityAppeal'];

  it('has the tenant isolation policy forced on every listed table', async () => {
    const rows = await prisma.$queryRaw<Array<{ table: string; enabled: boolean; forced: boolean; policy: boolean }>>`
      SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
        EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'zapx_tenant_isolation') AS policy
      FROM pg_class c WHERE c.relkind = 'r' AND c.relname = ANY(${tables})`;
    expect(rows.map((r) => r.table).sort()).toEqual([...tables].sort());
    for (const r of rows) expect(r, r.table).toMatchObject({ enabled: true, forced: true, policy: true });
  });

  it("hides another tenant's rows from a plain database role", async () => {
    const [mine, other] = [`t-${run}-a`, `t-${run}-b`];
    // A role without BYPASSRLS, like the one production uses, inside a transaction that is rolled back.
    const visible = await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DO $$ BEGIN CREATE ROLE zapx_rls_probe NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
        await tx.$executeRawUnsafe(`GRANT SELECT ON "DoNotCall" TO zapx_rls_probe`);
        for (const [t, h] of [
          [mine, 'h1'],
          [other, 'h2'],
        ])
          await tx.$executeRaw`INSERT INTO "DoNotCall" ("id", "tenantId", "phoneHash", "hint", "source") VALUES (${`${t}-${h}`}, ${t}, ${h}, '123', 'manual')`;
        await tx.$executeRawUnsafe(`SET LOCAL ROLE zapx_rls_probe`);
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${mine}, TRUE)`;
        const rows = await tx.$queryRaw<
          Array<{ tenantId: string }>
        >`SELECT "tenantId" FROM "DoNotCall" WHERE "tenantId" IN (${mine}, ${other})`;
        throw Object.assign(new Error('rollback'), { rows });
      })
      .catch((e: { rows?: Array<{ tenantId: string }> }) => {
        if (!e.rows) throw e;
        return e.rows;
      });
    expect(visible.map((r) => r.tenantId)).toEqual([mine]);
  });
});
