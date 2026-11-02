/**
 * Milestone 15: weighting. Rim weighting through the analysis API: preview, weighted frequencies
 * and crosstabs, saved reports that keep their weighting, the Excel note, and refusals.
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
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m15${Date.now().toString(36)}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let admin: Record<string, string>;
let surveyId: string;

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const GENDER_50_50 = {
  dimensions: [
    {
      variable: 'GENDER',
      targets: [
        { code: 1, pct: 50 },
        { code: 2, pct: 50 },
      ],
    },
  ],
};

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  const prisma = app.get(PrismaService);
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  const pid = (await http.post('/api/projects').set(admin).send({ name: 'Tracker' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${pid}/surveys`).set(admin).send({ name: 'Wave 2' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition: demo }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);

  // 90 men (aware of brand 1, age 20) and 30 women (aware of brand 2, age 40): 75% men unweighted.
  const survey = await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } });
  const base = { tenantId: survey.tenantId, surveyId, versionId: survey.liveVersionId!, status: 'COMPLETE' as const };
  const rows = [
    ...Array.from({ length: 90 }, (_, i) => ({ ...base, uid: `m-${i}`, answers: { GENDER: 1, AGE: 20, AWARE: [1] } })),
    ...Array.from({ length: 30 }, (_, i) => ({ ...base, uid: `f-${i}`, answers: { GENDER: 2, AGE: 40, AWARE: [2] } })),
  ];
  await prisma.response.createMany({ data: rows.map((r) => ({ ...r, sessionTokenHash: `${run}-${r.uid}` })) });
});

afterAll(async () => {
  await app?.close();
});

describe('weighting', () => {
  it('previews a scheme with its efficiency and achieved shares', async () => {
    const body = (await http.post(`/api/surveys/${surveyId}/analysis/weights`).set(admin).send({ weighting: GENDER_50_50 }).expect(200))
      .body;
    expect(body.total).toBe(120);
    const w = body.weighting;
    expect(w.converged).toBe(true);
    expect(w.weights).toBeUndefined();
    expect(w.dimensions[0].categories.map((c: { unweighted: number }) => c.unweighted)).toEqual([75, 25]);
    expect(w.dimensions[0].categories[1].weighted).toBeCloseTo(50, 2);
    expect(w.minWeight).toBeCloseTo(60 / 90, 4);
    expect(w.maxWeight).toBeCloseTo(2, 4);
    expect(w.efficiency).toBeCloseTo(75, 1); // (120)^2 / (90*(2/3)^2 + 30*4) / 120
  });

  it('weights frequencies and keeps unweighted bases', async () => {
    const body = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(admin)
        .send({ variables: ['GENDER', 'AWARE', 'AGE'], weighting: GENDER_50_50 })
        .expect(200)
    ).body;
    const [gender, aware, age] = body.frequencies;
    expect(gender.rows[0].pct).toBeCloseTo(50, 4);
    expect(gender.unweightedBase).toBe(120);
    expect(gender.base).toBeCloseTo(120, 4);
    expect(aware.rows.find((r: { code: number }) => r.code === 2).pct).toBeCloseTo(50, 4);
    expect(age.stats.mean).toBeCloseTo(30, 4);
    expect(body.weighting.dimensions[0].variable).toBe('GENDER');

    const plain = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(admin)
        .send({ variables: ['AGE'] })
        .expect(200)
    ).body;
    expect(plain.weighting).toBeNull();
    expect(plain.frequencies[0].stats.mean).toBeCloseTo(25, 4);
  });

  it('weights crosstabs, with bases per column', async () => {
    const body = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/crosstab`)
        .set(admin)
        .send({ banner: 'GENDER', stubs: ['AGE'], weighting: GENDER_50_50 })
        .expect(200)
    ).body;
    const t = body.tables[0];
    expect(t.columns[1].unweightedBase).toBe(90);
    expect(t.columns[1].base).toBeCloseTo(60, 4);
    expect(t.columns[1].effectiveBase).toBeCloseTo(90, 4);
  });

  it('saved reports keep the weighting, and the Excel file says so', async () => {
    const r = (
      await http
        .post(`/api/surveys/${surveyId}/reports`)
        .set(admin)
        .send({ name: 'Weighted awareness', config: { type: 'frequencies', filters: {}, variables: ['AWARE'], weighting: GENDER_50_50 } })
        .expect(201)
    ).body;
    const ran = (await http.post(`/api/reports/${r.id}/run`).set(admin).expect(200)).body;
    expect(ran.weighting.converged).toBe(true);
    const xlsx = await http.get(`/api/reports/${r.id}/export.xlsx`).set(admin).buffer(true).parse(binary).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as Buffer);
    const text = wb.worksheets[0]!.getSheetValues().flat().join(' ');
    expect(text).toContain('Weighted by GENDER');
    expect(text).toContain('Efficiency 75%');
  });

  it('refuses weighting on variables that cannot be weighted', async () => {
    const bad = await http
      .post(`/api/surveys/${surveyId}/analysis/weights`)
      .set(admin)
      .send({ weighting: { dimensions: [{ variable: 'AGE', targets: [{ code: 1, pct: 100 }] }] } })
      .expect(400);
    expect(bad.body.message).toMatch(/single-answer/);
    await http
      .post(`/api/surveys/${surveyId}/analysis/weights`)
      .set(admin)
      .send({ weighting: { dimensions: [{ variable: 'NOPE', targets: [{ code: 1, pct: 100 }] }] } })
      .expect(400);
    await http
      .post(`/api/surveys/${surveyId}/analysis/weights`)
      .set(admin)
      .send({ weighting: { ...GENDER_50_50, maxWeight: 0.5 } })
      .expect(400);
  });
});
