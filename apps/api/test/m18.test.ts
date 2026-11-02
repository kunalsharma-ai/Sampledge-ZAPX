/**
 * Milestone 18: calling rules for CATI. Calling hours in the respondent's own time zone (callbacks
 * keep their agreed time), and the organization's do-not-call list: a respondent's request, uploads,
 * hashes only, and that listed numbers are never offered again in any survey.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
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
import { casesFromCsv, phonesFromCsv } from '../src/cati/cati.controller';
import { isTimeZone, withinHours } from '../src/cati/calling-rules';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m18${Date.now().toString(36)}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let programmer: Record<string, string>;
let ana: Record<string, string>;
let projectId: string;

async function member(name: string, role: string) {
  const email = `${name}-${run}@test.zapx`;
  const u = (await http.post('/api/users').set(admin).send({ name, email, password: 'member-password-1', role }).expect(201)).body;
  const token = (await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token;
  return { id: u.id as string, auth: { Authorization: `Bearer ${token}` } };
}

async function phoneSurvey(name: string, interviewerId: string) {
  const id = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name }).expect(201)).body.id as string;
  await http.put(`/api/surveys/${id}/draft`).set(admin).send({ definition: demo }).expect(200);
  await http.post(`/api/surveys/${id}/publish`).set(admin).expect(201);
  await http.post(`/api/surveys/${id}/capi/assignments`).set(admin).send({ interviewerId }).expect(201);
  return id;
}
const next = async (surveyId: string) => (await http.post(`/api/cati/surveys/${surveyId}/next`).set(ana).expect(200)).body.case;
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** A two-hour window that does not contain the current time in UTC. */
function closedWindow() {
  const now = new Date();
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  return m < 720 ? { from: hm(m + 120), until: hm(m + 240) } : { from: hm(m - 240), until: hm(m - 120) };
}

let anaId: string;
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
  projectId = (await http.post('/api/projects').set(admin).send({ name: 'Phone study' }).expect(201)).body.id;
  const a = await member('ana', 'INTERVIEWER');
  ana = a.auth;
  anaId = a.id;
  programmer = (await member('pat', 'PROGRAMMER')).auth;
});

afterAll(async () => {
  await app?.close();
});

describe('calling rules', () => {
  it('knows time zones and local hours', () => {
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone("UTC'; DROP")).toBe(false);
    const h = { timeZone: 'UTC', callFrom: 9 * 60, callUntil: 21 * 60, days: [1, 2, 3, 4, 5] };
    const mondayNoonUtc = new Date('2026-11-02T12:00:00Z');
    expect(withinHours(h, mondayNoonUtc)).toBe(true);
    expect(withinHours(h, mondayNoonUtc, 'Pacific/Auckland')).toBe(false); // 01:00 Tuesday there
    expect(withinHours(h, new Date('2026-11-01T12:00:00Z'))).toBe(false); // Sunday
    expect(casesFromCsv('id,phone,tz\nA,+911234567,Asia/Kolkata\n')[0]).toMatchObject({ timeZone: 'Asia/Kolkata', data: {} });
    expect(phonesFromCsv('+91 98200 00001\n+91 98200 00002\n')).toEqual(['+91 98200 00001', '+91 98200 00002']);
    expect(phonesFromCsv('name,number\nA,+91 98200 00001\n')).toEqual(['+91 98200 00001']);
  });

  it('offers cases only inside calling hours in their own time zone; agreed callbacks keep their time', async () => {
    const surveyId = await phoneSurvey('Hours', anaId);
    const { added, skipped } = (
      await http
        .post(`/api/surveys/${surveyId}/cati/cases`)
        .set(admin)
        .send({
          cases: [
            { code: 'H1', phone: '+441234560001' },
            { code: 'H2', phone: '+441234560002', timeZone: 'Mars/Olympus' },
          ],
        })
        .expect(201)
    ).body;
    expect(added).toBe(1);
    expect(skipped).toEqual([{ row: 2, code: 'H2', reason: 'Unknown time zone Mars/Olympus' }]);
    expect((await http.get(`/api/surveys/${surveyId}/cati/hours`).set(ana).expect(403)).body).toBeTruthy();
    expect((await http.get(`/api/surveys/${surveyId}/cati/hours`).set(admin).expect(200)).body).toMatchObject({ set: false });

    // Hours that exclude now: nothing is offered.
    const shut = closedWindow();
    await http
      .put(`/api/surveys/${surveyId}/cati/hours`)
      .set(programmer)
      .send({ timeZone: 'Atlantis/Lost', ...shut, days: [1] })
      .expect(400);
    await http
      .put(`/api/surveys/${surveyId}/cati/hours`)
      .set(programmer)
      .send({ timeZone: 'UTC', from: '18:00', until: '09:00', days: [1] })
      .expect(400);
    const set = (
      await http
        .put(`/api/surveys/${surveyId}/cati/hours`)
        .set(programmer)
        .send({ timeZone: 'UTC', ...shut, days: [1, 2, 3, 4, 5, 6, 7] })
        .expect(200)
    ).body;
    expect(set).toMatchObject({ set: true, timeZone: 'UTC', ...shut });
    expect(await next(surveyId)).toBeNull();
    expect((await http.get(`/api/surveys/${surveyId}/cati/summary`).set(admin).expect(200)).body).toMatchObject({
      withinHoursNow: false,
      callingHours: { timeZone: 'UTC', ...shut },
    });

    // The same hours, but the case lives where it is now inside them.
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const window = { timeZone: 'UTC', callFrom: toMin(shut.from), callUntil: toMin(shut.until), days: [1, 2, 3, 4, 5, 6, 7] };
    // Etc/GMT-3 is UTC+3 (POSIX sign); find a whole-hour zone where it is inside the window now.
    const local = [...Array(27).keys()]
      .map((i) => i - 12)
      .map((h) => (h === 0 ? 'UTC' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`))
      .find((z) => withinHours(window, new Date(), z));
    expect(local).toBeTruthy();
    await http
      .post(`/api/surveys/${surveyId}/cati/cases`)
      .set(admin)
      .send({ cases: [{ code: 'H3', phone: '+441234560003', timeZone: local }] })
      .expect(201);
    const offered = await next(surveyId);
    expect(offered.code).toBe('H3');

    // An agreed callback is called at its time even outside hours.
    await http
      .post(`/api/cati/cases/${offered.id}/disposition`)
      .set(ana)
      .send({ disposition: 'callback', callbackAt: new Date(Date.now() + 1000).toISOString() })
      .expect(200);
    await prisma.catiCase.updateMany({
      where: { surveyId, code: 'H1' },
      data: { status: 'CALLBACK', nextCallAt: new Date(Date.now() - 1000) },
    });
    const cb = await next(surveyId);
    expect(cb.code).toBe('H1');

    // Clearing the hours lifts the restriction.
    await http.put(`/api/surveys/${surveyId}/cati/hours`).set(programmer).send({ clear: true }).expect(200);
    expect((await http.get(`/api/surveys/${surveyId}/cati/hours`).set(admin).expect(200)).body.set).toBe(false);
  });

  it('a respondent who asks not to be called is never offered again, in any survey', async () => {
    const one = await phoneSurvey('DNC one', anaId);
    const two = await phoneSurvey('DNC two', anaId);
    await http
      .post(`/api/surveys/${one}/cati/cases`)
      .set(admin)
      .send({ cases: [{ code: 'D1', phone: '+44 7700 900111' }] })
      .expect(201);
    await http
      .post(`/api/surveys/${two}/cati/cases`)
      .set(admin)
      .send({
        cases: [
          { code: 'E1', phone: '+447700900111' },
          { code: 'E2', phone: '+447700900222' },
        ],
      })
      .expect(201);
    const c = await next(one);
    const closed = (await http.post(`/api/cati/cases/${c.id}/disposition`).set(ana).send({ disposition: 'do_not_call' }).expect(200)).body;
    expect(closed).toMatchObject({ status: 'CLOSED', closedReason: 'do_not_call' });

    const list = (await http.get('/api/cati/do-not-call').set(programmer).expect(200)).body;
    expect(list.count).toBe(1);
    expect(list.latest[0]).toMatchObject({ hint: '…111', source: 'respondent' });
    const stored = await prisma.doNotCall.findFirstOrThrow({ where: { id: list.latest[0].id } });
    expect(JSON.stringify(stored)).not.toContain('7700900111');

    expect((await http.get(`/api/surveys/${two}/cati/summary`).set(admin).expect(200)).body.doNotCall).toBe(1);
    const offered = await next(two);
    expect(offered.code).toBe('E2');
    await http.post(`/api/cati/cases/${offered.id}/release`).set(ana).expect(204);
  });

  it('uploads numbers to the list, and only admins remove them', async () => {
    const survey = await phoneSurvey('DNC upload', anaId);
    await http
      .post(`/api/surveys/${survey}/cati/cases`)
      .set(admin)
      .send({ cases: [{ code: 'U1', phone: '+447700900333' }] })
      .expect(201);
    // Cases from before the list existed have no hash yet: the queue fills it in.
    await prisma.catiCase.updateMany({ where: { surveyId: survey }, data: { phoneHash: null } });
    const up = (
      await http
        .post('/api/cati/do-not-call/upload')
        .set(programmer)
        .attach('file', Buffer.from('phone\n+44 7700 900333\n+447700900111\nnot a number\n'), 'dnc.csv')
        .expect(200)
    ).body;
    expect(up).toMatchObject({ added: 1, alreadyListed: 1, invalidCount: 1 });
    await http
      .post('/api/cati/do-not-call')
      .set(ana)
      .send({ phones: ['+447700900444'] })
      .expect(403);
    expect(await next(survey)).toBeNull();
    expect((await prisma.catiCase.findFirstOrThrow({ where: { surveyId: survey } })).phoneHash).toMatch(/^[0-9a-f]{40}$/);

    const entry = (await http.get('/api/cati/do-not-call').set(admin).expect(200)).body.latest.find(
      (d: { hint: string }) => d.hint === '…333',
    );
    await http.delete(`/api/cati/do-not-call/${entry.id}`).set(programmer).expect(403);
    await http.delete(`/api/cati/do-not-call/${entry.id}`).set(admin).expect(204);
    expect((await next(survey)).code).toBe('U1');
  });
});
