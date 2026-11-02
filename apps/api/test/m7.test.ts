/**
 * Milestone 7: background jobs (exports, large QA runs, AI drafts), the file store with expiring
 * files, job access control, cancellation, retries after a crashed worker, and housekeeping.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.EXPORT_SYNC_MAX_ROWS = '3';
  process.env.FILES_DIR = `.data/test-files-${process.pid}`;
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { JobWorker } from '../src/jobs/job.worker';
import { FileStore } from '../src/jobs/file-store';
import { AiProvider, type ArchitectRequest, type ArchitectResult, type TranslateResult } from '../src/ai/ai-provider';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m7${Date.now().toString(36)}`;

class FakeAi extends AiProvider {
  readonly configured = true;
  readonly model = 'fake-model';
  readonly calls: ArchitectRequest[] = [];
  async architect(req: ArchitectRequest): Promise<ArchitectResult> {
    this.calls.push(req);
    return {
      summary: 'Built the screener. Check the age bands.',
      assumptions: ['Age bands follow the brief.'],
      definitionJson: JSON.stringify(demo),
      model: 'fake-model',
      servedByFallback: false,
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }
  async translate(): Promise<TranslateResult> {
    return { translations: {}, model: 'fake-model', usage: { inputTokens: 1, outputTokens: 1 } };
  }
}
const fakeAi = new FakeAi();

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let worker: JobWorker;
let auth: Record<string, string>;
let tenantId: string;
let projectId: string;
let surveyId: string;

/** Run the worker until the job is finished (another test file's worker may also pick it up). */
async function settle(jobId: string) {
  for (let i = 0; i < 100; i++) {
    await worker.runOnce();
    const j = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(j.status)) return (await http.get(`/api/jobs/${jobId}`).set(auth).expect(200)).body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

async function respond(uid: string) {
  const s = (
    await http
      .post(`/api/public/s/${surveyId}/start`)
      .send({ query: { vid: 'JV', uid } })
      .expect(200)
  ).body;
  await http
    .post(`/api/public/r/${s.token}/answers`)
    .send({ pageId: 'P1', answers: { AGE: 40, GENDER: 2 } })
    .expect(200);
  await http
    .post(`/api/public/r/${s.token}/answers`)
    .send({ pageId: 'P2', answers: { AWARE: [99] } })
    .expect(200);
  await http
    .post(`/api/public/r/${s.token}/answers`)
    .send({ pageId: 'P4', answers: { COMMENTS: `Answer from ${uid}` } })
    .expect(200);
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiProvider)
    .useValue(fakeAi)
    .compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  worker = app.get(JobWorker);
  const res = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  auth = { Authorization: `Bearer ${res.body.token}` };
  tenantId = (await http.get('/api/auth/me').set(auth).expect(200)).body.tenant.id;
  projectId = (await http.post('/api/projects').set(auth).send({ name: 'Jobs' }).expect(201)).body.id;
  await http.post(`/api/projects/${projectId}/vendors`).set(auth).send({ name: 'Job vendor', code: 'JV' }).expect(201);
  surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name: 'Jobs survey' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(auth).send({ definition: demo }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(201);
  for (let i = 0; i < 5; i++) await respond(`J-${i}`);
});

afterAll(async () => {
  await app?.close();
  await rm(resolve(`.data/test-files-${process.pid}`), { recursive: true, force: true });
});

describe('export jobs', () => {
  it('refuses large exports in the request and points to the job', async () => {
    const res = await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(auth).expect(413);
    expect(res.body.message).toMatch(/run in the background/);
  });

  it('builds the export in the background and serves the file until it expires', async () => {
    const queued = await http.post(`/api/surveys/${surveyId}/jobs/export`).set(auth).send({ format: 'csv' }).expect(202);
    expect(queued.body).toMatchObject({ type: 'export', status: 'QUEUED', progress: 0 });
    const job = await settle(queued.body.id);
    expect(job).toMatchObject({ status: 'SUCCEEDED', progress: 100, result: { rows: 5, format: 'csv' } });

    const file = await http.get(`/api/files/${job.result.fileId}`).set(auth).expect(200);
    expect(file.headers['content-disposition']).toContain('Jobs_survey.csv');
    expect(file.text).toContain('J-4');
    expect(file.text.split('\n').filter((l: string) => l.trim()).length).toBe(6);
    const stored = await prisma.storedFile.findUniqueOrThrow({ where: { id: job.result.fileId } });
    expect(stored.storageKey.startsWith(`${tenantId}/`)).toBe(true);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);

    const audit = await prisma.auditEvent.findMany({
      where: { tenantId, entityId: surveyId, action: { in: ['job.create', 'survey.export', 'file.download'] } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual(['file.download', 'job.create', 'survey.export']);

    // Expired: no longer served, and housekeeping removes the bytes.
    await prisma.storedFile.update({ where: { id: stored.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http.get(`/api/files/${stored.id}`).set(auth).expect(404);
    await worker.housekeeping();
    expect((await prisma.storedFile.findUniqueOrThrow({ where: { id: stored.id } })).deletedAt).not.toBeNull();
    await expect(app.get(FileStore).get(stored.storageKey)).rejects.toThrow();
  });

  it('builds Excel exports with status filters', async () => {
    const queued = await http
      .post(`/api/surveys/${surveyId}/jobs/export`)
      .set(auth)
      .send({ format: 'xlsx', statuses: ['COMPLETE'] })
      .expect(202);
    const job = await settle(queued.body.id);
    expect(job.result).toMatchObject({ format: 'xlsx', rows: 5 });
    const file = await http.get(`/api/files/${job.result.fileId}`).set(auth).buffer(true).expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
  });

  it('keeps jobs and files to members who can see the survey', async () => {
    const queued = await http.post(`/api/surveys/${surveyId}/jobs/export`).set(auth).send({}).expect(202);
    const job = await settle(queued.body.id);
    const email = `scoped-${run}@test.zapx`;
    await http
      .post('/api/users')
      .set(auth)
      .send({ name: 'Scoped', email, password: 'member-password-1', role: 'VIEWER', projectScope: 'ASSIGNED' })
      .expect(201);
    const scoped = {
      Authorization: `Bearer ${(await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token}`,
    };
    await http.get(`/api/jobs/${job.id}`).set(scoped).expect(404);
    await http.get(`/api/files/${job.result.fileId}`).set(scoped).expect(404);
    await http.get(`/api/surveys/${surveyId}/jobs`).set(scoped).expect(404);
    await http.post(`/api/surveys/${surveyId}/jobs/export`).set(scoped).send({}).expect(404);

    const other = await http
      .post('/api/auth/register')
      .send({ organization: `Other ${run}`, name: 'O', email: `other-${run}@test.zapx`, password: 'correct-horse-battery' })
      .expect(201);
    await http
      .get(`/api/files/${job.result.fileId}`)
      .set({ Authorization: `Bearer ${other.body.token}` })
      .expect(404);
  });

  it('fails the job when its member has lost access by the time it runs', async () => {
    const email = `leaver-${run}@test.zapx`;
    const m = (
      await http.post('/api/users').set(auth).send({ name: 'Leaver', email, password: 'member-password-1', role: 'PROGRAMMER' }).expect(201)
    ).body;
    const h = {
      Authorization: `Bearer ${(await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token}`,
    };
    const queued = await http.post(`/api/surveys/${surveyId}/jobs/export`).set(h).send({}).expect(202);
    await http.patch(`/api/users/${m.id}`).set(auth).send({ projectScope: 'ASSIGNED' }).expect(200);
    const job = await settle(queued.body.id);
    expect(job.status).toBe('FAILED');
    expect(job.error).toBe('Survey not found');
  });
});

describe('QA and AI jobs', () => {
  it('runs QA beyond the request limit as a job', async () => {
    await http.post(`/api/surveys/${surveyId}/qa/run`).set(auth).send({ respondents: 5000 }).expect(400);
    const queued = await http
      .post(`/api/surveys/${surveyId}/jobs/qa`)
      .set(auth)
      .send({ respondents: 5000, seed: 'm7', target: 'live' })
      .expect(202);
    const job = await settle(queued.body.id);
    expect(job).toMatchObject({ status: 'SUCCEEDED', result: { respondents: 5000, passed: true } });
    const runRow = await prisma.qaRun.findUniqueOrThrow({ where: { id: job.result.runId } });
    expect(runRow.respondents).toBe(5000);
    await http.post(`/api/surveys/${surveyId}/jobs/qa`).set(auth).send({ respondents: 20000 }).expect(400);
  });

  it('drafts with AI in the background, from an instruction and a document', async () => {
    const queued = await http
      .post(`/api/surveys/${surveyId}/jobs/ai`)
      .set(auth)
      .field('instruction', 'Build a brand screener')
      .attach('file', Buffer.from('Q1. How old are you?\nQ2. Which brands do you know?'), 'brief.txt')
      .expect(202);
    expect(queued.body.type).toBe('ai_propose');
    expect(JSON.stringify(queued.body)).not.toContain('How old are you');
    const job = await settle(queued.body.id);
    expect(job.status).toBe('SUCCEEDED');
    expect(fakeAi.calls.at(-1)!.documents[0]).toMatchObject({ name: 'brief.txt', kind: 'text' });
    const cs = (await http.get(`/api/changesets/${job.result.changeSetId}`).set(auth).expect(200)).body;
    expect(cs).toMatchObject({ source: 'AI', status: 'PROPOSED', sourceFileName: 'brief.txt' });
    // The draft is untouched until a person applies the change set.
    await http.post(`/api/surveys/${surveyId}/jobs/ai`).set(auth).field('instruction', '').expect(400);
  });
});

describe('job lifecycle', () => {
  it('cancels a queued job', async () => {
    const queued = await http.post(`/api/surveys/${surveyId}/jobs/export`).set(auth).send({}).expect(202);
    // Another member who can see the survey cannot cancel someone else's job.
    const email = `viewer-${run}@test.zapx`;
    await http.post('/api/users').set(auth).send({ name: 'Viewer', email, password: 'member-password-1', role: 'VIEWER' }).expect(201);
    const viewer = {
      Authorization: `Bearer ${(await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token}`,
    };
    await http.get(`/api/jobs/${queued.body.id}`).set(viewer).expect(200);
    await http.post(`/api/jobs/${queued.body.id}/cancel`).set(viewer).expect(403);
    const cancelled = await http.post(`/api/jobs/${queued.body.id}/cancel`).set(auth).expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    await worker.runOnce();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: queued.body.id } })).status).toBe('CANCELLED');
    await http.post(`/api/jobs/${queued.body.id}/cancel`).set(auth).expect(409);
  });

  it('picks up a job whose worker died, and gives up after the attempts allowed', async () => {
    const queued = await http.post(`/api/surveys/${surveyId}/jobs/export`).set(auth).send({}).expect(202);
    // Simulate a worker that claimed the job and died: RUNNING with an expired lease.
    await prisma.job.update({
      where: { id: queued.body.id },
      data: { status: 'RUNNING', attempts: 1, lockedUntil: new Date(Date.now() - 1000) },
    });
    const job = await settle(queued.body.id);
    expect(job).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });

    const again = await http.post(`/api/surveys/${surveyId}/jobs/export`).set(auth).send({}).expect(202);
    await prisma.job.update({
      where: { id: again.body.id },
      data: { status: 'RUNNING', attempts: 2, lockedUntil: new Date(Date.now() - 1000) },
    });
    const dead = await settle(again.body.id);
    expect(dead).toMatchObject({ status: 'FAILED', error: 'The job stopped unexpectedly several times.' });
  });

  it('lists recent jobs for a survey without their inputs', async () => {
    const list = (await http.get(`/api/surveys/${surveyId}/jobs?type=export`).set(auth).expect(200)).body as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThan(3);
    expect(list.every((j) => j.type === 'export' && !('input' in j))).toBe(true);
  });

  it('deletes old finished jobs and old webhook deliveries in housekeeping', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    const j = await prisma.job.create({
      data: { tenantId, type: 'export', surveyId, input: {}, createdById: 'x', status: 'SUCCEEDED', finishedAt: old },
    });
    const hook = await prisma.webhook.create({
      data: { tenantId, url: 'https://example.com/h', events: ['survey.published'], secretEnc: 'x' },
    });
    await prisma.webhookDelivery.create({
      data: { tenantId, webhookId: hook.id, event: 'survey.published', payload: {}, state: 'DELIVERED', createdAt: old },
    });
    const fresh = await prisma.webhookDelivery.create({
      data: { tenantId, webhookId: hook.id, event: 'survey.published', payload: {}, state: 'DELIVERED' },
    });
    await worker.housekeeping();
    expect(await prisma.job.findUnique({ where: { id: j.id } })).toBeNull();
    expect(await prisma.webhookDelivery.count({ where: { webhookId: hook.id } })).toBe(1);
    expect(await prisma.webhookDelivery.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    await prisma.webhook.delete({ where: { id: hook.id } });
  });
});
