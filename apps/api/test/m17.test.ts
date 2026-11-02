/**
 * Milestone 17: transcription. The Deepgram adapter against a local stand-in: a programmer asks for
 * transcripts, the job sends each recording once with the interview's language and the configured
 * model, the review queue shows the text, failures are reported, and erasing removes the text.
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
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { JobWorker } from '../src/jobs/job.worker';
import { DeepgramProvider, TranscriptionService } from '../src/captures/transcription.service';

const run = `m17${Date.now().toString(36)}`;
const WEBM = (n: number) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, n)]);

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let worker: JobWorker;
let transcription: TranscriptionService;
let admin: Record<string, string>;
let viewer: Record<string, string>;
let ana: { id: string; headers: Record<string, string> };
let surveyId: string;
let versionId: string;
let deepgram: Server;
const calls: Array<{ url: string; auth?: string; type?: string; bytes: number; fill: number }> = [];

const definition = {
  schemaVersion: 1,
  title: 'Doorstep',
  pages: [{ id: 'P1', questions: [{ id: 'SHOP', type: 'open', text: 'Shop name' }] }],
  settings: { capi: { gps: 'off', audio: 'consent' } },
};

async function member(role: 'VIEWER' | 'INTERVIEWER', name: string) {
  const email = `${role.toLowerCase()}-${run}@test.zapx`;
  const created = (await http.post('/api/users').set(admin).send({ name, email, password: 'member-password-1', role }).expect(201)).body;
  const login = await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200);
  return { id: created.id as string, headers: { Authorization: `Bearer ${login.body.token}` } };
}

/** One synced CAPI interview with a recording whose bytes are filled with `fill`. */
async function interviewWithRecording(fill: number, language?: string) {
  const clientId = randomUUID();
  await http
    .post('/api/capi/captures')
    .set(ana.headers)
    .field('clientId', clientId)
    .field('surveyId', surveyId)
    .field('ref', 'audio')
    .field('kind', 'audio')
    .attach('file', WEBM(fill), 'interview.webm')
    .expect(200);
  await http
    .post('/api/capi/sync')
    .set(ana.headers)
    .send({
      deviceId: randomUUID(),
      interviews: [
        {
          clientId,
          surveyId,
          versionId,
          answers: { SHOP: `Shop ${fill}` },
          startedAt: new Date(Date.now() - 600_000).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 540_000,
          audio: 'recorded',
          ...(language ? { language } : {}),
        },
      ],
    })
    .expect(200);
  const r = await prisma.response.findUniqueOrThrow({ where: { clientId }, include: { captures: true } });
  if (language) await prisma.response.update({ where: { id: r.id }, data: { language } });
  return r.captures.find((c) => c.kind === 'audio')!;
}

beforeAll(async () => {
  deepgram = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const fill = body[10] ?? 0;
      calls.push({ url: req.url ?? '', auth: req.headers.authorization, type: req.headers['content-type'], bytes: body.length, fill });
      if (fill === 9) return void res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"err_msg":"Bad audio"}');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          metadata: { duration: 541.2 },
          results: { channels: [{ alternatives: [{ transcript: `Interviewer: Good morning. Respondent: Hello, shop ${fill}.` }] }] },
        }),
      );
    });
  });
  await new Promise<void>((r) => deepgram.listen(0, '127.0.0.1', r));

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  worker = app.get(JobWorker);
  transcription = app.get(TranscriptionService);

  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  viewer = (await member('VIEWER', 'Vee')).headers;
  ana = await member('INTERVIEWER', 'Ana Field');
  const pid = (await http.post('/api/projects').set(admin).send({ name: 'Doorstep' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${pid}/surveys`).set(admin).send({ name: 'Doorstep' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);
  versionId = (await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } })).liveVersionId!;
  await http.post(`/api/surveys/${surveyId}/capi/assignments`).set(admin).send({ interviewerId: ana.id }).expect(201);
});

afterAll(async () => {
  await app?.close();
  await new Promise<void>((r) => (deepgram ? deepgram.close(() => r()) : r()));
});

describe('transcription', () => {
  it('is refused while no provider is set up', async () => {
    transcription.useProvider(null);
    await interviewWithRecording(1);
    expect((await http.get(`/api/surveys/${surveyId}/captures`).set(admin).expect(200)).body.transcription).toEqual({
      enabled: false,
      transcribed: 0,
    });
    const res = await http.post(`/api/surveys/${surveyId}/captures/transcribe`).set(admin).send({}).expect(400);
    expect(res.body.message).toMatch(/not turned on/);
    expect(calls).toHaveLength(0);
  });

  it('transcribes every recording once, in the interview language, and shows the text for review', async () => {
    transcription.useProvider(new DeepgramProvider('dg-key', 'test-model', `http://127.0.0.1:${(deepgram.address() as AddressInfo).port}`));
    await interviewWithRecording(2, 'fr-CA');
    await http.post(`/api/surveys/${surveyId}/captures/transcribe`).set(viewer).send({}).expect(403);
    const job = (await http.post(`/api/surveys/${surveyId}/captures/transcribe`).set(admin).send({}).expect(202)).body;
    expect(job.type).toBe('transcribe');
    await worker.runOnce();
    const done = (await http.get(`/api/jobs/${job.id}`).set(admin).expect(200)).body;
    expect(done.status).toBe('SUCCEEDED');
    expect(done.result).toMatchObject({ transcribed: 2, failed: 0 });

    expect(calls).toHaveLength(2);
    const fr = calls.find((c) => c.fill === 2)!;
    expect(fr.url).toBe('/v1/listen?model=test-model&smart_format=true&punctuate=true&language=fr');
    expect(fr).toMatchObject({ auth: 'Token dg-key', type: 'audio/webm', bytes: 2004 });
    expect(calls.find((c) => c.fill === 1)!.url).toContain('language=en');

    const queue = (await http.get(`/api/surveys/${surveyId}/quality?filter=accepted`).set(admin).expect(200)).body;
    const all = [...queue.items, ...(await http.get(`/api/surveys/${surveyId}/quality?filter=pending`).set(admin).expect(200)).body.items];
    const texts = all
      .map((i: { recording: { transcript: { text: string } | null } | null }) => i.recording?.transcript?.text)
      .filter(Boolean);
    expect(texts).toEqual(expect.arrayContaining(['Interviewer: Good morning. Respondent: Hello, shop 2.']));
    expect((await http.get(`/api/surveys/${surveyId}/captures`).set(admin).expect(200)).body.transcription.transcribed).toBe(2);

    // Asking again sends nothing: every recording has its transcript.
    const again = (await http.post(`/api/surveys/${surveyId}/captures/transcribe`).set(admin).send({}).expect(202)).body;
    await worker.runOnce();
    expect((await http.get(`/api/jobs/${again.id}`).set(admin).expect(200)).body.result).toMatchObject({ transcribed: 0 });
    expect(calls).toHaveLength(2);
  });

  it('reports a recording the provider refuses', async () => {
    const bad = await interviewWithRecording(9);
    const job = (
      await http
        .post(`/api/surveys/${surveyId}/captures/transcribe`)
        .set(admin)
        .send({ captureIds: [bad.id] })
        .expect(202)
    ).body;
    await worker.runOnce();
    const done = (await http.get(`/api/jobs/${job.id}`).set(admin).expect(200)).body;
    expect(done.status).toBe('FAILED');
    expect(done.error).toBe('Deepgram refused the recording: Bad audio');
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: bad.id } })).transcribedAt).toBeNull();
  });

  it('erasing the recordings removes their transcripts', async () => {
    await http.post(`/api/surveys/${surveyId}/captures/erase`).set(admin).expect(200);
    const left = await prisma.capture.findMany({ where: { surveyId, kind: 'audio' } });
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((c) => c.deletedAt && c.transcript === null && c.transcribedAt === null)).toBe(true);
  });
});
