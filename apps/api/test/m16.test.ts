/**
 * Milestone 16: network reputation. The IPinfo adapter against a local stand-in of its privacy API:
 * VPN and data-centre addresses become quality flags; ordinary, private and failing lookups do not;
 * the address is never stored and repeated addresses are looked up once.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.NETWORK_REPUTATION_TIMEOUT_MS = '500';
});

import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assessQuality } from '@zapx/quality-core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { IpinfoProvider, NetworkReputationService, isPrivateAddress } from '../src/quality/network-reputation.service';

const run = `m16${Date.now().toString(36)}`;
let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let reputation: NetworkReputationService;
let admin: Record<string, string>;
let surveyId: string;
let ipinfo: Server;
const seen: Array<{ path: string; auth?: string }> = [];

// The stand-in answers like IPinfo's /{ip}/privacy endpoint.
const ANSWERS: Record<string, unknown> = {
  '203.0.113.10': { vpn: true, proxy: false, tor: false, relay: false, hosting: true, service: 'ExampleVPN' },
  '203.0.113.11': { vpn: false, proxy: false, tor: false, relay: false, hosting: true, service: '' },
  '203.0.113.12': { vpn: false, proxy: false, tor: false, relay: false, hosting: false, service: '' },
};

const definition = {
  schemaVersion: 1,
  title: 'Net',
  pages: [
    {
      id: 'P1',
      questions: [
        {
          id: 'Q1',
          type: 'single',
          text: 'Pick one',
          options: [
            { code: 1, label: 'A' },
            { code: 2, label: 'B' },
          ],
        },
      ],
    },
  ],
  settings: { quality: { sameNetwork: false } },
};

beforeAll(async () => {
  ipinfo = createServer((req, res) => {
    seen.push({ path: req.url ?? '', auth: req.headers.authorization });
    const ip = decodeURIComponent((req.url ?? '').split('/')[1] ?? '');
    if (ip === '203.0.113.99') return void setTimeout(() => res.writeHead(200).end('{}'), 2_000);
    if (ip === '203.0.113.98') return void res.writeHead(429).end('{"error":"rate limit"}');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(ANSWERS[ip] ?? {}));
  });
  await new Promise<void>((r) => ipinfo.listen(0, '127.0.0.1', r));

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  reputation = app.get(NetworkReputationService);
  reputation.useProvider(new IpinfoProvider('test-token', `http://127.0.0.1:${(ipinfo.address() as AddressInfo).port}`));

  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  const pid = (await http.post('/api/projects').set(admin).send({ name: 'Net' }).expect(201)).body.id;
  await http.post(`/api/projects/${pid}/vendors`).set(admin).send({ name: 'Panel', code: 'PN' }).expect(201);
  surveyId = (await http.post(`/api/projects/${pid}/surveys`).set(admin).send({ name: 'Net' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);
});

afterAll(async () => {
  await app?.close();
  await new Promise<void>((r) => (ipinfo ? ipinfo.close(() => r()) : r()));
});

/** One complete from the address; returns the stored interview once the lookup has landed. */
async function completeFrom(ip: string, uid: string) {
  const start = await http
    .post(`/api/public/s/${surveyId}/start`)
    .set('X-Forwarded-For', ip)
    .send({ query: { vid: 'PN', uid } })
    .expect(200);
  // No pause: completing straight away waits for the background lookup.
  await http
    .post(`/api/public/r/${start.body.token}/answers`)
    .send({ pageId: 'P1', answers: { Q1: 1 }, signals: { interactions: 3 } })
    .expect(200);
  return prisma.response.findFirstOrThrow({ where: { surveyId, uid } });
}
const codes = (r: { qualityFlags: unknown }) => ((r.qualityFlags ?? []) as Array<{ code: string }>).map((f) => f.code);

describe('network reputation', () => {
  it('flags a VPN, and sends the token but never stores the address', async () => {
    const r = await completeFrom('203.0.113.10', `vpn-${run}`);
    expect(r.networkFlags).toEqual(['vpn', 'hosting']);
    expect(codes(r)).toEqual(['anonymous_network']);
    expect(r.qualityScore).toBe(70);
    expect(JSON.stringify(r)).not.toContain('203.0.113.10');
    expect(seen.at(-1)).toEqual({ path: '/203.0.113.10/privacy', auth: 'Bearer test-token' });
  });

  it('flags a data-centre address with a smaller penalty', async () => {
    const r = await completeFrom('203.0.113.11', `dc-${run}`);
    expect(codes(r)).toEqual(['datacenter_network']);
    expect(r.qualityScore).toBe(80);
  });

  it('leaves ordinary networks, slow and failing lookups alone', async () => {
    expect(codes(await completeFrom('203.0.113.12', `home-${run}`))).toEqual([]);
    const before = seen.length;
    expect(codes(await completeFrom('203.0.113.98', `limit-${run}`))).toEqual([]);
    expect(seen.length).toBe(before + 1);
    expect(await reputation.check('missing', '203.0.113.99')).toBeNull(); // times out after 500 ms
  });

  it('looks a repeated address up once', async () => {
    const before = seen.length;
    const again = await completeFrom('203.0.113.10', `vpn2-${run}`);
    expect(again.networkFlags).toEqual(['vpn', 'hosting']);
    expect(seen.length).toBe(before);
  });

  it('never sends private addresses, and stays off without a provider', async () => {
    for (const ip of ['10.1.2.3', '192.168.0.4', '172.20.0.1', '127.0.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1', 'nonsense'])
      expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress('203.0.113.10')).toBe(false);
    expect(isPrivateAddress('2001:db8::1')).toBe(false);
    const before = seen.length;
    expect(await reputation.check('x', '10.0.0.1')).toBeNull();
    reputation.useProvider(null);
    expect(reputation.enabled()).toBe(false);
    expect(codes(await completeFrom('203.0.113.11', `off-${run}`))).toEqual([]);
    expect(seen.length).toBe(before);
  });

  it('is only a signal when fraud checks are on', () => {
    const def = { ...definition, settings: { quality: { fraud: false } } };
    const result = assessQuality({
      def: def as never,
      answers: { Q1: 1 },
      durationMs: 60_000,
      medianMs: null,
      fraud: { network: ['tor'] },
    });
    expect(result.flags).toEqual([]);
  });
});
