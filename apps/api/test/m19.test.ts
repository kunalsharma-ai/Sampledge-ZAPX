/**
 * Milestone 19: the phone dialer. The Twilio adapter against a local stand-in of the Twilio API:
 * the interviewer's phone rings first, the respondent is dialled from the caller id when they
 * answer (with the recording notice), interviewers never see the number, webhooks need a valid
 * X-Twilio-Signature, the do-not-call list is checked again at dialling time, and a recording is
 * copied into the interview's captures and then deleted at Twilio (or discarded without an interview).
 */
import { vi } from 'vitest';

const PORT = 5291;
vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.TELEPHONY = 'twilio';
  process.env.TWILIO_ACCOUNT_SID = `AC${'1'.repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
  process.env.TWILIO_CALLER_ID = '+442070000000';
  process.env.TWILIO_API_BASE = 'http://127.0.0.1:5291';
  process.env.TELEPHONY_WEBHOOK_BASE = 'https://zapx.test/api';
});

import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { TelephonyService, TwilioProvider, twilioSignature } from '../src/cati/telephony.service';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m19${Date.now().toString(36)}`;
const SID = `AC${'1'.repeat(32)}`;
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000, 7)]);

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let telephony: TelephonyService;
let admin: Record<string, string>;
let ana: Record<string, string>;
let anaId: string;
let projectId: string;
let twilio: Server;
let failFetch = false;
const seen: Array<{ method: string; path: string; auth?: string; form: URLSearchParams }> = [];

async function phoneSurvey(name: string, dialer?: { recordCalls: boolean; recordingNotice?: string }) {
  const id = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name }).expect(201)).body.id as string;
  await http.put(`/api/surveys/${id}/draft`).set(admin).send({ definition: demo }).expect(200);
  await http.post(`/api/surveys/${id}/publish`).set(admin).expect(201);
  await http.post(`/api/surveys/${id}/capi/assignments`).set(admin).send({ interviewerId: anaId }).expect(201);
  if (dialer)
    await http
      .put(`/api/surveys/${id}/cati/dialer`)
      .set(admin)
      .send({ enabled: true, ...dialer })
      .expect(200);
  return id;
}
async function caseIn(surveyId: string, code: string, phone: string) {
  await http
    .post(`/api/surveys/${surveyId}/cati/cases`)
    .set(admin)
    .send({ cases: [{ code, phone }] })
    .expect(201);
  return (await http.post(`/api/cati/surveys/${surveyId}/next`).set(ana).expect(200)).body.case;
}

/** Post a webhook the way Twilio does: form-encoded, signed over the public URL and the parameters. */
function hook(name: string, dialId: string, params: Record<string, string>, signature?: string) {
  const path = `/telephony/twilio/${name}?d=${encodeURIComponent(dialId)}`;
  const sig = signature ?? twilioSignature('test-auth-token', `https://zapx.test/api${path}`, params);
  return http.post(`/api${path}`).set('X-Twilio-Signature', sig).type('form').send(params);
}
const dialRow = (id: string) => prisma.catiDial.findUniqueOrThrow({ where: { id } });
async function until<T>(f: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 50; i++) {
    const v = await f();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

beforeAll(async () => {
  twilio = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = req.url ?? '';
      seen.push({
        method: req.method ?? '',
        path,
        auth: req.headers.authorization,
        form: new URLSearchParams(Buffer.concat(chunks).toString()),
      });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && path === `/2010-04-01/Accounts/${SID}/Calls.json`) {
        return res.end(JSON.stringify({ sid: `CA${randomBytes(16).toString('hex')}`, status: 'queued' }));
      }
      if (req.method === 'POST' && /\/Calls\/CA[0-9a-f]{32}\.json$/.test(path)) return res.end(JSON.stringify({ status: 'completed' }));
      if (req.method === 'GET' && /\/Recordings\/RE[0-9a-f]{32}\.mp3$/.test(path)) {
        if (failFetch) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ code: 20404, message: 'The requested resource was not found' }));
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.end(MP3);
      }
      if (req.method === 'DELETE' && /\/Recordings\/RE[0-9a-f]{32}\.json$/.test(path)) {
        res.statusCode = 204;
        return res.end();
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ message: 'unknown' }));
    });
  });
  await new Promise<void>((r) => twilio.listen(PORT, '127.0.0.1', r));
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  telephony = app.get(TelephonyService);
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' });
  admin = { Authorization: `Bearer ${reg.body.token}` };
  projectId = (await http.post('/api/projects').set(admin).send({ name: 'Phone study' }).expect(201)).body.id;
  const email = `ana-${run}@test.zapx`;
  anaId = (
    await http.post('/api/users').set(admin).send({ name: 'Ana', email, password: 'member-password-1', role: 'INTERVIEWER' }).expect(201)
  ).body.id;
  ana = {
    Authorization: `Bearer ${(await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token}`,
  };
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => twilio?.close(r));
});

describe('phone dialer', () => {
  it('signs webhooks the way Twilio documents it', () => {
    // The example from Twilio's webhook security documentation.
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
    expect(twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  });

  it('is set up per survey, and only when the installation has a provider', async () => {
    const surveyId = await phoneSurvey('Settings');
    expect((await http.get(`/api/surveys/${surveyId}/cati/dialer`).set(admin).expect(200)).body).toMatchObject({
      available: true,
      enabled: false,
      recordCalls: false,
    });
    await http.put(`/api/surveys/${surveyId}/cati/dialer`).set(ana).send({ enabled: true, recordCalls: false }).expect(403);
    telephony.useProvider(null);
    await http.put(`/api/surveys/${surveyId}/cati/dialer`).set(admin).send({ enabled: true, recordCalls: false }).expect(409);
    telephony.useProvider(new TwilioProvider(SID, 'test-auth-token', `http://127.0.0.1:${PORT}`));
    const on = (
      await http
        .put(`/api/surveys/${surveyId}/cati/dialer`)
        .set(admin)
        .send({ enabled: true, recordCalls: true, recordingNotice: 'Recorded.' })
        .expect(200)
    ).body;
    expect(on).toMatchObject({ enabled: true, recordCalls: true, recordingNotice: 'Recorded.' });

    // The interviewer's own phone: international form only, stored sealed.
    expect((await http.get('/api/cati/me').set(ana).expect(200)).body).toEqual({ dialerAvailable: true, phoneHint: null });
    await http.put('/api/cati/me/phone').set(ana).send({ phone: '07700 900123' }).expect(400);
    expect((await http.put('/api/cati/me/phone').set(ana).send({ phone: '+44 7700 900123' }).expect(200)).body.phoneHint).toBe('…123');
    const u = await prisma.user.findUniqueOrThrow({ where: { id: anaId } });
    expect(u.phoneSealed).not.toContain('7700900123');
  });

  it('rings the interviewer, then dials the hidden respondent with the recording notice, and keeps the recording', async () => {
    const surveyId = await phoneSurvey('Recorded', { recordCalls: true, recordingNotice: 'This call is recorded.' });
    const c = await caseIn(surveyId, 'R1', '+44 20 7946 0001');
    expect(c.phone).toBeNull();
    expect(c.dialer).toEqual({ record: true });

    seen.length = 0;
    const dial = (await http.post(`/api/cati/cases/${c.id}/dial`).set(ana).expect(200)).body;
    expect(dial).toMatchObject({ status: 'queued', record: true, recordingStatus: 'none' });
    const placed = seen.find((s) => s.path.endsWith('/Calls.json'))!;
    expect(placed.auth).toBe(`Basic ${Buffer.from(`${SID}:test-auth-token`).toString('base64')}`);
    expect(placed.form.get('To')).toBe('+447700900123');
    expect(placed.form.get('From')).toBe('+442070000000');
    expect(placed.form.get('Url')).toBe(`https://zapx.test/api/telephony/twilio/answer?d=${dial.id}`);
    expect(placed.form.getAll('StatusCallbackEvent')).toEqual(['initiated', 'ringing', 'answered', 'completed']);
    await http.post(`/api/cati/cases/${c.id}/dial`).set(ana).expect(409);

    // Webhooks need Twilio's signature.
    await hook('answer', dial.id, { CallSid: 'x' }, 'forged').expect(403);
    await http.post(`/api/telephony/twilio/answer?d=${dial.id}`).type('form').send({}).expect(403);
    await hook('status', dial.id, { CallStatus: 'ringing' }).expect(204);
    expect((await dialRow(dial.id)).status).toBe('ringing');
    const answered = await hook('answer', dial.id, { CallStatus: 'in-progress' }).expect(200);
    expect(answered.headers['content-type']).toMatch(/text\/xml/);
    expect(answered.text).toContain('callerId="+442070000000"');
    expect(answered.text).toContain('record="record-from-answer-dual"');
    expect(answered.text).toContain(`recordingStatusCallback="https://zapx.test/api/telephony/twilio/recording?d=${dial.id}"`);
    expect(answered.text).toMatch(
      /<Number url="https:\/\/zapx\.test\/api\/telephony\/twilio\/notice\?d=[^"]+" method="POST">\+442079460001<\/Number>/,
    );
    expect((await hook('notice', dial.id, {}).expect(200)).text).toContain('<Say>This call is recorded.</Say>');

    // The interview runs while connected; then the respondent hangs up.
    const { responseId } = (await http.post(`/api/cati/cases/${c.id}/interview`).set(ana).expect(200)).body;
    expect((await hook('bridged', dial.id, { DialCallStatus: 'completed', DialCallDuration: '42' }).expect(200)).text).toContain(
      '<Hangup/>',
    );
    await hook('status', dial.id, { CallStatus: 'completed', CallDuration: '50' }).expect(204);
    seen.length = 0;
    const rec = `RE${'a'.repeat(32)}`;
    await hook('recording', dial.id, { RecordingSid: rec, RecordingStatus: 'completed', RecordingDuration: '41' }).expect(204);
    const stored = await until(
      () => dialRow(dial.id),
      (d) => d.recordingStatus !== 'pending',
    );
    expect(stored).toMatchObject({ recordingStatus: 'stored', respondentStatus: 'completed', talkSeconds: 42, status: 'completed' });
    expect(seen.map((s) => `${s.method} ${s.path.split('/Accounts/')[1]}`)).toEqual([
      `GET ${SID}/Recordings/${rec}.mp3`,
      `DELETE ${SID}/Recordings/${rec}.json`,
    ]);
    const capture = await prisma.capture.findUniqueOrThrow({ where: { id: stored.captureId! } });
    expect(capture).toMatchObject({ responseId, kind: 'audio', ref: `call-${dial.id}`, contentType: 'audio/mpeg', size: MP3.length });
    // A repeated callback does nothing.
    await hook('recording', dial.id, { RecordingSid: rec, RecordingStatus: 'completed' }).expect(204);
    expect(await prisma.capture.count({ where: { responseId } })).toBe(1);

    const latest = (await http.get(`/api/cati/cases/${c.id}/dial`).set(ana).expect(200)).body.dial;
    expect(latest).toMatchObject({ id: dial.id, respondentStatus: 'completed', recordingStatus: 'stored' });
    // The case is closed: Twilio asking again is refused.
    await http.post(`/api/cati/cases/${c.id}/disposition`).set(ana).send({ disposition: 'refused' }).expect(200);
    expect((await hook('answer', dial.id, {}).expect(200)).text).toContain('This case is no longer open for you.');
  });

  it('checks the do-not-call list when dialling, keeps no recording without an interview, and retries copies', async () => {
    const surveyId = await phoneSurvey('Checks', { recordCalls: true });
    const c = await caseIn(surveyId, 'D1', '+44 20 7946 0002');
    const dial = (await http.post(`/api/cati/cases/${c.id}/dial`).set(ana).expect(200)).body;
    await http
      .post('/api/cati/do-not-call')
      .set(admin)
      .send({ phones: ['+442079460002'] })
      .expect(200);
    const refused = (await hook('answer', dial.id, {}).expect(200)).text;
    expect(refused).toContain('This number is on the do-not-call list.');
    expect(refused).not.toContain('<Dial');
    await hook('status', dial.id, { CallStatus: 'completed' }).expect(204);
    await http.post(`/api/cati/cases/${c.id}/release`).set(ana).expect(204);

    // A call that never became an interview: the recording is deleted at Twilio and not kept.
    const c2 = await caseIn(surveyId, 'D2', '+44 20 7946 0003');
    const d2 = (await http.post(`/api/cati/cases/${c2.id}/dial`).set(ana).expect(200)).body;
    expect((await hook('answer', d2.id, {}).expect(200)).text).toContain('+442079460003');
    seen.length = 0;
    await hook('recording', d2.id, { RecordingSid: `RE${'b'.repeat(32)}`, RecordingStatus: 'completed' }).expect(204);
    expect(
      (
        await until(
          () => dialRow(d2.id),
          (d) => d.recordingStatus !== 'pending',
        )
      ).recordingStatus,
    ).toBe('discarded');
    expect(seen.map((s) => s.method)).toEqual(['DELETE']);

    // Twilio fails to serve the file: the call keeps the reason, and housekeeping tries again.
    await hook('status', d2.id, { CallStatus: 'completed' }).expect(204);
    await http.post(`/api/cati/cases/${c2.id}/interview`).set(ana).expect(200);
    const d3 = (await http.post(`/api/cati/cases/${c2.id}/dial`).set(ana).expect(200)).body;
    failFetch = true;
    await hook('recording', d3.id, { RecordingSid: `RE${'c'.repeat(32)}`, RecordingStatus: 'completed' }).expect(204);
    const failed = await until(
      () => dialRow(d3.id),
      (d) => !!d.error,
    );
    expect(failed).toMatchObject({ recordingStatus: 'pending', recordingTries: 1 });
    expect(failed.error).toContain('The requested resource was not found');
    failFetch = false;
    expect(await telephony.retryRecordings()).toBeGreaterThanOrEqual(1);
    expect((await dialRow(d3.id)).recordingStatus).toBe('stored');
  });

  it('shows the number and refuses to dial on surveys without the dialer, or for interviewers without a phone', async () => {
    const surveyId = await phoneSurvey('By hand');
    const c = await caseIn(surveyId, 'M1', '+44 20 7946 0004');
    expect(c.phone).toBe('+442079460004');
    expect(c.dialer).toBeNull();
    await http.post(`/api/cati/cases/${c.id}/dial`).set(ana).expect(409);
    await http.post(`/api/cati/cases/${c.id}/release`).set(ana).expect(204);

    const dialled = await phoneSurvey('No phone', { recordCalls: false });
    await http.put('/api/cati/me/phone').set(ana).send({ phone: null }).expect(200);
    const c2 = await caseIn(dialled, 'M2', '+44 20 7946 0005');
    expect((await http.post(`/api/cati/cases/${c2.id}/dial`).set(ana).expect(409)).body.message).toContain(
      'phone number the dialer should ring',
    );
    await http.put('/api/cati/me/phone').set(ana).send({ phone: '+447700900123' }).expect(200);
    const d = (await http.post(`/api/cati/cases/${c2.id}/dial`).set(ana).expect(200)).body;
    expect(d.record).toBe(false);
    const twimlText = (await hook('answer', d.id, {}).expect(200)).text;
    expect(twimlText).not.toContain('record=');
    expect(twimlText).toContain('<Number>+442079460005</Number>');
    // Hanging up from the studio ends the call at Twilio.
    seen.length = 0;
    await http.post(`/api/cati/dials/${d.id}/hangup`).set(ana).expect(200);
    expect(seen[0]).toMatchObject({ method: 'POST' });
    expect(seen[0]!.form.get('Status')).toBe('completed');
  });
});
