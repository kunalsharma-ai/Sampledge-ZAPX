/**
 * Webcam eye tracking (experimental) over the API: the question publishes only with a picture, the
 * respondent page sends the eye-tracking words, answers of every outcome are stored and malformed
 * ones refused, and Analysis and exports report the recordings. The gaze points here are made up:
 * real gaze estimation happens in the browser and has not been validated on real webcams.
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
import { formatEyeTrack, type GazeSample } from '@zapx/survey-schema';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const run = `eye${Date.now().toString(36)}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);

let app: INestApplication;
let http: ReturnType<typeof request>;
let admin: Record<string, string>;
let surveyId: string;

const definition = (image?: string) => ({
  schemaVersion: 1,
  title: 'Shelf test',
  pages: [
    {
      id: 'P1',
      questions: [
        {
          id: 'EYE',
          type: 'eyetrack',
          text: 'Look at the shelf',
          ...(image ? { image } : {}),
          imageAlt: 'A supermarket shelf',
          aois: [
            { code: 1, label: 'Our pack', x: 0, y: 0, w: 50, h: 100 },
            { code: 2, label: 'Competitor', x: 50, y: 0, w: 50, h: 100 },
          ],
          durationSec: 4,
          maxErrorPct: 12,
        },
      ],
    },
  ],
});

/** Gaze on the left half for the first second, then the right half. */
const recording = (errorPct: number) => {
  const samples: GazeSample[] = [];
  for (let t = 0; t < 4000; t += 100) samples.push(t < 1000 ? { t, x: 250, y: 500 } : { t, x: 750, y: 500 });
  return formatEyeTrack({ status: 'recorded', errorPct, durationMs: 4000, samples });
};

let n = 0;
async function respond(answer: unknown, expectStatus = 200) {
  const s = (
    await http
      .post(`/api/public/s/${surveyId}/start`)
      .send({ query: { vid: 'PN', uid: `${run}-${++n}` } })
      .expect(200)
  ).body;
  const r = await http
    .post(`/api/public/r/${s.token}/answers`)
    .send({ pageId: 'P1', answers: { EYE: answer } })
    .expect(expectStatus);
  return { start: s, body: r.body };
}

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
  const projectId = (await http.post('/api/projects').set(admin).send({ name: 'Eye' }).expect(201)).body.id;
  await http.post(`/api/projects/${projectId}/vendors`).set(admin).send({ name: 'Panel', code: 'PN' }).expect(201);
  surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name: 'Shelf' }).expect(201)).body.id;
});

afterAll(async () => {
  await app?.close();
});

describe('webcam eye tracking (experimental)', () => {
  it('publishes only with a picture, and warns that it is experimental', async () => {
    await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition: definition() }).expect(200);
    const refused = await http.post(`/api/surveys/${surveyId}/publish`).set(admin);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(refused.body)).toMatch(/picture/);
    const image = (await http.post(`/api/surveys/${surveyId}/media`).set(admin).attach('file', PNG, 'shelf.png').expect(201)).body.id;
    const saved = (
      await http
        .put(`/api/surveys/${surveyId}/draft`)
        .set(admin)
        .send({ definition: definition(image) })
        .expect(200)
    ).body;
    expect(JSON.stringify(saved)).toMatch(/EXPERIMENTAL/);
    await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);
    await http.post(`/api/surveys/${surveyId}/status`).set(admin).send({ status: 'LIVE' });
  });

  it('sends the respondent page its words, and stores every outcome', async () => {
    const { start, body } = await respond(recording(6));
    expect(start.look.ui).toMatchObject({
      eyeAgree: 'I agree, turn on the camera',
      eyeExperimental: expect.stringMatching(/Experimental/),
    });
    expect(body).toMatchObject({ state: 'finished', status: 'complete' });
    await respond(recording(9));
    await respond(recording(30));
    await respond('declined');
    await respond('no_face');
  });

  it('refuses answers that are not an eye-tracking result', async () => {
    const { body } = await respond({ x: 1 }, 422);
    expect(JSON.stringify(body)).toMatch(/eye-tracking/);
    const long = await respond('recorded|50|9000|0,1,1', 422);
    expect(JSON.stringify(long.body)).toMatch(/eye-tracking/);
  });

  it('reports the recordings in Analysis, leaving out the inaccurate one', async () => {
    const out = (await http.post(`/api/surveys/${surveyId}/analysis/eyetracking/EYE`).set(admin).send({}).expect(200)).body;
    expect(out.image).toMatch(/^[A-Za-z0-9_-]{10,64}$/);
    expect(out.result).toMatchObject({
      answered: 5,
      statuses: { recorded: 3, declined: 1, no_face: 1, unavailable: 0, calibration_failed: 0 },
      included: 2,
      tooInaccurate: 1,
      accuracy: { medianPct: 7.5, bestPct: 6, worstPct: 9 },
    });
    expect(out.result.aois).toEqual([
      expect.objectContaining({ label: 'Our pack', viewersPct: 100, dwellSharePct: 25, meanFirstLookMs: 0 }),
      expect.objectContaining({ label: 'Competitor', viewersPct: 100, dwellSharePct: 75, meanFirstLookMs: 1000 }),
    ]);
    await http.post(`/api/surveys/${surveyId}/analysis/eyetracking/NOPE`).set(admin).send({}).expect(400);
  });

  it('exports the outcome, the calibration error and the share of looking time per area', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(admin).expect(200)).text;
    const [head, ...rows] = csv.trim().split(/\r?\n/);
    const cols = head!.replace(/^\uFEFF/, '').split(',');
    for (const c of ['EYE_status', 'EYE_error_pct', 'EYE_aoi1_dwell_pct', 'EYE_aoi2_dwell_pct']) expect(cols).toContain(c);
    const at = (row: string, c: string) => row.split(',')[cols.indexOf(c)];
    const first = rows.find((r) => at(r, 'EYE_error_pct') === '6')!;
    expect(at(first, 'EYE_status')).toBe('recorded');
    expect(at(first, 'EYE_aoi1_dwell_pct')).toBe('25');
    expect(rows.some((r) => at(r, 'EYE_status') === 'declined')).toBe(true);
    // The raw gaze points are not in the export.
    expect(csv).not.toContain('0,250,500');
  });
});
