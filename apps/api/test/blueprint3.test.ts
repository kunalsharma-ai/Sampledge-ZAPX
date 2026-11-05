/**
 * Blueprint phase 3 over the API: CAPI interview evidence (page timestamps, interruptions, geofence),
 * signature and barcode answers, back-checks, the supervisor dashboard, quality appeals, and email
 * distribution (contacts, scheduled waves, reminders, one-click unsubscribe).
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
});

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { DistributionService } from '../src/distribution/distribution.service';
import type { EmailProvider, OutgoingEmail } from '../src/distribution/mailer';

const run = `bp3${Date.now().toString(36)}`;
let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let viewer: Record<string, string>;
let projectId: string;

let members = 0;
async function member(role: 'VIEWER' | 'INTERVIEWER', name: string = role) {
  const email = `${role.toLowerCase()}${++members}-${run}@test.zapx`;
  const created = (await http.post('/api/users').set(admin).send({ name, email, password: 'member-password-1', role }).expect(201)).body;
  const login = await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200);
  return { id: created.id as string, headers: { Authorization: `Bearer ${login.body.token}` } };
}

async function publish(name: string, definition: unknown) {
  const id = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name }).expect(201)).body.id as string;
  await http.put(`/api/surveys/${id}/draft`).set(admin).send({ definition }).expect(200);
  await http.post(`/api/surveys/${id}/publish`).set(admin).expect(201);
  return id;
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  viewer = (await member('VIEWER', 'Vee')).headers;
  projectId = (await http.post('/api/projects').set(admin).send({ name: 'Field study' }).expect(201)).body.id;
});

afterAll(async () => {
  await app?.close();
});

describe('face-to-face fieldwork', () => {
  let surveyId: string;
  let versionId: string;
  let ana: Awaited<ReturnType<typeof member>>;
  let ben: Awaited<ReturnType<typeof member>>;
  const deviceId = randomUUID();
  const ward = { lat: 28.6315, lon: 77.2167 };
  const inside = { ...ward, accuracy: 10, at: new Date().toISOString() };
  const outside = { lat: 28.7, lon: 77.2167, accuracy: 10, at: new Date().toISOString() };
  const definition = {
    schemaVersion: 1,
    title: 'Retail audit',
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'SHOP', type: 'open', text: 'Shop name' },
          { id: 'EAN', type: 'barcode', text: 'Scan the pack', pattern: '^\\d{13}$' },
        ],
      },
      { id: 'P2', questions: [{ id: 'SIG', type: 'signature', text: 'Shopkeeper signature' }] },
    ],
    settings: { capi: { gps: 'optional', geofences: [{ label: 'Ward 4', ...ward, radiusM: 2000 }] } },
  };
  let hour = 0;
  const interview = (clientId: string, over: Record<string, unknown> = {}) => {
    // Each interview an hour earlier, so none overlap.
    const end = Date.now() - ++hour * 3_600_000;
    return {
      clientId,
      surveyId,
      versionId,
      answers: { SHOP: `Shop ${clientId.slice(0, 6)}`, EAN: '4006381333931', SIG: '10,10 200,300 400,120;500,200 700,250' },
      startedAt: new Date(end - 600_000).toISOString(),
      finishedAt: new Date(end).toISOString(),
      durationMs: 420_000,
      location: { start: inside, end: inside },
      pageTimes: [
        { pageId: 'P1', shownAt: new Date(end - 600_000).toISOString(), ms: 300_000 },
        { pageId: 'P2', shownAt: new Date(end - 300_000).toISOString(), ms: 120_000 },
        { pageId: 'NOT_A_PAGE', shownAt: 'x', ms: 1 },
      ],
      ...over,
    };
  };
  const sync = (who: { headers: Record<string, string> }, interviews: unknown[]) =>
    http.post('/api/capi/sync').set(who.headers).send({ deviceId, interviews }).expect(200);
  const ids: string[] = [];

  beforeAll(async () => {
    surveyId = await publish('Retail audit', definition);
    versionId = (await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } })).liveVersionId!;
    ana = await member('INTERVIEWER', 'Ana Field');
    ben = await member('INTERVIEWER', 'Ben Field');
    for (const who of [ana, ben])
      await http.post(`/api/surveys/${surveyId}/capi/assignments`).set(admin).send({ interviewerId: who.id, target: 10 }).expect(201);
  });

  it('keeps page timestamps and interruptions, and flags interviews outside the area', async () => {
    const good = randomUUID();
    const away = randomUUID();
    const res = await sync(ana, [
      interview(good, { interruptions: [{ kind: 'hidden', at: new Date().toISOString(), ms: 30_000 }] }),
      interview(away, {
        location: { start: outside, end: outside },
        interruptions: Array.from({ length: 7 }, () => ({ kind: 'paused', at: new Date().toISOString(), ms: 180_000 })),
      }),
    ]).then((r) => r.body.results);
    expect(res.map((r: { status: string }) => r.status)).toEqual(['complete', 'complete']);
    const a = await prisma.response.findUniqueOrThrow({ where: { clientId: good } });
    expect(a.evidence).toMatchObject({
      pageTimes: [
        { pageId: 'P1', ms: 300_000 },
        { pageId: 'P2', ms: 120_000 },
      ],
      interruptions: { count: 1, totalMs: 30_000 },
      geofence: { inside: true, nearest: { label: 'Ward 4', distanceM: 0 } },
    });
    expect((a.evidence as { pageTimes: unknown[] }).pageTimes).toHaveLength(2);
    expect(a.qualityFlags).toEqual([]);
    const b = await prisma.response.findUniqueOrThrow({ where: { clientId: away } });
    expect((b.qualityFlags as Array<{ code: string }>).map((f) => f.code).sort()).toEqual(['interrupted', 'outside_geofence']);
    expect(b.reviewState).toBe('PENDING');
    ids.push(good, away);

    const review = (await http.get(`/api/surveys/${surveyId}/quality?filter=pending`).set(admin).expect(200)).body;
    const item = review.items.find((i: { uid: string }) => i.uid === away);
    expect(item.evidence.geofence.inside).toBe(false);
    expect(item.signatures).toEqual([{ questionId: 'SIG', strokes: '10,10 200,300 400,120;500,200 700,250' }]);
  });

  it('checks barcode and signature answers on the server', async () => {
    const badCode = randomUUID();
    const badSig = randomUUID();
    const res = (
      await sync(ben, [
        interview(badCode, { answers: { SHOP: 'X', EAN: 'ABC', SIG: '1,1 2,2' } }),
        interview(badSig, { answers: { SHOP: 'Y', EAN: '4006381333931', SIG: '<svg onload=alert(1)>' } }),
      ])
    ).body.results;
    expect(res.map((r: { status: string }) => r.status)).toEqual(['technical_error', 'technical_error']);
    for (let i = 0; i < 4; i++) {
      const id = randomUUID();
      await sync(ben, [interview(id)]);
      ids.push(id);
    }
  });

  it('shows supervisors productivity, exceptions and a map', async () => {
    const d = (await http.get(`/api/surveys/${surveyId}/supervisor`).set(viewer).expect(200)).body;
    expect(d.totals).toMatchObject({ completes: 6, target: 20, exceptions: 1 });
    const a = d.interviewers.find((i: { name: string }) => i.name === 'Ana Field');
    expect(a).toMatchObject({ completes: 2, outsideArea: 1, exceptions: 1, medianLoiMs: 420_000, interruptionsPerInterview: 4 });
    const b = d.interviewers.find((i: { name: string }) => i.name === 'Ben Field');
    expect(b).toMatchObject({ interviews: 6, completes: 4 });
    expect(d.exceptions[0].flags.map((f: { code: string }) => f.code).sort()).toEqual(['interrupted', 'outside_geofence']);
    expect(d.map.fences).toEqual([{ label: 'Ward 4', ...ward, radiusM: 2000 }]);
    expect(d.map.points).toHaveLength(8);
    expect(d.daily.reduce((n: number, x: { completes: number }) => n + x.completes, 0)).toBe(6);
    await http.get(`/api/surveys/${surveyId}/supervisor`).set(ana.headers).expect(403);
  });

  let failedResponse: string;
  it('draws back-checks per interviewer and rejects an interview that fails one', async () => {
    await http.post(`/api/surveys/${surveyId}/backchecks/sample`).set(viewer).send({ percent: 50 }).expect(403);
    const s = (
      await http.post(`/api/surveys/${surveyId}/backchecks/sample`).set(admin).send({ percent: 25, minPerInterviewer: 1 }).expect(201)
    ).body;
    // Ana: max(1, ceil(2 * 25%)) = 1; Ben: max(1, ceil(4 * 25%)) = 1.
    expect(s).toEqual({ drawn: 2, eligible: 6 });
    const again = (await http.post(`/api/surveys/${surveyId}/backchecks/sample`).set(admin).send({ percent: 100 }).expect(201)).body;
    expect(again).toEqual({ drawn: 4, eligible: 4 });
    const list = (await http.get(`/api/surveys/${surveyId}/backchecks?state=pending`).set(admin).expect(200)).body;
    expect(list.items).toHaveLength(6);
    const [first, second] = list.items;
    await http.put(`/api/surveys/${surveyId}/backchecks/${first.id}`).set(admin).send({ state: 'FAILED' }).expect(400);
    const failed = (
      await http
        .put(`/api/surveys/${surveyId}/backchecks/${first.id}`)
        .set(admin)
        .send({ state: 'FAILED', mismatches: ['SHOP'], note: 'Shopkeeper says nobody visited' })
        .expect(200)
    ).body;
    expect(failed).toEqual({ ok: true, rejected: true });
    failedResponse = first.responseId;
    const r = await prisma.response.findUniqueOrThrow({ where: { id: failedResponse } });
    expect(r).toMatchObject({ status: 'QUALITY_FAIL', reviewState: 'REJECTED' });
    await http.put(`/api/surveys/${surveyId}/backchecks/${second.id}`).set(admin).send({ state: 'VERIFIED', method: 'VISIT' }).expect(200);
    const after = (await http.get(`/api/surveys/${surveyId}/backchecks`).set(admin).expect(200)).body;
    expect(after.counts).toMatchObject({ pending: 4, failed: 1, verified: 1 });
    expect(after.items.find((i: { id: string }) => i.id === second.id)).toMatchObject({
      state: 'verified',
      method: 'visit',
      checkedBy: 'Admin',
    });
  });

  it('lets the interviewer appeal and a supervisor reinstate the interview', async () => {
    const r = await prisma.response.findUniqueOrThrow({ where: { id: failedResponse } });
    const owner = r.interviewerId === ana.id ? ana : ben;
    const stranger = owner === ana ? ben : ana;
    const mine = (await http.get('/api/capi/interviews').set(owner.headers).expect(200)).body;
    expect(mine.find((i: { clientId: string }) => i.clientId === r.clientId)).toMatchObject({ status: 'quality_fail', canAppeal: true });
    await http
      .post('/api/capi/appeals')
      .set(stranger.headers)
      .send({ clientId: r.clientId, message: 'Not mine but let me try' })
      .expect(404);
    await http
      .post('/api/capi/appeals')
      .set(owner.headers)
      .send({ clientId: r.clientId, message: 'I visited; the owner was away, his son answered.' })
      .expect(201);
    await http.post('/api/capi/appeals').set(owner.headers).send({ clientId: r.clientId, message: 'Again please' }).expect(400);
    const appeals = (await http.get(`/api/surveys/${surveyId}/appeals`).set(admin).expect(200)).body;
    expect(appeals[0]).toMatchObject({ uid: r.clientId, state: 'open', responseStatus: 'quality_fail' });
    await http.put(`/api/surveys/${surveyId}/appeals/${appeals[0].id}`).set(admin).send({ decision: 'overturn', note: '' }).expect(400);
    await http
      .put(`/api/surveys/${surveyId}/appeals/${appeals[0].id}`)
      .set(admin)
      .send({ decision: 'overturn', note: 'Son confirmed by phone' })
      .expect(200);
    expect(await prisma.response.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'COMPLETE', reviewState: 'ACCEPTED' });
    await http.put(`/api/surveys/${surveyId}/appeals/${appeals[0].id}`).set(admin).send({ decision: 'uphold', note: 'x' }).expect(400);
    const after = (await http.get('/api/capi/interviews').set(owner.headers).expect(200)).body;
    expect(after.find((i: { clientId: string }) => i.clientId === r.clientId)).toMatchObject({
      status: 'complete',
      appeal: { state: 'overturned' },
    });
  });
});

class FakeMail implements EmailProvider {
  readonly name = 'fake';
  sent: OutgoingEmail[] = [];
  failFor = new Set<string>();
  async send(mail: OutgoingEmail) {
    if (this.failFor.has(mail.to.email)) throw new Error('mailbox unavailable');
    this.sent.push(mail);
  }
}

describe('email distribution', () => {
  let surveyId: string;
  const mail = new FakeMail();
  const linkOf = (to: string) => {
    const m = mail.sent.filter((x) => x.to.email === to).at(-1)!;
    return new URL(/https?:\/\/\S+\/s\/\S+/.exec(m.text)![0]);
  };

  beforeAll(async () => {
    surveyId = await publish('Customer survey', {
      schemaVersion: 1,
      title: 'Customer survey',
      urlVariables: [{ id: 'REGION', param: 'region' }],
      pages: [{ id: 'P1', questions: [{ id: 'Q1', type: 'open', text: 'Anything to add, from {{REGION}}?' }] }],
    });
  });

  it('imports contacts from CSV and reports bad rows', async () => {
    const csv =
      'email,name,region,uid,bad column\nasha@example.com,Asha,North,should-not-pass,x\nnot-an-email,Bob,South\nchen@example.com,Chen,East\nASHA@example.com,Dup,West\ndev@example.com,Dev,South\n';
    const r = (await http.post(`/api/surveys/${surveyId}/contacts/import`).set(admin).send({ csv }).expect(201)).body;
    expect(r).toMatchObject({ added: 3, updated: 0, ignoredColumns: ['uid', 'bad column'] });
    expect(r.errors.map((e: { row: number }) => e.row)).toEqual([3, 5]);
    await http.post(`/api/surveys/${surveyId}/contacts/import`).set(viewer).send({ csv }).expect(403);
    const c = (await http.get(`/api/surveys/${surveyId}/contacts`).set(admin).expect(200)).body;
    expect(c).toMatchObject({ total: 3, unsubscribed: 0, emailEnabled: false });
    expect(c.items[0]).toMatchObject({ email: 'asha@example.com', fields: { region: 'North' } });
  });

  let waveId: string;
  it('sends a scheduled wave with personal links, then reminds people who did not finish', async () => {
    await http
      .post(`/api/surveys/${surveyId}/distributions`)
      .set(admin)
      .send({ name: 'Wave 1', subject: 'Your view', body: 'Hello [name]', sendAt: new Date().toISOString() })
      .expect(400);
    const t0 = new Date(Date.now() + 3_600_000);
    // The job pass is server-wide: first send any waves other runs left in this database (e2e
    // waves wait while sending is off), so the counts below are this survey's alone.
    await app.get(DistributionService).pass(new FakeMail(), new Date(t0.getTime() + 1000));
    waveId = (
      await http
        .post(`/api/surveys/${surveyId}/distributions`)
        .set(admin)
        .send({
          name: 'Wave 1',
          subject: 'Your view, [name]',
          body: 'Hello [name], please answer: [link]',
          sendAt: t0.toISOString(),
          reminderDays: 3,
          maxReminders: 1,
        })
        .expect(201)
    ).body.id;
    const svc = app.get(DistributionService);
    // Sending is off: nothing goes out. Not yet due: nothing goes out.
    expect(await svc.pass(null, new Date(t0.getTime() + 1000))).toEqual({ sent: 0, failed: 0, reminded: 0 });
    expect(await svc.pass(mail, new Date())).toEqual({ sent: 0, failed: 0, reminded: 0 });
    mail.failFor.add('dev@example.com');
    expect(await svc.pass(mail, new Date(t0.getTime() + 1000))).toEqual({ sent: 2, failed: 1, reminded: 0 });
    expect(mail.sent.map((m) => m.subject).sort()).toEqual(['Your view, Asha', 'Your view, Chen']);
    const link = linkOf('asha@example.com');
    expect(link.pathname).toBe(`/s/${surveyId}`);
    expect(link.searchParams.get('region')).toBe('North');
    expect(link.searchParams.get('uid')).toMatch(/^inv-/);
    expect(mail.sent[0]!.text).toContain('To stop receiving these emails:');

    // Asha answers through her link; Chen does not.
    const s = (
      await http
        .post(`/api/public/s/${surveyId}/start`)
        .send({ query: Object.fromEntries(link.searchParams) })
        .expect(200)
    ).body;
    expect(s.state).toBe('in_progress');
    const done = (
      await http
        .post(`/api/public/r/${s.token}/answers`)
        .send({ pageId: 'P1', answers: { Q1: 'All good' } })
        .expect(200)
    ).body;
    expect(done).toMatchObject({ state: 'finished', status: 'complete' });

    const waves = (await http.get(`/api/surveys/${surveyId}/distributions`).set(admin).expect(200)).body;
    expect(waves.items[0]).toMatchObject({ state: 'sent', invited: 3, sent: 2, failed: 1, started: 1, completed: 1 });

    const later = new Date(t0.getTime() + 3 * 24 * 3_600_000 + 5000);
    expect(await svc.pass(mail, later)).toEqual({ sent: 0, failed: 0, reminded: 1 });
    expect(mail.sent.at(-1)).toMatchObject({ to: { email: 'chen@example.com' }, subject: 'Reminder: Your view, Chen' });
    // Only one reminder was asked for.
    expect(await svc.pass(mail, new Date(later.getTime() + 10 * 24 * 3_600_000))).toEqual({ sent: 0, failed: 0, reminded: 0 });
  });

  it('downloads personal links and unsubscribes with one click', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/distributions/${waveId}/links.csv`).set(admin).expect(200)).text;
    expect(csv.split('\r\n')[0]).toBe('email,phone,name,link,unsubscribed');
    expect(csv).toContain('chen@example.com,,Chen,http');
    const chen = linkOf('chen@example.com').searchParams.get('uid')!;
    const form = await http.get(`/api/public/unsubscribe/${chen}`).expect(200);
    expect(form.text).toContain('<form method="post">');
    // Opening the link does not unsubscribe (link scanners); the POST does.
    expect((await prisma.contact.findFirstOrThrow({ where: { surveyId, email: 'chen@example.com' } })).unsubscribedAt).toBeNull();
    expect((await http.post(`/api/public/unsubscribe/${chen}`).expect(200)).text).toContain('You are unsubscribed');
    expect((await http.post('/api/public/unsubscribe/inv-nope').expect(200)).text).toContain('not valid');
    const c = (await http.get(`/api/surveys/${surveyId}/contacts`).set(admin).expect(200)).body;
    expect(c.unsubscribed).toBe(1);

    // A second wave skips the person who opted out.
    const w2 = (
      await http
        .post(`/api/surveys/${surveyId}/distributions`)
        .set(admin)
        .send({ name: 'Wave 2', subject: 'Again', body: '[link]', sendAt: new Date().toISOString() })
        .expect(201)
    ).body.id;
    mail.failFor.clear();
    const before = mail.sent.length;
    await app.get(DistributionService).pass(mail, new Date(Date.now() + 1000));
    expect(
      mail.sent
        .slice(before)
        .map((m) => m.to.email)
        .sort(),
    ).toEqual(['asha@example.com', 'dev@example.com']);
    await http.post(`/api/surveys/${surveyId}/distributions/${w2}/cancel`).set(admin).expect(204);
    const waves = (await http.get(`/api/surveys/${surveyId}/distributions`).set(admin).expect(200)).body;
    expect(waves.items.find((w: { id: string }) => w.id === w2).state).toBe('cancelled');
  });
});
