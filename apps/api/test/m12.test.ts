/**
 * Milestone 12: fraud detection and face-to-face capture. Browser signals (automation, honeypot,
 * pages with no input, pasting), the same-device check, the country check, the block list, private
 * photo answers, CAPI locations, consented recordings, overlapping interviews, erasure and retention.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.GEO_COUNTRY_HEADER = 'x-test-country';
  process.env.CAPTURE_RETENTION_DAYS = '30';
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
import { CaptureService, checkCapture } from '../src/captures/capture.service';

const run = `m12${Date.now().toString(36)}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 3)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 5)]);
const PDF = Buffer.from('%PDF-1.4 not a photo');

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
  projectId = (await http.post('/api/projects').set(admin).send({ name: 'Shopper study' }).expect(201)).body.id;
  await http.post(`/api/projects/${projectId}/vendors`).set(admin).send({ name: 'Panel', code: 'PN' }).expect(201);
});

afterAll(async () => {
  await app?.close();
});

describe('capture files', () => {
  it('accepts photos and recordings by their content', () => {
    expect(checkCapture('photo', JPEG)).toBe('image/jpeg');
    expect(checkCapture('audio', WEBM)).toBe('audio/webm');
    expect(() => checkCapture('photo', PDF)).toThrow('JPEG, PNG or WebP');
    expect(() => checkCapture('photo', WEBM)).toThrow();
    expect(() => checkCapture('audio', JPEG)).toThrow('WebM, Ogg');
  });
});

describe('online fraud signals and photo answers', () => {
  let surveyId: string;
  const traits = { screen: '1920x1080x24', tz: 'Europe/London', langs: 'en-GB,en', platform: 'Win32', cores: 8, touch: 0 };
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
  let ip = 20;

  const definition = {
    schemaVersion: 1,
    title: 'Shopper',
    pages: [
      {
        id: 'P1',
        questions: [
          {
            id: 'STORE',
            type: 'single',
            text: 'Where did you shop?',
            options: [
              { code: 1, label: 'Supermarket' },
              { code: 2, label: 'Corner shop' },
            ],
          },
        ],
      },
      { id: 'P2', questions: [{ id: 'WHY', type: 'open', text: 'Why there?' }] },
      { id: 'P3', questions: [{ id: 'RECEIPT', type: 'photo', text: 'Take a photo of your receipt' }] },
    ],
    settings: { quality: { countries: ['GB'], sameNetwork: false } },
  };

  async function enter(uid: string, opts: { country?: string; automation?: boolean; ua?: string } = {}) {
    const req = http
      .post(`/api/public/s/${surveyId}/start`)
      .set('X-Forwarded-For', `198.51.100.${ip++}`)
      .set('User-Agent', opts.ua ?? UA);
    if (opts.country) req.set('x-test-country', opts.country);
    const body = (await req.send({ query: { vid: 'PN', uid }, client: { traits, automation: opts.automation } }).expect(200)).body;
    return body.token as string;
  }
  const page = (token: string, pageId: string, answers: Record<string, unknown>, signals: Record<string, unknown> = { interactions: 6 }) =>
    http.post(`/api/public/r/${token}/answers`).send({ pageId, answers, signals });
  const photo = (token: string, questionId: string, file: Buffer = JPEG) =>
    http.post(`/api/public/r/${token}/captures`).field('questionId', questionId).attach('file', file, 'receipt.jpg');

  async function complete(
    token: string,
    why: string,
    signals: Array<Record<string, unknown>> = [{ interactions: 4 }, { interactions: 9 }, {}],
  ) {
    await page(token, 'P1', { STORE: 1 }, signals[0]).expect(200);
    await page(token, 'P2', { WHY: why }, signals[1]).expect(200);
    const { ref } = (await photo(token, 'RECEIPT').expect(200)).body;
    const done = await page(token, 'P3', { RECEIPT: ref }, signals[2]).expect(200);
    expect(done.body.state).toBe('finished');
    return ref as string;
  }

  beforeAll(async () => {
    surveyId = await publish('Shopper fraud', definition);
  });

  it('keeps an honest complete at 100', async () => {
    const token = await enter(`a-${run}`, { country: 'GB' });
    await page(token, 'P1', { STORE: 1 }).expect(200);
    await page(token, 'P2', { WHY: 'Closest to home and the prices are fair.' }).expect(200);
    await photo(token, 'STORE').expect(400);
    await photo(token, 'RECEIPT', PDF).expect(400);
    const bad = await page(token, 'P3', { RECEIPT: 'made-up-reference' }).expect(422);
    expect(bad.body.errors).toEqual([{ questionId: 'RECEIPT', message: 'The photo could not be uploaded. Try again.' }]);
    const first = (await photo(token, 'RECEIPT').expect(200)).body.ref as string;
    const second = (await photo(token, 'RECEIPT').expect(200)).body.ref as string;
    expect(second).not.toBe(first);
    expect((await page(token, 'P3', { RECEIPT: second }).expect(200)).body.state).toBe('finished');

    const r = await prisma.response.findFirstOrThrow({ where: { surveyId, uid: `a-${run}` } });
    expect(r).toMatchObject({ status: 'COMPLETE', qualityScore: 100, geoCountry: 'GB', answers: { RECEIPT: second } });
    expect(r.deviceHash).toMatch(/^[0-9a-f]{32}$/);
    // The replaced photo is gone; the answered one stays.
    const files = await prisma.capture.findMany({ where: { responseId: r.id } });
    expect(files.map((f) => [f.ref, f.deletedAt === null])).toEqual(
      expect.arrayContaining([
        [first, false],
        [second, true],
      ]),
    );
    await photo(token, 'RECEIPT').expect(409);
  });

  it('flags bots, copies and answers from elsewhere', async () => {
    const token = await enter(`b-${run}`, { country: 'FR' });
    await complete(token, 'Closest to home and the prices are fair.', [
      { interactions: 0, hp: true },
      { interactions: 0, pasted: ['WHY', 'STORE'] },
      { interactions: 0 },
    ]);
    const r = await prisma.response.findFirstOrThrow({ where: { surveyId, uid: `b-${run}` } });
    const flags = (r.qualityFlags as Array<{ code: string; detail: string }>).map((f) => f.code);
    expect(flags).toEqual(['open_duplicate', 'honeypot', 'no_interaction', 'open_pasted', 'same_device', 'geo_mismatch']);
    expect(r.signals).toEqual({ honeypot: 1, quietPages: 3, pasted: ['WHY'] });
    expect(r.reviewState).toBe('PENDING');

    const bot = await enter(`c-${run}`, { country: 'GB', automation: true, ua: 'HeadlessChrome/130' });
    await complete(bot, 'I like shopping there because it is near.');
    const c = await prisma.response.findFirstOrThrow({ where: { surveyId, uid: `c-${run}` } });
    expect((c.qualityFlags as Array<{ code: string }>).map((f) => f.code)).toEqual(['automation']);
    expect(c.qualityScore).toBe(40);
  });

  it('shows photos to reviewers, privately and audited', async () => {
    const queue = (await http.get(`/api/surveys/${surveyId}/quality?filter=pending`).set(viewer).expect(200)).body;
    const item = queue.items.find((i: { uid: string }) => i.uid === `b-${run}`);
    expect(item.photos).toEqual([expect.objectContaining({ questionId: 'RECEIPT', kind: 'photo', contentType: 'image/jpeg' })]);
    const url = item.photos[0].url as string;
    await http.get(url).expect(401);
    const file = await http.get(url).set(viewer).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['cache-control']).toBe('private, max-age=300');
    expect(file.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(Buffer.compare(file.body as Buffer, JPEG)).toBe(0);
    await http.get(url).set(viewer).set('Range', 'bytes=100-199').expect(206);
    const views = await prisma.auditEvent.count({
      where: { action: 'capture.view', data: { path: ['captureId'], equals: item.photos[0].id } },
    });
    expect(views).toBe(1);
  });

  it('blocks the device and network of rejected fraud everywhere', async () => {
    const b = await prisma.response.findFirstOrThrow({ where: { surveyId, uid: `b-${run}` } });
    const res = await http
      .post(`/api/surveys/${surveyId}/quality/decisions`)
      .set(admin)
      .send({ responseIds: [b.id], decision: 'reject', note: 'Bot farm', block: true })
      .expect(200);
    expect(res.body).toEqual({ accepted: 0, rejected: 1, skipped: 0, blocked: 2 });

    await http.get('/api/quality/blocks').set(viewer).expect(403);
    const blocks = (await http.get('/api/quality/blocks').set(admin).expect(200)).body;
    expect(blocks.map((x: { kind: string }) => x.kind).sort()).toEqual(['device', 'network']);
    expect(blocks[0]).toMatchObject({ note: 'Bot farm', createdBy: 'Admin', from: { uid: `b-${run}`, survey: 'Shopper fraud' } });
    expect(JSON.stringify(blocks)).not.toContain(b.deviceHash!);

    // The same device in another survey of the organization.
    const other = await publish('Shopper fraud 2', { ...definition, settings: { quality: { sameNetwork: false } } });
    const t = (
      await http
        .post(`/api/public/s/${other}/start`)
        .set('User-Agent', UA)
        .send({ query: { vid: 'PN', uid: `d-${run}` }, client: { traits } })
        .expect(200)
    ).body.token;
    await http
      .post(`/api/public/r/${t}/answers`)
      .send({ pageId: 'P1', answers: { STORE: 2 }, signals: { interactions: 3 } })
      .expect(200);
    await http
      .post(`/api/public/r/${t}/answers`)
      .send({ pageId: 'P2', answers: { WHY: 'It is open late.' }, signals: { interactions: 3 } });
    const ref = (await http.post(`/api/public/r/${t}/captures`).field('questionId', 'RECEIPT').attach('file', JPEG, 'r.jpg')).body.ref;
    await http
      .post(`/api/public/r/${t}/answers`)
      .send({ pageId: 'P3', answers: { RECEIPT: ref } })
      .expect(200);
    const d = await prisma.response.findFirstOrThrow({ where: { surveyId: other, uid: `d-${run}` } });
    expect((d.qualityFlags as Array<{ code: string }>).map((f) => f.code)).toEqual(['blocked_device']);

    for (const x of blocks) await http.delete(`/api/quality/blocks/${x.id}`).set(admin).expect(204);
    expect((await http.get('/api/quality/blocks').set(admin).expect(200)).body).toEqual([]);
    await http.delete(`/api/quality/blocks/${blocks[0].id}`).set(admin).expect(404);
  });
});

describe('face-to-face capture', () => {
  let surveyId: string;
  let versionId: string;
  let ana: Awaited<ReturnType<typeof member>>;
  let ben: Awaited<ReturnType<typeof member>>;
  const deviceId = randomUUID();
  const home = { lat: 51.500712345, lon: -0.124612345, accuracy: 8.4, at: new Date().toISOString() };

  const definition = {
    schemaVersion: 1,
    title: 'Shelf audit',
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'SHOP', type: 'open', text: 'Shop name' },
          { id: 'SHELF', type: 'photo', text: 'Photo of the shelf' },
        ],
      },
    ],
    settings: { capi: { gps: 'required', audio: 'consent' } },
  };
  const interview = (clientId: string, over: Record<string, unknown> = {}) => ({
    clientId,
    surveyId,
    versionId,
    answers: { SHOP: `Corner Market ${parseInt(clientId.slice(0, 8), 16)}`, SHELF: `shelf-${clientId.slice(0, 8)}` },
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    finishedAt: new Date(Date.now() - 3_000_000).toISOString(),
    durationMs: 540_000,
    location: { start: home, end: { ...home, lat: 51.5008 } },
    audio: 'recorded',
    ...over,
  });
  const upload = (who: { headers: Record<string, string> }, clientId: string, ref: string, kind: 'photo' | 'audio', file: Buffer) =>
    http
      .post('/api/capi/captures')
      .set(who.headers)
      .field('clientId', clientId)
      .field('surveyId', surveyId)
      .field('ref', ref)
      .field('kind', kind)
      .attach('file', file, kind === 'photo' ? 'shelf.jpg' : 'interview.webm');

  beforeAll(async () => {
    surveyId = await publish('Shelf audit', definition);
    versionId = (await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } })).liveVersionId!;
    ana = await member('INTERVIEWER', 'Ana Field');
    ben = await member('INTERVIEWER', 'Ben Field');
    await http.post(`/api/surveys/${surveyId}/capi/assignments`).set(admin).send({ interviewerId: ana.id }).expect(201);
  });

  it('takes photos and recordings from assigned interviewers before the interview syncs', async () => {
    const id = randomUUID();
    await upload(ben, id, `shelf-${id.slice(0, 8)}`, 'photo', JPEG).expect(403);
    await upload(ana, id, '../x', 'photo', JPEG).expect(400);
    await upload(ana, id, 'not-audio', 'audio', WEBM).expect(400);
    await upload({ headers: admin }, id, `shelf-${id.slice(0, 8)}`, 'photo', JPEG).expect(403);
    const first = (await upload(ana, id, `shelf-${id.slice(0, 8)}`, 'photo', JPEG).expect(200)).body;
    expect(first.stored).toBe(true);
    expect((await upload(ana, id, `shelf-${id.slice(0, 8)}`, 'photo', JPEG).expect(200)).body).toEqual({ ...first, stored: false });
    await upload(ana, id, 'audio', 'audio', WEBM).expect(200);

    const res = await http
      .post('/api/capi/sync')
      .set(ana.headers)
      .send({ deviceId, interviews: [interview(id)] })
      .expect(200);
    expect(res.body.results[0]).toMatchObject({ result: 'stored', status: 'complete' });
    const r = await prisma.response.findUniqueOrThrow({ where: { clientId: id }, include: { captures: true } });
    expect(r.qualityScore).toBe(100);
    expect(r.location).toEqual({
      start: { lat: 51.50071, lon: -0.12461, accuracy: 8, at: home.at },
      end: { lat: 51.5008, lon: -0.12461, accuracy: 8, at: home.at },
      audio: 'recorded',
    });
    expect(r.captures.map((c) => c.kind).sort()).toEqual(['audio', 'photo']);

    const all = await prisma.capture.findMany({ where: { responseId: r.id } });
    const audio = all.find((c) => c.kind === 'audio')!;
    const play = await http.get(`/api/captures/${audio.id}`).set(admin).buffer(true).expect(200);
    expect(play.headers['content-type']).toBe('audio/webm');
  });

  it('flags missing locations, moving away and two interviews at once', async () => {
    const far = randomUUID();
    const none = randomUUID();
    await upload(ana, far, `shelf-${far.slice(0, 8)}`, 'photo', JPEG).expect(200);
    await upload(ana, none, `shelf-${none.slice(0, 8)}`, 'photo', JPEG).expect(200);
    const res = await http
      .post('/api/capi/sync')
      .set(ana.headers)
      .send({
        deviceId,
        interviews: [
          interview(far, { location: { start: home, end: { ...home, lat: 51.52 } }, audio: 'declined' }),
          interview(none, {
            location: { start: null, end: null },
            startedAt: new Date(Date.now() - 900_000).toISOString(),
            finishedAt: new Date(Date.now() - 600_000).toISOString(),
            durationMs: 280_000,
          }),
        ],
      })
      .expect(200);
    expect(res.body.results.map((x: { status: string }) => x.status)).toEqual(['complete', 'complete']);
    const a = await prisma.response.findUniqueOrThrow({ where: { clientId: far } });
    expect((a.qualityFlags as Array<{ code: string }>).map((f) => f.code)).toEqual(['gps_moved', 'interviewer_overlap']);
    expect(a.reviewState).toBe('PENDING');
    expect(a.location).toMatchObject({ audio: 'declined' });
    const b = await prisma.response.findUniqueOrThrow({ where: { clientId: none } });
    expect((b.qualityFlags as Array<{ code: string }>).map((f) => f.code)).toEqual(['gps_missing']);

    const queue = (await http.get(`/api/surveys/${surveyId}/quality?filter=pending`).set(admin).expect(200)).body;
    const item = queue.items.find((i: { uid: string }) => i.uid === far);
    expect(item.location.start).toMatchObject({ lat: 51.50071 });
    expect(item.photos).toHaveLength(1);
    expect(item.recording).toBeNull();
  });

  it('erases a survey’s photos and recordings, and applies retention', async () => {
    const before = (await http.get(`/api/surveys/${surveyId}/captures`).set(viewer).expect(200)).body;
    expect(before).toMatchObject({ photos: 3, recordings: 1, retentionDays: 30 });
    const one = await prisma.capture.findFirstOrThrow({ where: { surveyId, kind: 'audio' } });

    // Retention: a capture uploaded 31 days ago is deleted by housekeeping.
    await prisma.capture.update({ where: { id: one.id }, data: { createdAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await app.get(CaptureService).purgeExpired()).toBeGreaterThanOrEqual(1);
    await http.get(`/api/captures/${one.id}`).set(admin).expect(404);

    await http.post(`/api/surveys/${surveyId}/captures/erase`).set(viewer).expect(403);
    expect((await http.post(`/api/surveys/${surveyId}/captures/erase`).set(admin).expect(200)).body).toEqual({ erased: 3 });
    expect((await http.get(`/api/surveys/${surveyId}/captures`).set(admin).expect(200)).body).toMatchObject({ photos: 0, recordings: 0 });
    expect(await prisma.auditEvent.count({ where: { action: 'capture.erase', entityId: surveyId } })).toBe(1);
  });
});
