/**
 * Milestone 11: rich media and advanced question types. Media uploads (type sniffing, no SVG),
 * public serving with byte ranges, publish checks, delete protection, interviews with scale,
 * ranking, constant sum and slider questions, exports, analysis and the questionnaire template.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
});

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { importTemplateRows, parseCsv } from '../src/imports/template-import';
import { sniffMedia } from '../src/media/media.service';

const run = `m11${Date.now().toString(36)}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(1000, 1)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(300, 2)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let app: INestApplication;
let http: ReturnType<typeof request>;
let admin: Record<string, string>;
let viewer: Record<string, string>;
let projectId: string;
let surveyId: string;
let image: string;
let video: string;

const definition = (img: string, vid: string) => ({
  schemaVersion: 1,
  title: 'Concept test',
  pages: [
    {
      id: 'P1',
      questions: [
        {
          id: 'AD',
          type: 'info',
          text: 'Please watch this ad.',
          media: { kind: 'video', id: vid, alt: 'A 20-second ad for Brand A', requireComplete: true },
        },
        {
          id: 'PACK',
          type: 'single',
          text: 'Which pack do you prefer?',
          options: [
            { code: 1, label: 'Blue pack', image: img },
            { code: 2, label: 'Red pack', image: img },
          ],
        },
        {
          id: 'NPS',
          type: 'scale',
          text: 'How likely are you to recommend Brand A?',
          nps: true,
          dontKnow: { code: 99, label: "Don't know" },
        },
      ],
    },
    {
      id: 'P2',
      questions: [
        {
          id: 'RANK',
          type: 'ranking',
          text: 'Rank these features',
          rankCount: 2,
          options: [
            { code: 1, label: 'Price' },
            { code: 2, label: 'Taste' },
            { code: 3, label: 'Pack' },
          ],
        },
        {
          id: 'SPEND',
          type: 'sum',
          text: 'Share 100 points',
          unit: 'points',
          options: [
            { code: 1, label: 'Brand A' },
            { code: 2, label: 'Brand B' },
          ],
        },
        { id: 'TEMP', type: 'numeric', text: 'How appealing?', display: 'slider', min: 0, max: 100, step: 5 },
      ],
    },
    { id: 'P3', condition: 'RANK.2 == 1 and SPEND.1 >= 50', questions: [{ id: 'WHY', type: 'open', text: 'Why taste first?' }] },
  ],
});

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  const email = `viewer-${run}@test.zapx`;
  await http.post('/api/users').set(admin).send({ name: 'Vee', email, password: 'member-password-1', role: 'VIEWER' }).expect(201);
  viewer = {
    Authorization: `Bearer ${(await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token}`,
  };
  projectId = (await http.post('/api/projects').set(admin).send({ name: 'Concepts' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name: 'Ad test' }).expect(201)).body.id;
  await http.post(`/api/projects/${projectId}/vendors`).set(admin).send({ name: 'V', code: 'V1' }).expect(201);
});

afterAll(async () => {
  await app?.close();
});

describe('media files', () => {
  it('recognises files by their content, not their name', () => {
    expect(sniffMedia(PNG)).toEqual({ kind: 'image', contentType: 'image/png' });
    expect(sniffMedia(MP4)).toEqual({ kind: 'video', contentType: 'video/mp4' });
    expect(sniffMedia(MP3)).toEqual({ kind: 'audio', contentType: 'audio/mpeg' });
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.contentType).toBe('image/jpeg');
    expect(sniffMedia(SVG)).toBeNull();
  });

  it('uploads for editors only and rejects other files', async () => {
    await http.post(`/api/surveys/${surveyId}/media`).set(viewer).attach('file', PNG, 'pack.png').expect(403);
    await http.post(`/api/surveys/${surveyId}/media`).set(admin).attach('file', SVG, 'pack.png').expect(400);
    await http.post(`/api/surveys/${surveyId}/media`).set(admin).attach('file', Buffer.from('hello'), 'notes.txt').expect(400);
    const img = (await http.post(`/api/surveys/${surveyId}/media`).set(admin).attach('file', PNG, 'pack shot.png').expect(201)).body;
    expect(img).toMatchObject({ kind: 'image', contentType: 'image/png', size: PNG.length, name: 'pack shot.png' });
    expect(img.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    image = img.id;
    video = (await http.post(`/api/surveys/${surveyId}/media`).set(admin).attach('file', MP4, 'ad.mp4').expect(201)).body.id;
    const list = (await http.get(`/api/surveys/${surveyId}/media`).set(viewer).expect(200)).body;
    expect(list.map((m: { id: string }) => m.id).sort()).toEqual([image, video].sort());
  });

  it('serves files publicly, cacheably and in byte ranges', async () => {
    const full = await http.get(`/api/public/media/${image}`).buffer(true).expect(200);
    expect(full.headers['content-type']).toBe('image/png');
    expect(full.headers['cache-control']).toContain('immutable');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(full.body as Buffer, PNG)).toBe(0);
    const part = await http.get(`/api/public/media/${video}`).set('Range', 'bytes=4-11').buffer(true).expect(206);
    expect(part.headers['content-range']).toBe(`bytes 4-11/${MP4.length}`);
    expect((part.body as Buffer).toString('latin1')).toBe('ftypmp42');
    await http
      .get(`/api/public/media/${video}`)
      .set('Range', `bytes=${MP4.length + 5}-`)
      .expect(416);
    await http
      .get(`/api/public/media/${full.headers.etag ? image : image}`)
      .set('If-None-Match', full.headers.etag!)
      .expect(304);
    await http.get('/api/public/media/nope').expect(404);
  });
});

describe('a survey with media and the new question types', () => {
  let token: string;

  it('will not publish with media from elsewhere', async () => {
    await http
      .put(`/api/surveys/${surveyId}/draft`)
      .set(admin)
      .send({ definition: definition('aaaaaaaaaaaaaaaaaaaaaa', video) })
      .expect(200);
    const res = await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(422);
    expect(res.body.message).toContain('aaaaaaaaaaaaaaaaaaaaaa');
  });

  it('publishes, and protects files in use', async () => {
    await http
      .put(`/api/surveys/${surveyId}/draft`)
      .set(admin)
      .send({ definition: definition(image, video) })
      .expect(200);
    await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);
    const res = await http.delete(`/api/media/${image}`).set(admin).expect(409);
    expect(res.body.message).toContain('version 1');
    const spare = (await http.post(`/api/surveys/${surveyId}/media`).set(admin).attach('file', MP3, 'jingle.mp3').expect(201)).body.id;
    await http.delete(`/api/media/${spare}`).set(viewer).expect(403);
    await http.delete(`/api/media/${spare}`).set(admin).expect(204);
    await http.get(`/api/public/media/${spare}`).expect(404);
  });

  it('runs an interview with the new question types', async () => {
    const start = (
      await http
        .post(`/api/public/s/${surveyId}/start`)
        .send({ query: { vid: 'V1', uid: 'R-1' } })
        .expect(200)
    ).body;
    token = start.token;
    const q = (id: string) => start.page.questions.find((x: { id: string }) => x.id === id);
    expect(q('AD').media).toMatchObject({ kind: 'video', id: video, requireComplete: true });
    expect(q('PACK').options[0].image).toBe(image);
    expect(start.look.ui).toMatchObject({ rankUp: 'Move up', playToEnd: expect.any(String) });
    expect(start.look.readAloud).toBe(false);

    const bad = (
      await http
        .post(`/api/public/r/${token}/answers`)
        .send({ pageId: 'P1', answers: { PACK: 1, NPS: 11 } })
        .expect(422)
    ).body;
    expect(bad.errors).toEqual([{ questionId: 'NPS', message: 'Choose a point on the scale.' }]);
    await http
      .post(`/api/public/r/${token}/answers`)
      .send({ pageId: 'P1', answers: { PACK: 1, NPS: 9 } })
      .expect(200);

    const p2 = (
      await http
        .post(`/api/public/r/${token}/answers`)
        .send({ pageId: 'P2', answers: { RANK: [2], SPEND: { 1: 60, 2: 30 }, TEMP: 55 } })
        .expect(422)
    ).body;
    expect(p2.errors.map((e: { questionId: string; message: string }) => `${e.questionId}: ${e.message}`)).toEqual([
      'RANK: Rank your top 2.',
      'SPEND: The amounts must add up to 100.',
    ]);
    const next = (
      await http
        .post(`/api/public/r/${token}/answers`)
        .send({ pageId: 'P2', answers: { RANK: [2, 1], SPEND: { 1: '60', 2: '40' }, TEMP: 55 } })
        .expect(200)
    ).body;
    // RANK.2 == 1 (taste first) and SPEND.1 >= 50: the follow-up page is shown.
    expect(next.page.id).toBe('P3');
    const done = (
      await http
        .post(`/api/public/r/${token}/answers`)
        .send({ pageId: 'P3', answers: { WHY: 'Taste matters' } })
        .expect(200)
    ).body;
    expect(done.state).toBe('finished');
  });

  it('exports ranks and amounts as columns', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(admin).expect(200)).text;
    const [header, row] = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    const cols = header!.split(',');
    const cell = (k: string) => row!.split(',')[cols.indexOf(k)];
    expect(cols).toEqual(expect.arrayContaining(['NPS', 'RANK_1', 'RANK_2', 'RANK_3', 'SPEND_1', 'SPEND_2', 'TEMP']));
    expect([cell('NPS'), cell('RANK_1'), cell('RANK_2'), cell('RANK_3'), cell('SPEND_1'), cell('SPEND_2'), cell('TEMP')]).toEqual([
      '9',
      '2',
      '1',
      '',
      '60',
      '40',
      '55',
    ]);
  });

  it('analyses NPS, ranks and amounts', async () => {
    const body = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(viewer)
        .send({ variables: ['NPS', 'RANK_2', 'SPEND_1'] })
        .expect(200)
    ).body;
    const [nps, rank, spend] = body.frequencies;
    expect(nps.nps).toMatchObject({ score: 100, base: 1 });
    expect(nps.stats.mean).toBe(9);
    expect(rank.stats.mean).toBe(1);
    expect(spend.stats.mean).toBe(60);
  });
});

describe('questionnaire template', () => {
  it('reads scale, NPS, ranking, constant sum and slider rows', () => {
    const csv = [
      'Page,ID,Type,Question,Options,Rows,Condition,Required,Help,Min,Max,Target,Notes',
      'P1,SAT,scale,How satisfied?,1=Very unhappy;5=Very happy;9=Not sure,,,,,1,5,,',
      'P1,REC,nps,Recommend?,,,,,,,,,',
      'P1,TOP,ranking,Rank,1=A;2=B;3=C,,,,,,2,,randomize',
      'P1,SPLIT,sum,Split,1=A;2=B,,,,,,10,,',
      'P1,WARM,slider,How warm?,,,,,,0,100,,',
      'P1,GRID,scale,Rate each,1=Bad;5=Good,r1=X;r2=Y,,,,,,,',
    ].join('\n');
    const r = importTemplateRows(parseCsv(csv), 'T');
    expect(r.errors).toEqual([]);
    const qs = r.definition!.pages[0]!.questions;
    expect(qs.map((q) => q.type)).toEqual(['scale', 'scale', 'ranking', 'sum', 'numeric', 'grid']);
    expect(qs[0]).toMatchObject({
      min: 1,
      max: 5,
      minLabel: 'Very unhappy',
      maxLabel: 'Very happy',
      dontKnow: { code: 9, label: 'Not sure' },
    });
    expect(qs[1]).toMatchObject({ nps: true, min: 0, max: 10 });
    expect(qs[2]).toMatchObject({ rankCount: 2, randomize: true });
    expect(qs[3]).toMatchObject({ total: 10 });
    expect(qs[4]).toMatchObject({ display: 'slider', min: 0, max: 100 });
  });
});
