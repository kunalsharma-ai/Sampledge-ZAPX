/**
 * Milestone 9: CATI call lists. Sample upload, encrypted phone numbers, the call queue (callbacks
 * first, one interviewer per case, leases), dispositions and retries, interviews through the same
 * engine with mode CATI, reopening, erasing phone numbers, and access rules.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.RUNTIME_BASE_URL = 'http://runtime.test';
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
import { casesFromCsv } from '../src/cati/cati.controller';
import { normalizePhone } from '../src/cati/cati.service';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m9${Date.now().toString(36)}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let ana: Record<string, string>;
let ben: Record<string, string>;
let surveyId: string;

async function member(name: string, role: string) {
  const email = `${name}-${run}@test.zapx`;
  const u = (await http.post('/api/users').set(admin).send({ name, email, password: 'member-password-1', role }).expect(201)).body;
  const token = (await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token;
  return { id: u.id as string, auth: { Authorization: `Bearer ${token}` } };
}

const next = async (who: Record<string, string>) => (await http.post(`/api/cati/surveys/${surveyId}/next`).set(who).expect(200)).body.case;
const dispose = (who: Record<string, string>, id: string, body: Record<string, unknown>) =>
  http.post(`/api/cati/cases/${id}/disposition`).set(who).send(body);

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' });
  admin = { Authorization: `Bearer ${reg.body.token}` };
  const pid = (await http.post('/api/projects').set(admin).send({ name: 'Phone study' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${pid}/surveys`).set(admin).send({ name: 'CATI survey' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition: demo }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);
  const a = await member('ana', 'INTERVIEWER');
  const b = await member('ben', 'INTERVIEWER');
  ana = a.auth;
  ben = b.auth;
  for (const who of [a, b])
    await http.post(`/api/surveys/${surveyId}/capi/assignments`).set(admin).send({ interviewerId: who.id }).expect(201);
});

afterAll(async () => {
  await app?.close();
});

describe('call lists', () => {
  it('reads phone numbers and sample columns from CSV', () => {
    expect(normalizePhone('+44 (20) 7946-0018')).toBe('+442079460018');
    expect(normalizePhone('12')).toBeNull();
    const cases = casesFromCsv('﻿ID,Phone,Name,Region\nA1,+91 98100 00001,Asha,North\n');
    expect(cases).toEqual([{ code: 'A1', phone: '+91 98100 00001', name: 'Asha', data: { Region: 'North' } }]);
    expect(() => casesFromCsv('name,email\nx,y')).toThrow(/"id" column and a "phone" column/);
  });

  it('uploads a sample, skips bad rows and stores phone numbers encrypted', async () => {
    const csv = [
      'id,phone,name,region',
      'C1,+91 98100 00001,Asha,North',
      'C2,+91 98100 00002,Ravi,South',
      'C3,not a phone,Bad,East',
      'C1,+91 98100 00009,Dup,West',
      'C4,+91 98100 00004,,West',
      'C5,+91 98100 00005,Meera,East',
    ].join('\n');
    const res = await http
      .post(`/api/surveys/${surveyId}/cati/cases/upload`)
      .set(admin)
      .attach('file', Buffer.from(csv), 'sample.csv')
      .field('maxAttempts', '3')
      .expect(201);
    expect(res.body.added).toBe(4);
    expect(res.body.skipped.map((s: { reason: string }) => s.reason)).toEqual([
      'The phone number is not valid',
      'This id appears twice in the file',
    ]);
    const again = await http
      .post(`/api/surveys/${surveyId}/cati/cases`)
      .set(admin)
      .send({ cases: [{ code: 'C1', phone: '+911234567' }] })
      .expect(201);
    expect(again.body).toMatchObject({ added: 0, skipped: [{ reason: 'Already in the call list' }] });
    const stored = await prisma.catiCase.findFirstOrThrow({ where: { surveyId, code: 'C1' } });
    expect(stored.phoneSealed).not.toContain('9810000001');
    expect(stored).toMatchObject({ phoneHint: '001', maxAttempts: 3, data: { region: 'North' } });
    const listed = (await http.get(`/api/surveys/${surveyId}/cati/cases`).set(admin).expect(200)).body;
    expect(listed).toHaveLength(4);
    expect(listed[0]).toMatchObject({ phone: null, phoneHint: expect.stringMatching(/^…\d{3}$/) });
  });

  it('keeps the list to people who manage the survey', async () => {
    await http.get(`/api/surveys/${surveyId}/cati/cases`).set(ana).expect(403);
    await http
      .post(`/api/surveys/${surveyId}/cati/cases`)
      .set(ana)
      .send({ cases: [{ code: 'X', phone: '+911234567' }] })
      .expect(403);
    const viewer = await member('vic', 'VIEWER');
    await http.get(`/api/surveys/${surveyId}/cati/summary`).set(viewer.auth).expect(200);
    await http
      .post(`/api/surveys/${surveyId}/cati/cases`)
      .set(viewer.auth)
      .send({ cases: [{ code: 'X', phone: '+911234567' }] })
      .expect(403);
  });
});

describe('calling', () => {
  it('lists assigned surveys and hands each interviewer a different case', async () => {
    const mine = (await http.get('/api/cati/surveys').set(ana).expect(200)).body;
    expect(mine).toEqual([{ id: surveyId, name: 'CATI survey', dueNow: 4, mine: 0 }]);
    const a = await next(ana);
    const b = await next(ben);
    expect(a.id).not.toBe(b.id);
    expect(a.phone).toMatch(/^\+91981000000\d$/);
    // Asking again returns the case already open, not a new one.
    expect((await next(ana)).id).toBe(a.id);
    expect(
      await prisma.auditEvent.count({ where: { action: 'cati.case_open', data: { path: ['caseId'], equals: a.id } } }),
    ).toBeGreaterThanOrEqual(2);
    // Someone else's open case cannot be touched.
    expect((await dispose(ben, a.id, { disposition: 'busy' })).status).toBe(409);
    await http.post(`/api/cati/cases/${a.id}/release`).set(ana).expect(204);
    await http.post(`/api/cati/cases/${b.id}/release`).set(ben).expect(204);
  });

  it('retries no-answer and busy later, and closes after the maximum attempts', async () => {
    const c = await next(ana);
    const r1 = (await dispose(ana, c.id, { disposition: 'no_answer' }).expect(200)).body;
    expect(r1).toMatchObject({ status: 'PENDING', attempts: 1, lastDisposition: 'no_answer' });
    expect(new Date(r1.nextCallAt).getTime() - Date.now()).toBeGreaterThan(110 * 60_000);
    // Make it due again twice more; the third failed attempt closes it (maxAttempts 3).
    for (const disposition of ['busy', 'answering_machine']) {
      await prisma.catiCase.update({ where: { id: c.id }, data: { nextCallAt: new Date(Date.now() - 1000) } });
      await prisma.catiCase.updateMany({
        where: { surveyId, id: { not: c.id }, status: 'PENDING' },
        data: { nextCallAt: new Date(Date.now() + 3_600_000) },
      });
      expect((await next(ana)).id).toBe(c.id);
      await dispose(ana, c.id, { disposition }).expect(200);
    }
    expect(await prisma.catiCase.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
      status: 'CLOSED',
      closedReason: 'max_attempts',
      attempts: 3,
    });
    // A programmer can reopen it for one more try.
    const reopened = (await http.post(`/api/cati/cases/${c.id}/reopen`).set(admin).expect(201)).body;
    expect(reopened).toMatchObject({ status: 'PENDING', maxAttempts: 4 });
    await prisma.catiCase.updateMany({ where: { surveyId, status: 'PENDING' }, data: { nextCallAt: new Date(Date.now() - 1000) } });
  });

  it('schedules callbacks and calls them first', async () => {
    const c = await next(ben);
    await dispose(ben, c.id, { disposition: 'callback' }).expect(400);
    await dispose(ben, c.id, { disposition: 'callback', callbackAt: new Date(Date.now() - 3_600_000).toISOString() }).expect(400);
    const at = new Date(Date.now() + 3_600_000);
    const r = (
      await dispose(ben, c.id, { disposition: 'callback', callbackAt: at.toISOString(), note: 'Asked to call after 6' }).expect(200)
    ).body;
    expect(r).toMatchObject({ status: 'CALLBACK', lastDisposition: 'callback' });
    // When the callback is due it comes before older pending cases, with the note visible.
    await prisma.catiCase.update({ where: { id: c.id }, data: { nextCallAt: new Date(Date.now() - 1000) } });
    const again = await next(ana);
    expect(again.id).toBe(c.id);
    expect(again.calls[0]).toMatchObject({ disposition: 'callback', note: 'Asked to call after 6' });
    await http.post(`/api/cati/cases/${c.id}/release`).set(ana).expect(204);
    expect((await prisma.catiCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('CALLBACK');
  });

  it('runs the interview through the runtime and closes the case when it ends', async () => {
    const c = await next(ana);
    await dispose(ana, c.id, { disposition: 'interviewed' }).expect(409);
    const started = (await http.post(`/api/cati/cases/${c.id}/interview`).set(ana).expect(200)).body;
    expect(started.runtimeUrl).toMatch(/^http:\/\/runtime\.test\/r\/[A-Za-z0-9_-]+$/);
    const token = started.runtimeUrl.split('/r/')[1];
    // The interview is not finished yet: still cannot record "interviewed". Resuming issues a new token.
    await dispose(ana, c.id, { disposition: 'interviewed' }).expect(409);
    const resumed = (await http.post(`/api/cati/cases/${c.id}/interview`).set(ana).expect(200)).body;
    expect(resumed.responseId).toBe(started.responseId);
    await http.get(`/api/public/r/${token}`).expect(404);
    const live = resumed.runtimeUrl.split('/r/')[1];
    await http
      .post(`/api/public/r/${live}/answers`)
      .send({ pageId: 'P1', answers: { AGE: 40, GENDER: 2 } })
      .expect(200);
    await http
      .post(`/api/public/r/${live}/answers`)
      .send({ pageId: 'P2', answers: { AWARE: [99] } })
      .expect(200);
    const end = (
      await http
        .post(`/api/public/r/${live}/answers`)
        .send({ pageId: 'P4', answers: { COMMENTS: 'By phone' } })
        .expect(200)
    ).body;
    expect(end.state).not.toBe('in_progress');
    const response = await prisma.response.findUniqueOrThrow({ where: { id: started.responseId } });
    expect(response).toMatchObject({ mode: 'CATI', uid: c.code, vendorId: null });
    expect(response.interviewerId).not.toBeNull();
    expect((response.entryParams as Record<string, string>).mode).toBe('cati');
    // Whatever the interviewer clicks, a finished interview closes the case as interviewed.
    const done = (await dispose(ana, c.id, { disposition: 'no_answer' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'DONE', lastDisposition: 'interviewed', closedReason: response.status.toLowerCase() });
    await http.post(`/api/cati/cases/${c.id}/interview`).set(ana).expect(409);
  });

  it('frees a case whose interviewer left, and closes it if the interview had finished', async () => {
    const c = await next(ben);
    await prisma.catiCase.update({ where: { id: c.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    // Keep every other case out of the way, so the abandoned one is the only case due.
    const hold = await prisma.catiCase.findMany({ where: { surveyId, id: { not: c.id }, status: { in: ['PENDING', 'CALLBACK'] } } });
    await prisma.catiCase.updateMany({
      where: { id: { in: hold.map((h) => h.id) } },
      data: { nextCallAt: new Date(Date.now() + 3_600_000) },
    });
    expect((await next(ana)).id).toBe(c.id);
    await dispose(ana, c.id, { disposition: 'refused', note: 'Not interested' }).expect(200);
    expect(await prisma.catiCase.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: 'CLOSED', closedReason: 'refused' });

    // A case whose interview finished after the screen was abandoned is closed, not handed out again.
    await prisma.catiCase.updateMany({ where: { id: { in: hold.map((h) => h.id) } }, data: { nextCallAt: new Date(Date.now() - 1000) } });
    const d = await next(ben);
    const s = (await http.post(`/api/cati/cases/${d.id}/interview`).set(ben).expect(200)).body;
    const live = s.runtimeUrl.split('/r/')[1];
    await http
      .post(`/api/public/r/${live}/answers`)
      .send({ pageId: 'P1', answers: { AGE: 35, GENDER: 1 } })
      .expect(200);
    await http
      .post(`/api/public/r/${live}/answers`)
      .send({ pageId: 'P2', answers: { AWARE: [99] } })
      .expect(200);
    const ended = (
      await http
        .post(`/api/public/r/${live}/answers`)
        .send({ pageId: 'P4', answers: { COMMENTS: 'Done' } })
        .expect(200)
    ).body;
    expect(ended.state).not.toBe('in_progress');
    await prisma.catiCase.update({ where: { id: d.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const rest = await prisma.catiCase.findMany({ where: { surveyId, id: { not: d.id }, status: { in: ['PENDING', 'CALLBACK'] } } });
    await prisma.catiCase.updateMany({
      where: { id: { in: rest.map((h) => h.id) } },
      data: { nextCallAt: new Date(Date.now() + 3_600_000) },
    });
    expect(await next(ana)).toBeNull();
    expect(await prisma.catiCase.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'DONE' });
  });

  it('is limited to assigned interviewers', async () => {
    const carl = await member('carl', 'INTERVIEWER');
    expect((await http.get('/api/cati/surveys').set(carl.auth).expect(200)).body).toEqual([]);
    await http.post(`/api/cati/surveys/${surveyId}/next`).set(carl.auth).expect(404);
  });

  it('summarises the list and erases phone numbers of finished cases', async () => {
    const summary = (await http.get(`/api/surveys/${surveyId}/cati/summary`).set(admin).expect(200)).body;
    expect(summary.cases.DONE).toBe(2);
    expect(summary.cases.CLOSED).toBe(1);
    expect(summary.dispositions).toMatchObject({ refused: 1, callback: 1, interviewed: 1 });
    expect(summary.callsLast24h.length).toBe(2);
    const erased = (await http.post(`/api/surveys/${surveyId}/cati/erase-phones`).set(admin).expect(200)).body;
    expect(erased.erased).toBe(3);
    const closed = await prisma.catiCase.findFirstOrThrow({ where: { surveyId, status: 'CLOSED' } });
    expect(closed).toMatchObject({ phoneSealed: '', phoneHint: '' });
    await http.post(`/api/cati/cases/${closed.id}/reopen`).set(admin).expect(409);
    const prog = await member('pia', 'PROGRAMMER');
    await http.post(`/api/surveys/${surveyId}/cati/erase-phones`).set(prog.auth).expect(403);
  });
});
