/**
 * Milestone 5: data quality (scoring, in-survey quality rejects, the review queue with quota release
 * and vendor reconciliation, the fieldwork dashboard, export columns) and CAPI (interviewer role,
 * assignments, the offline package, and sync: replay, idempotency, quotas at sync, rejects).
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
});

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
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
const run = `m5${Date.now().toString(36)}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let auth: Record<string, string>;
let projectId: string;

let members = 0;
async function member(role: 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER', name = role) {
  const email = `${role.toLowerCase()}${++members}-${run}@test.zapx`;
  const created = (await http.post('/api/users').set(auth).send({ name, email, password: 'member-password-1', role }).expect(201)).body;
  const login = await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200);
  return { id: created.id as string, headers: { Authorization: `Bearer ${login.body.token}` } };
}

async function surveyWith(name: string, quality: Record<string, unknown>) {
  const id = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name }).expect(201)).body.id as string;
  const def = { ...demo, settings: { quality } };
  await http.put(`/api/surveys/${id}/draft`).set(auth).send({ definition: def }).expect(200);
  await http.post(`/api/surveys/${id}/publish`).set(auth).expect(201);
  return id;
}

let ipCounter = 10;
async function start(surveyId: string, vid: string, uid: string, ip = `203.0.113.${ipCounter++}`) {
  return (await http.post(`/api/public/s/${surveyId}/start`).set('X-Forwarded-For', ip).send({ query: { vid, uid } }).expect(200)).body;
}

async function answer(token: string, pageId: string, answers: Record<string, unknown>) {
  return (await http.post(`/api/public/r/${token}/answers`).send({ pageId, answers }).expect(200)).body;
}

/** Pretend the respondent spent `seconds` on the page currently shown. */
async function spend(surveyId: string, uid: string, seconds: number) {
  await prisma.response.updateMany({ where: { surveyId, uid }, data: { pageShownAt: new Date(Date.now() - seconds * 1000) } });
}

/** Complete the demo screener as a woman who knows no brands. */
async function complete(
  surveyId: string,
  uid: string,
  opts: { comments?: string; secondsPerPage?: number; ip?: string; gender?: number } = {},
) {
  const s = await start(surveyId, 'QV', uid, opts.ip);
  if (opts.secondsPerPage) await spend(surveyId, uid, opts.secondsPerPage);
  await answer(s.token, 'P1', { AGE: 40, GENDER: opts.gender ?? 2 });
  if (opts.secondsPerPage) await spend(surveyId, uid, opts.secondsPerPage);
  await answer(s.token, 'P2', { AWARE: [99] });
  if (opts.secondsPerPage) await spend(surveyId, uid, opts.secondsPerPage);
  return answer(s.token, 'P4', { COMMENTS: opts.comments ?? 'All good, thanks.' });
}

const row = (surveyId: string, uid: string) => prisma.response.findFirstOrThrow({ where: { surveyId, uid } });

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  const res = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  auth = { Authorization: `Bearer ${res.body.token}` };
  projectId = (await http.post('/api/projects').set(auth).send({ name: 'Quality' }).expect(201)).body.id;
  await http
    .post(`/api/projects/${projectId}/vendors`)
    .set(auth)
    .send({
      name: 'Quality vendor',
      code: 'QV',
      staticUrls: { complete: 'https://qv.test/c?u=[UID]', quality_fail: 'https://qv.test/q?u=[UID]' },
      callbackUrl: 'https://qv.test/pb?u=[UID]&s=[STATUS]',
      callbackStatuses: ['complete', 'quality_fail'],
    })
    .expect(201);
});

afterAll(async () => {
  // The vendor in these tests is not reachable; leave no pending callbacks behind in the shared database.
  const tenantId = (await prisma?.project.findUnique({ where: { id: projectId } }))?.tenantId;
  if (tenantId) await prisma.outboundCallback.updateMany({ where: { tenantId, state: 'PENDING' }, data: { state: 'DEAD' } });
  await app?.close();
});

// ---- Quality scoring -------------------------------------------------------------------------

describe('quality scoring of online completes', () => {
  let surveyId: string;
  beforeAll(async () => {
    surveyId = await surveyWith('Scored', { minSeconds: 30, checks: [{ id: 'QC_OLD', condition: 'AGE > 100', label: 'Implausible age' }] });
  });

  it('times the interview and scores a careful respondent 100', async () => {
    const done = await complete(surveyId, 'CLEAN-1', { secondsPerPage: 20 });
    expect(done).toMatchObject({ state: 'finished', status: 'complete', redirectUrl: 'https://qv.test/c?u=CLEAN-1' });
    const r = await row(surveyId, 'CLEAN-1');
    expect(r.durationMs).toBeGreaterThanOrEqual(59_000);
    expect(r).toMatchObject({ qualityScore: 100, qualityFlags: [], reviewState: 'NONE', lastPageId: 'P4' });
    expect(r.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(r)).not.toContain('203.0.113.');
  });

  it('flags a speeder with a gibberish answer and sends them to review, still complete', async () => {
    const done = await complete(surveyId, 'FAST-1', { comments: 'sdfghjkl' });
    expect(done).toMatchObject({ status: 'complete' });
    const r = await row(surveyId, 'FAST-1');
    expect(r.qualityScore).toBe(20);
    expect((r.qualityFlags as Array<{ code: string }>).map((f) => f.code)).toEqual(['speeder_hard', 'open_gibberish']);
    expect(r.reviewState).toBe('PENDING');
  });

  it('flags the same long open answer from a second respondent, and a shared network', async () => {
    const text = 'I really enjoyed the new flavour and would buy it again next week.';
    await complete(surveyId, 'COPY-1', { comments: text, secondsPerPage: 20, ip: '198.51.100.7' });
    await complete(surveyId, 'COPY-2', { comments: text.toUpperCase() + '!!', secondsPerPage: 20, ip: '198.51.100.7' });
    expect((await row(surveyId, 'COPY-1')).qualityScore).toBe(100);
    const second = await row(surveyId, 'COPY-2');
    expect((second.qualityFlags as Array<{ code: string }>).map((f) => f.code)).toEqual(['open_duplicate', 'same_network']);
    expect(second.qualityScore).toBe(55);
    expect(second.reviewState).toBe('PENDING');
  });

  it('checks quality-check expressions in the logic check', async () => {
    const bad = { ...demo, settings: { quality: { checks: [{ id: 'QC_X', condition: 'NOPE == 1' }] } } };
    const r = await http.post(`/api/surveys/${surveyId}/check`).set(auth).send({ definition: bad }).expect(201);
    expect(r.body.analysis.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNDEFINED_VARIABLE', location: 'settings.quality.checks.QC_X.condition' })]),
    );
  });
});

describe('in-survey quality rejects', () => {
  it('ends a low-scoring complete as quality_fail, redirects it as such and does not count the quota', async () => {
    const surveyId = await surveyWith('Strict', { minSeconds: 30, rejectBelow: 50 });
    const done = await complete(surveyId, 'BOT-1');
    expect(done).toMatchObject({ state: 'finished', status: 'quality_fail', redirectUrl: 'https://qv.test/q?u=BOT-1' });
    const r = await row(surveyId, 'BOT-1');
    expect(r).toMatchObject({ status: 'QUALITY_FAIL', outcomeReason: 'quality:speeder_hard', qualityScore: 40 });
    expect((await prisma.quotaCount.findFirstOrThrow({ where: { surveyId, quotaId: 'QT_WOMEN' } })).count).toBe(0);
    expect(await prisma.outboundCallback.count({ where: { responseId: r.id, status: 'quality_fail' } })).toBe(1);
  });
});

// ---- Review queue ----------------------------------------------------------------------------

describe('quality review queue', () => {
  let surveyId: string;
  beforeAll(async () => {
    surveyId = await surveyWith('Review', { minSeconds: 30 });
    await complete(surveyId, 'R-1', { comments: 'asdfgh' });
    await complete(surveyId, 'R-2', { comments: 'aaaaaa' });
    await complete(surveyId, 'R-OK', { secondsPerPage: 20 });
  });

  it('lists pending completes, worst first, with their open answers', async () => {
    const q = (await http.get(`/api/surveys/${surveyId}/quality`).set(auth).expect(200)).body;
    expect(q.items.map((i: { uid: string }) => i.uid).sort()).toEqual(['R-1', 'R-2']);
    expect(q.items[0].openEnds).toEqual([{ questionId: 'COMMENTS', text: expect.any(String) }]);
    expect(q.counts).toMatchObject({ pending: 2, none: 1 });
  });

  it('lets viewers look but not decide', async () => {
    const viewer = await member('VIEWER');
    await http.get(`/api/surveys/${surveyId}/quality`).set(viewer.headers).expect(200);
    await http
      .post(`/api/surveys/${surveyId}/quality/decisions`)
      .set(viewer.headers)
      .send({ responseIds: ['x'], decision: 'reject' })
      .expect(403);
  });

  it('rejecting releases the quota place, tells the vendor quality_fail and is audited; it is final', async () => {
    const programmer = await member('PROGRAMMER');
    const r1 = await row(surveyId, 'R-1');
    const before = (await prisma.quotaCount.findFirstOrThrow({ where: { surveyId, quotaId: 'QT_WOMEN' } })).count;
    const res = await http
      .post(`/api/surveys/${surveyId}/quality/decisions`)
      .set(programmer.headers)
      .send({ responseIds: [r1.id], decision: 'reject', note: 'Keyboard mashing' })
      .expect(200);
    expect(res.body).toEqual({ accepted: 0, rejected: 1, skipped: 0 });
    expect(await row(surveyId, 'R-1')).toMatchObject({
      status: 'QUALITY_FAIL',
      outcomeReason: 'quality_review',
      reviewState: 'REJECTED',
      reviewNote: 'Keyboard mashing',
    });
    expect((await prisma.quotaCount.findFirstOrThrow({ where: { surveyId, quotaId: 'QT_WOMEN' } })).count).toBe(before - 1);
    const callbacks = await prisma.outboundCallback.findMany({ where: { responseId: r1.id }, orderBy: { createdAt: 'asc' } });
    expect(callbacks.map((c) => c.status)).toEqual(['complete', 'quality_fail']);
    expect(callbacks[1]!.url).toBe('https://qv.test/pb?u=R-1&s=quality_fail');
    expect(await prisma.auditEvent.count({ where: { action: 'quality.reject', entityId: r1.id } })).toBe(1);

    const again = await http
      .post(`/api/surveys/${surveyId}/quality/decisions`)
      .set(auth)
      .send({ responseIds: [r1.id], decision: 'accept' })
      .expect(200);
    expect(again.body).toEqual({ accepted: 0, rejected: 0, skipped: 1 });
  });

  it('accepting keeps the complete and clears it from the queue', async () => {
    const r2 = await row(surveyId, 'R-2');
    await http
      .post(`/api/surveys/${surveyId}/quality/decisions`)
      .set(auth)
      .send({ responseIds: [r2.id], decision: 'accept' })
      .expect(200);
    expect(await row(surveyId, 'R-2')).toMatchObject({ status: 'COMPLETE', reviewState: 'ACCEPTED' });
    const q = (await http.get(`/api/surveys/${surveyId}/quality`).set(auth).expect(200)).body;
    expect(q.items).toEqual([]);
    const rejected = (await http.get(`/api/surveys/${surveyId}/quality?filter=rejected`).set(auth).expect(200)).body;
    expect(rejected.items.map((i: { uid: string }) => i.uid)).toEqual(['R-1']);
  });

  it('shows outcomes, incidence, length of interview and drop-off on the fieldwork dashboard', async () => {
    const s = await start(surveyId, 'QV', 'DROP-1');
    await answer(s.token, 'P1', { AGE: 40, GENDER: 2 }); // stops on P2
    const t = await start(surveyId, 'QV', 'TERM-1');
    await answer(t.token, 'P1', { AGE: 15, GENDER: 2 });
    const f = (await http.get(`/api/surveys/${surveyId}/fieldwork`).set(auth).expect(200)).body;
    expect(f.total).toMatchObject({ starts: 5, pendingReview: 0, rejectedInReview: 1 });
    expect(f.total.counts).toMatchObject({ complete: 2, quality_fail: 1, terminate: 1, in_progress: 1 });
    expect(f.total.incidence).toBe(50);
    expect(f.dropOff).toEqual([{ pageId: 'P2', count: 1 }]);
    expect(f.vendors.map((v: { vendor: string }) => v.vendor)).toEqual(['QV']);
    expect(f.modes).toEqual({ cawi: 5, capi: 0 });
  });

  it('exports quality columns', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(auth).expect(200)).text;
    const [header, ...lines] = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    const cols = header!.split(',');
    for (const c of ['mode', 'interviewer', 'loi_seconds', 'quality_score', 'quality_flags', 'review']) expect(cols).toContain(c);
    const r1 = lines.find((l) => l.includes(',R-1,'))!.split(',');
    expect(r1[cols.indexOf('review')]).toBe('rejected');
    expect(r1[cols.indexOf('quality_flags')]).toBe('speeder_hard open_gibberish:COMMENTS');
    expect(r1[cols.indexOf('mode')]).toBe('cawi');
  });
});

// ---- CAPI ------------------------------------------------------------------------------------

describe('CAPI interviewers, package and sync', () => {
  let surveyId: string;
  let versionId: string;
  let ana: Awaited<ReturnType<typeof member>>;
  let ben: Awaited<ReturnType<typeof member>>;
  const deviceId = randomUUID();

  const interview = (answers: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    clientId: randomUUID(),
    surveyId,
    versionId,
    answers,
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    finishedAt: new Date(Date.now() - 300_000).toISOString(),
    durationMs: 240_000,
    language: 'en',
    ...over,
  });
  const sync = (who: { headers: Record<string, string> }, interviews: unknown[]) =>
    http.post('/api/capi/sync').set(who.headers).send({ deviceId, interviews });

  beforeAll(async () => {
    surveyId = await surveyWith('Face to face', {});
    versionId = (await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } })).liveVersionId!;
    ana = await member('INTERVIEWER', 'Ana Field');
    ben = await member('INTERVIEWER', 'Ben Field');
  });

  it('keeps interviewers out of the studio API', async () => {
    await http.get('/api/projects').set(ana.headers).expect(403);
    await http.get(`/api/surveys/${surveyId}`).set(ana.headers).expect(403);
    await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(ana.headers).expect(403);
    expect((await http.get('/api/auth/me').set(ana.headers).expect(200)).body.role).toBe('INTERVIEWER');
    await http.get('/api/capi/package').set(auth).expect(403);
  });

  it('assigns interviewers and serves them the live version', async () => {
    expect((await http.get('/api/capi/package').set(ana.headers).expect(200)).body.surveys).toEqual([]);
    const programmer = await member('PROGRAMMER');
    await http.post(`/api/surveys/${surveyId}/capi/assignments`).set(auth).send({ interviewerId: programmer.id }).expect(400);
    await http.post(`/api/surveys/${surveyId}/capi/assignments`).set(auth).send({ interviewerId: ana.id, target: 20 }).expect(201);
    const pkg = (await http.get('/api/capi/package').set(ana.headers).expect(200)).body;
    expect(pkg.interviewer).toMatchObject({ name: 'Ana Field' });
    expect(pkg.surveys).toHaveLength(1);
    expect(pkg.surveys[0]).toMatchObject({ surveyId, status: 'LIVE', target: 20, version: { id: versionId, version: 1 } });
    expect(pkg.surveys[0].version.definition.pages[0].id).toBe('P1');
    const list = (await http.get(`/api/surveys/${surveyId}/capi/assignments`).set(auth).expect(200)).body;
    expect(list.interviewers.map((i: { name: string }) => i.name)).toEqual(['Ana Field', 'Ben Field']);
  });

  it('replays every interview on the server and decides its outcome', async () => {
    const done = interview({ AGE: 40, GENDER: 2, AWARE: [99], COMMENTS: 'Spoke to the respondent at home.' });
    const term = interview({ AGE: 15, GENDER: 2 });
    const broken = interview({ AGE: 40, GENDER: 2 }, { endedEarly: true });
    const tampered = interview({ AGE: 40, GENDER: 7, AWARE: [99] });
    const res = await sync(ana, [done, term, broken, tampered]).expect(200);
    expect(res.body.results).toEqual([
      { clientId: done.clientId, result: 'stored', status: 'complete' },
      { clientId: term.clientId, result: 'stored', status: 'terminate', reason: 'T_UNDERAGE' },
      { clientId: broken.clientId, result: 'stored', status: 'partial', reason: 'capi_ended_early' },
      { clientId: tampered.clientId, result: 'stored', status: 'technical_error', reason: 'capi_invalid:P1' },
    ]);
    const r = await prisma.response.findUniqueOrThrow({ where: { clientId: done.clientId } });
    expect(r).toMatchObject({
      mode: 'CAPI',
      interviewerId: ana.id,
      vendorId: null,
      deviceId,
      durationMs: 240_000,
      qualityScore: 100,
      lastPageId: 'P4',
    });
    expect((await prisma.response.findUniqueOrThrow({ where: { clientId: broken.clientId } })).lastPageId).toBe('P2');
    expect((await prisma.response.findUniqueOrThrow({ where: { clientId: tampered.clientId } })).answers).toMatchObject({ GENDER: 7 });
  });

  it('is idempotent: a retried upload is never stored twice, and ids cannot be hijacked', async () => {
    const one = interview({ AGE: 50, GENDER: 2, AWARE: [99] });
    await sync(ana, [one]).expect(200);
    const again = await sync(ana, [one]).expect(200);
    expect(again.body.results).toEqual([{ clientId: one.clientId, result: 'already_synced', status: 'complete' }]);
    expect(await prisma.response.count({ where: { clientId: one.clientId } })).toBe(1);
    const stolen = await sync(ben, [one]).expect(200);
    expect(stolen.body.results[0]).toMatchObject({ result: 'rejected' });
  });

  it('rejects interviews for surveys the interviewer was never assigned', async () => {
    const res = await sync(ben, [interview({ AGE: 40, GENDER: 2, AWARE: [99] })]).expect(200);
    expect(res.body.results[0]).toMatchObject({ result: 'rejected', reason: 'You are not assigned to this survey.' });
  });

  it('never overfills a quota: completes that arrive after it filled are kept as quota_full', async () => {
    const man1 = interview({ AGE: 30, GENDER: 1, AWARE: [99] });
    const man2 = interview({ AGE: 31, GENDER: 1, AWARE: [99] });
    const res = await sync(ana, [man1, man2]).expect(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['complete', 'quota_full']);
    expect(res.body.results[1].reason).toBe('quota_full_at_sync:QT_MEN');
    expect((await prisma.quotaCount.findFirstOrThrow({ where: { surveyId, quotaId: 'QT_MEN' } })).count).toBe(1);
  });

  it('keeps syncing after an assignment ends, and caps device-reported times', async () => {
    const list = (await http.get(`/api/surveys/${surveyId}/capi/assignments`).set(auth).expect(200)).body;
    await http.delete(`/api/surveys/${surveyId}/capi/assignments/${list.assignments[0].id}`).set(auth).expect(204);
    expect((await http.get('/api/capi/package').set(ana.headers).expect(200)).body.surveys).toEqual([]);
    const late = interview(
      { AGE: 44, GENDER: 2, AWARE: [99] },
      {
        startedAt: new Date(Date.now() + 86_400_000).toISOString(),
        finishedAt: new Date(Date.now() + 90_000_000).toISOString(),
        durationMs: 900_000,
      },
    );
    expect((await sync(ana, [late]).expect(200)).body.results[0]).toMatchObject({ result: 'stored', status: 'complete' });
    const r = await prisma.response.findUniqueOrThrow({ where: { clientId: late.clientId } });
    expect(r.completedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(r.durationMs).toBe(900_000);
  });

  it('shows CAPI work per interviewer on the fieldwork dashboard', async () => {
    const f = (await http.get(`/api/surveys/${surveyId}/fieldwork`).set(auth).expect(200)).body;
    expect(f.modes.capi).toBeGreaterThanOrEqual(7);
    expect(f.vendors.map((v: { vendor: string }) => v.vendor)).toEqual(['CAPI · Ana Field']);
    const list = (await http.get(`/api/surveys/${surveyId}/capi/assignments`).set(auth).expect(200)).body;
    expect(list.assignments[0]).toMatchObject({ active: false, completes: 4 });
  });

  it('validates the sync body', async () => {
    await http.post('/api/capi/sync').set(ana.headers).send({ deviceId: 'nope', interviews: [] }).expect(400);
  });
});
