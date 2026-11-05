/**
 * Dashboard summary and top-bar search: real counts, test responses left out, other organizations
 * and unassigned projects never counted.
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
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `d${Date.now().toString(36)}`;
let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let other: Record<string, string>;
let tenantId: string;
let surveyId: string;
let versionId: string;

async function register(tag: string) {
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${tag} ${run}`, name: 'Admin', email: `${tag}-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  return { Authorization: `Bearer ${reg.body.token as string}` };
}

async function addResponse(fields: Record<string, unknown>) {
  await prisma.response.create({
    data: {
      tenantId,
      surveyId,
      versionId,
      uid: randomUUID(),
      sessionTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      ...fields,
    },
  });
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  admin = await register('a');
  other = await register('b');
  tenantId = (await http.get('/api/auth/me').set(admin).expect(200)).body.tenant.id;
});

afterAll(async () => {
  await app?.close();
});

describe('dashboard', () => {
  it('is empty for a new organization', async () => {
    const d = (await http.get('/api/dashboard').set(admin).expect(200)).body;
    expect(d.projects).toBe(0);
    expect(d.surveys.total).toBe(0);
    expect(d.responses.total).toBe(0);
    expect(d.trend).toHaveLength(30);
    expect(d.recentSurveys).toEqual([]);
  });

  it('counts surveys and real responses by outcome, device, mode and country, without test responses', async () => {
    const project = (await http.post('/api/projects').set(admin).send({ name: 'Brand tracker', client: 'Acme' }).expect(201)).body;
    surveyId = (await http.post(`/api/projects/${project.id}/surveys`).set(admin).send({ name: 'Brand health' }).expect(201)).body.id;
    await http.post(`/api/projects/${project.id}/surveys`).set(admin).send({ name: 'Ad recall' }).expect(201);
    await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition: demo }).expect(200);
    versionId = (await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201)).body.version.id;

    const now = new Date();
    await addResponse({ status: 'COMPLETE', completedAt: now, device: 'mobile', country: 'us', mode: 'CAWI' });
    await addResponse({ status: 'COMPLETE', completedAt: now, device: 'desktop', country: 'GB', mode: 'CAPI', reviewState: 'PENDING' });
    await addResponse({ status: 'COMPLETE', completedAt: now, device: 'desktop', country: 'GB', mode: 'CATI', reviewState: 'REJECTED' });
    await addResponse({ status: 'TERMINATE', completedAt: now, device: 'tablet', country: 'GB' });
    await addResponse({ status: 'IN_PROGRESS' });
    await addResponse({ status: 'COMPLETE', completedAt: now, isTest: true, country: 'FR' });

    const d = (await http.get('/api/dashboard').set(admin).expect(200)).body;
    expect(d.projects).toBe(1);
    expect(d.surveys).toEqual({ total: 2, byStatus: { DRAFT: 1, LIVE: 1, PAUSED: 0, CLOSED: 0 } });
    expect(d.responses.total).toBe(5);
    expect(d.responses.byStatus).toMatchObject({ COMPLETE: 3, TERMINATE: 1, IN_PROGRESS: 1 });
    expect(d.responses.byDevice).toEqual({ desktop: 2, mobile: 1, tablet: 1, unknown: 1 });
    expect(d.responses.byMode).toEqual({ CAWI: 3, CAPI: 1, CATI: 1 });
    expect(d.responses.pendingReview).toBe(1);
    expect(d.responses.rejectedInReview).toBe(1);
    expect(d.responses.countries).toBe(2);
    expect(d.responses.topCountries[0]).toEqual({ code: 'GB', count: 3 });
    const today = d.trend[d.trend.length - 1];
    expect(today).toEqual({ date: now.toISOString().slice(0, 10), starts: 5, completes: 3 });
    const recent = d.recentSurveys.find((s: { id: string }) => s.id === surveyId);
    expect(recent).toMatchObject({ name: 'Brand health', status: 'LIVE', projectName: 'Brand tracker', responses: 5, completes: 3 });
  });

  it('never shows another organization’s data', async () => {
    const d = (await http.get('/api/dashboard').set(other).expect(200)).body;
    expect(d.projects).toBe(0);
    expect(d.responses.total).toBe(0);
    expect((await http.get('/api/dashboard/search?q=brand').set(other).expect(200)).body).toEqual({ projects: [], surveys: [] });
  });

  it('searches projects (by name or client) and surveys', async () => {
    const r = (await http.get('/api/dashboard/search?q=BRAND').set(admin).expect(200)).body;
    expect(r.projects.map((p: { name: string }) => p.name)).toEqual(['Brand tracker']);
    expect(r.surveys.map((s: { name: string }) => s.name)).toEqual(['Brand health']);
    expect((await http.get('/api/dashboard/search?q=acme').set(admin).expect(200)).body.projects).toHaveLength(1);
    expect((await http.get('/api/dashboard/search?q=').set(admin).expect(200)).body).toEqual({ projects: [], surveys: [] });
  });
});
