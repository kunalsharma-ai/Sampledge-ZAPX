/**
 * Milestone 10: analysis. Variables, frequencies, crosstabs with column significance letters,
 * filters (status, test, rejected, mode), saved reports, Excel export, roles and tenant isolation.
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
const run = `m10${Date.now().toString(36)}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let viewer: Record<string, string>;
let surveyId: string;

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function register(org: string) {
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: org, name: 'Admin', email: `admin-${org.replace(/\W/g, '')}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  return { Authorization: `Bearer ${reg.body.token}` };
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  admin = await register(`Org ${run}`);
  const pid = (await http.post('/api/projects').set(admin).send({ name: 'Brand tracker' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${pid}/surveys`).set(admin).send({ name: 'Wave 1' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition: demo }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);

  const email = `viewer-${run}@test.zapx`;
  await http.post('/api/users').set(admin).send({ name: 'Vee', email, password: 'member-password-1', role: 'VIEWER' }).expect(201);
  viewer = {
    Authorization: `Bearer ${(await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200)).body.token}`,
  };

  // 60 men: aged 20-29, 80% aware of brand 1. 60 women: aged 40-49, 40% aware of brand 1, all of brand 2.
  // Ten of the women were interviewed by phone. Plus test, rejected and terminated interviews to filter out.
  const survey = await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } });
  const base = { tenantId: survey.tenantId, surveyId, versionId: survey.liveVersionId! };
  const rows = [];
  for (let i = 0; i < 60; i++) {
    rows.push({
      ...base,
      uid: `m-${i}`,
      status: 'COMPLETE' as const,
      answers: { AGE: 20 + (i % 10), GENDER: 1, AWARE: i % 5 ? [1] : [3], RATE: { a: 4 } },
    });
    rows.push({
      ...base,
      uid: `f-${i}`,
      status: 'COMPLETE' as const,
      mode: i < 10 ? ('CATI' as const) : ('CAWI' as const),
      answers: {
        AGE: 40 + (i % 10),
        GENDER: 2,
        AWARE: i % 5 < 2 ? [1, 2] : [2],
        RATE: { a: 3 },
        COMMENTS: i === 0 ? 'Loved it' : undefined,
      },
    });
  }
  for (let i = 0; i < 5; i++) rows.push({ ...base, uid: `t-${i}`, isTest: true, status: 'COMPLETE' as const, answers: { GENDER: 3 } });
  for (let i = 0; i < 3; i++)
    rows.push({ ...base, uid: `r-${i}`, reviewState: 'REJECTED' as const, status: 'COMPLETE' as const, answers: { GENDER: 3 } });
  for (let i = 0; i < 4; i++) rows.push({ ...base, uid: `x-${i}`, status: 'TERMINATE' as const, answers: { AGE: 12 } });
  await prisma.response.createMany({ data: rows.map((r) => ({ ...r, sessionTokenHash: `${run}-${r.uid}` })) });
});

afterAll(async () => {
  await app?.close();
});

describe('analysis', () => {
  it('lists the variables with categories found in the data', async () => {
    const body = (await http.get(`/api/surveys/${surveyId}/analysis/variables`).set(viewer).expect(200)).body;
    expect(body.completes).toBe(120);
    const ids = body.variables.map((v: { id: string }) => v.id);
    expect(ids).toEqual(expect.arrayContaining(['AGE', 'GENDER', 'AWARE', 'RATE_a', 'RATE_b', 'COMMENTS', 'status', 'mode']));
    expect(body.variables.find((v: { id: string }) => v.id === 'mode').categories.map((c: { code: string }) => c.code)).toEqual([
      'cati',
      'cawi',
    ]);
  });

  it('counts frequencies on completes, leaving out test and rejected interviews', async () => {
    const body = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(viewer)
        .send({ variables: ['GENDER', 'AWARE', 'AGE', 'RATE_a', 'COMMENTS'] })
        .expect(200)
    ).body;
    expect(body.total).toBe(120);
    const [gender, aware, age, rate, comments] = body.frequencies;
    expect(gender.rows.slice(0, 2).map((r: { count: number; pct: number }) => [r.count, r.pct])).toEqual([
      [60, 50],
      [60, 50],
    ]);
    // Multiple choice: shares of people, so they add up to more than 100.
    expect(aware.rows.map((r: { code: number; count: number }) => [r.code, r.count])).toEqual([
      [1, 72],
      [2, 60],
      [3, 12],
      [98, 0],
      [99, 0],
    ]);
    expect(age.stats).toMatchObject({ n: 120, mean: 34.5, min: 20, max: 49 });
    expect(rate.rows.find((r: { code: number }) => r.code === 4).count).toBe(60);
    expect(comments).toMatchObject({ base: 1, samples: ['Loved it'] });
  });

  it('applies filters', async () => {
    const all = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(viewer)
        .send({ filters: { includeTest: true, includeRejected: true }, variables: ['GENDER'] })
        .expect(200)
    ).body;
    expect(all.total).toBe(128);
    const phone = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(viewer)
        .send({ filters: { modes: ['CATI'] }, variables: ['GENDER'] })
        .expect(200)
    ).body;
    expect(phone.total).toBe(10);
    const term = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(viewer)
        .send({ filters: { statuses: ['TERMINATE'] }, variables: ['AGE'] })
        .expect(200)
    ).body;
    expect(term.frequencies[0].stats.mean).toBe(12);
    await http
      .post(`/api/surveys/${surveyId}/analysis/frequencies`)
      .set(viewer)
      .send({ variables: ['NOPE'] })
      .expect(400);
    await http
      .post(`/api/surveys/${surveyId}/analysis/frequencies`)
      .set(viewer)
      .send({ filters: { statuses: [] } })
      .expect(400);
  });

  it('crosstabs with significance letters', async () => {
    const body = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/crosstab`)
        .set(viewer)
        .send({ banner: 'GENDER', stubs: ['AWARE', 'AGE', 'COMMENTS', 'GENDER'] })
        .expect(200)
    ).body;
    // Open answers and the banner itself are skipped.
    expect(body.tables).toHaveLength(2);
    const [aware, age] = body.tables;
    expect(aware.columns.map((c: { label: string; letter: string; base: number }) => [c.label, c.letter, c.base])).toEqual([
      ['Total', '', 120],
      ['Man', 'A', 60],
      ['Woman', 'B', 60],
      ['Another identity', 'C', 0],
      ['Prefer not to say', 'D', 0],
    ]);
    const brand1 = aware.rows.find((r: { code: number }) => r.code === 1);
    expect(brand1.cells[1]).toMatchObject({ count: 48, pct: 80, higherThan: ['B'] });
    expect(brand1.cells[2]).toMatchObject({ count: 24, pct: 40, higherThan: [] });
    const brand2 = aware.rows.find((r: { code: number }) => r.code === 2);
    expect(brand2.cells[2].higherThan).toEqual(['A']);
    expect(age.means[2].higherThan).toEqual(['A']);
    expect(age.means[1].higherThan).toEqual([]);

    await http
      .post(`/api/surveys/${surveyId}/analysis/crosstab`)
      .set(viewer)
      .send({ banner: 'AGE', stubs: ['GENDER'] })
      .expect(400);
  });
});

describe('saved reports', () => {
  let reportId: string;

  it('lets programmers save reports and viewers run and download them', async () => {
    await http
      .post(`/api/surveys/${surveyId}/reports`)
      .set(viewer)
      .send({ name: 'Awareness by gender', config: { type: 'crosstab', banner: 'GENDER', stubs: ['AWARE'] } })
      .expect(403);
    const r = (
      await http
        .post(`/api/surveys/${surveyId}/reports`)
        .set(admin)
        .send({ name: 'Awareness by gender', config: { type: 'crosstab', banner: 'GENDER', stubs: ['AWARE', 'AGE'], confidence: 0.99 } })
        .expect(201)
    ).body;
    reportId = r.id;
    expect(r.config.filters.statuses).toEqual(['COMPLETE']);

    const list = (await http.get(`/api/surveys/${surveyId}/reports`).set(viewer).expect(200)).body;
    expect(list.map((x: { name: string }) => x.name)).toEqual(['Awareness by gender']);

    const ran = (await http.post(`/api/reports/${reportId}/run`).set(viewer).expect(200)).body;
    expect(ran.tables[0].confidence).toBe(0.99);
    expect(ran.tables[0].rows[0].cells[1].higherThan).toEqual(['B']);

    const file = await http.get(`/api/reports/${reportId}/export.xlsx`).set(viewer).buffer(true).parse(binary).expect(200);
    expect(file.headers['content-disposition']).toContain('Awareness_by_gender.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as Buffer);
    const cells = wb.getWorksheet('Report')!.getSheetValues().flat().map(String);
    expect(cells).toContain('Awareness by gender');
    expect(cells).toContain('Man (A)');
    expect(cells).toContain('80% B');
    // Aggregates only: no respondent ids in the workbook.
    expect(cells.some((c) => c.startsWith('m-') || c.startsWith('f-'))).toBe(false);
  });

  it('updates and deletes, with an audit trail', async () => {
    await http
      .put(`/api/reports/${reportId}`)
      .set(admin)
      .send({ name: 'Gender split', config: { type: 'frequencies', variables: ['GENDER'] } })
      .expect(200);
    const ran = (await http.post(`/api/reports/${reportId}/run`).set(viewer).expect(200)).body;
    expect(ran.frequencies).toHaveLength(1);
    await http.delete(`/api/reports/${reportId}`).set(viewer).expect(403);
    await http.delete(`/api/reports/${reportId}`).set(admin).expect(204);
    await http.get(`/api/reports/${reportId}`).set(admin).expect(404);
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: surveyId, action: { startsWith: 'report.' } } })).map(
      (e) => e.action,
    );
    expect(actions.sort()).toEqual(['report.create', 'report.delete', 'report.export', 'report.update']);
  });

  it('keeps other organizations out', async () => {
    const other = await register(`Other ${run}`);
    await http.post(`/api/surveys/${surveyId}/analysis/frequencies`).set(other).send({}).expect(404);
    const r = (
      await http
        .post(`/api/surveys/${surveyId}/reports`)
        .set(admin)
        .send({ name: 'Mine', config: { type: 'frequencies' } })
        .expect(201)
    ).body;
    await http.get(`/api/reports/${r.id}`).set(other).expect(404);
    await http.post(`/api/reports/${r.id}/run`).set(other).expect(404);
  });
});
