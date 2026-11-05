/**
 * Blueprint phase 5 over the API: automation rules (events, conditions, cooldown, approvals,
 * schedules, notifications, no loops), data governance (residency blocking, retention erasure),
 * SMS invitations (Twilio adapter against a local stand-in), segmentation, dashboards, cleaning
 * rules in analysis and exports, and workspace presets.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
});

import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { AiProvider } from '../src/ai/ai-provider';
import { AutomationService } from '../src/automation/automation.service';
import { describeRule, evaluateConditions, nextRun } from '../src/automation/automation-rules';
import { WebhookService } from '../src/integrations/webhook.service';
import { GovernanceService } from '../src/governance/governance.service';
import { DistributionService } from '../src/distribution/distribution.service';
import { TwilioSmsProvider, normalizePhone, type OutgoingSms, type SmsProvider } from '../src/distribution/sms';

const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `bp5${Date.now().toString(36)}`;

class FakeAi extends AiProvider {
  readonly configured = true;
  readonly model = 'fake';
  calls = 0;
  architect(): Promise<never> {
    this.calls++;
    throw new Error('not used');
  }
  translate(): Promise<never> {
    this.calls++;
    throw new Error('not used');
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let automation: AutomationService;
let admin: Record<string, string>;
let programmer: Record<string, string>;
let tenantId: string;
let adminId: string;
let surveyId: string;
let projectId: string;

async function member(role: string) {
  const email = `${role.toLowerCase()}-${run}@test.zapx`;
  await http.post('/api/users').set(admin).send({ name: role, email, password: 'member-password-1', role }).expect(201);
  const login = await http.post('/api/auth/login').send({ email, password: 'member-password-1' }).expect(200);
  return { Authorization: `Bearer ${login.body.token}` };
}

const def = {
  ...demo,
  cleaning: [
    { id: 'C_AGE', label: 'Impossible age', when: 'AGE > 99', target: 'AGE', action: 'clear' },
    { id: 'C_GENDER', target: 'GENDER', action: 'impute', method: 'mode' },
  ],
};

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiProvider)
    .useValue(new FakeAi())
    .compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  automation = app.get(AutomationService);
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  const me = (await http.get('/api/auth/me').set(admin).expect(200)).body;
  tenantId = me.tenant.id;
  adminId = me.id;
  programmer = await member('PROGRAMMER');
  projectId = (await http.post('/api/projects').set(admin).send({ name: 'P5' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(admin).send({ name: 'Enterprise' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(admin).send({ definition: def }).expect(200);
  await http.post(`/api/surveys/${surveyId}/publish`).set(admin).expect(201);
  await http.post(`/api/surveys/${surveyId}/status`).set(admin).send({ status: 'LIVE' });
});

afterAll(async () => {
  await app?.close();
});

/** Work the automation queue until it is empty (other test files' runs are worked too). */
async function drain() {
  for (let i = 0; i < 10; i++) {
    const r = await automation.pass();
    if (!r.done && !r.skipped && !r.awaiting && !r.failed && !r.scheduled) break;
  }
}

describe('automation rules (pure)', () => {
  it('compares numbers and text and reports each value', () => {
    const r = evaluateConditions(
      [
        { field: 'event.status', op: 'eq', value: 'COMPLETE' },
        { field: 'metrics.incidence', op: 'lt', value: 20 },
      ],
      { status: 'complete' },
      { incidence: 12.5 },
    );
    expect(r.ok).toBe(true);
    expect(r.results.map((x) => x.actual)).toEqual(['complete', 12.5]);
    expect(evaluateConditions([{ field: 'event.qualityScore', op: 'gte', value: 50 }], {}, {}).ok).toBe(false);
  });

  it('computes the next run of hourly, daily and weekly schedules (UTC)', () => {
    const t = new Date('2026-11-05T10:30:00Z'); // a Thursday
    expect(nextRun({ every: 'hour', at: '00:15' }, t).toISOString()).toBe('2026-11-05T11:15:00.000Z');
    expect(nextRun({ every: 'day', at: '09:00' }, t).toISOString()).toBe('2026-11-06T09:00:00.000Z');
    expect(nextRun({ every: 'day', at: '11:00' }, t).toISOString()).toBe('2026-11-05T11:00:00.000Z');
    expect(nextRun({ every: 'week', at: '08:00', weekday: 1 }, t).toISOString()).toBe('2026-11-09T08:00:00.000Z');
    expect(nextRun({ every: 'week', at: '12:00', weekday: 4 }, t).toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });

  it('describes a rule in plain words', () => {
    expect(
      describeRule({
        trigger: 'quota.full',
        schedule: null,
        conditions: [],
        actions: [{ type: 'set_survey_status', status: 'PAUSED' }],
        requiresApproval: true,
      }),
    ).toBe('When quota.full: set the survey to paused (after an administrator approves).');
  });
});

describe('automation engine', () => {
  it('validates rules', async () => {
    const bad = await http
      .post('/api/automation/rules')
      .set(admin)
      .send({ name: 'x', trigger: 'schedule', actions: [{ type: 'notify', to: 'admins' }] })
      .expect(400);
    expect(bad.body.message).toMatch(/schedule/);
    await http
      .post('/api/automation/rules')
      .set(admin)
      .send({ name: 'x', trigger: 'quota.full', actions: [{ type: 'set_survey_status', status: 'PAUSED' }] })
      .expect(400);
    await http
      .post('/api/automation/rules')
      .set(admin)
      .send({
        name: 'x',
        trigger: 'quota.full',
        conditions: [{ field: 'metrics.nope', op: 'gt', value: 1 }],
        actions: [{ type: 'webhook' }],
      })
      .expect(400);
  });

  it('notifies on an event when its conditions hold, and logs a skip when they do not', async () => {
    const rule = (
      await http
        .post('/api/automation/rules')
        .set(programmer)
        .send({
          name: 'Low quality complete',
          surveyId,
          trigger: 'response.finished',
          conditions: [{ field: 'event.qualityScore', op: 'lt', value: 40 }],
          actions: [{ type: 'notify', to: 'admins', message: 'A low-quality complete came in.' }],
        })
        .expect(201)
    ).body;
    expect(rule.description).toBe('When response.finished, if event.qualityScore is below 40: notify admins.');
    const hooks = app.get(WebhookService);
    await hooks.emit(tenantId, 'response.finished', { surveyId, status: 'complete', qualityScore: 20 });
    await hooks.emit(tenantId, 'response.finished', { surveyId, status: 'complete', qualityScore: 90 });
    await drain();
    const runs = (await http.get(`/api/automation/runs?ruleId=${rule.id}`).set(admin).expect(200)).body;
    expect(runs.map((r: { state: string }) => r.state).sort()).toEqual(['done', 'skipped']);
    expect(runs.find((r: { state: string }) => r.state === 'skipped').note).toMatch(/event.qualityScore = 90 \(no\)/);
    const n = (await http.get('/api/notifications').set(admin).expect(200)).body;
    expect(n.unread).toBeGreaterThanOrEqual(1);
    expect(n.items[0]).toMatchObject({
      title: 'Low quality complete',
      body: 'A low-quality complete came in.',
      link: `/surveys/${surveyId}`,
    });
    await http.post(`/api/notifications/${n.items[0].id}/read`).set(admin).expect(204);
    expect((await http.get('/api/notifications').set(admin).expect(200)).body.unread).toBe(n.unread - 1);
    // The programmer is not an admin, so got nothing.
    expect((await http.get('/api/notifications').set(programmer).expect(200)).body.unread).toBe(0);
    await http.delete(`/api/automation/rules/${rule.id}`).set(admin).expect(204);
  });

  it('respects the cooldown', async () => {
    const rule = (
      await http
        .post('/api/automation/rules')
        .set(admin)
        .send({
          name: 'Once an hour',
          surveyId,
          trigger: 'survey.published',
          cooldownMinutes: 60,
          actions: [{ type: 'notify', to: 'rule_owner' }],
        })
        .expect(201)
    ).body;
    const hooks = app.get(WebhookService);
    await hooks.emit(tenantId, 'survey.published', { surveyId, version: 2 });
    await hooks.emit(tenantId, 'survey.published', { surveyId, version: 3 });
    await drain();
    await hooks.emit(tenantId, 'survey.published', { surveyId, version: 4 });
    await drain();
    const runs = (await http.get(`/api/automation/runs?ruleId=${rule.id}`).set(admin).expect(200)).body;
    // Two queued together: one ran, the other was refused by the atomic check; the third was never queued.
    expect(runs.map((r: { state: string }) => r.state).sort()).toEqual(['done', 'skipped']);
    await http.delete(`/api/automation/rules/${rule.id}`).set(admin).expect(204);
  });

  it('pauses the survey on quota full only after an admin approves, without firing rules again', async () => {
    const pause = (
      await http
        .post('/api/automation/rules')
        .set(admin)
        .send({
          name: 'Pause when men are full',
          surveyId,
          trigger: 'quota.full',
          conditions: [{ field: 'event.quotaId', op: 'eq', value: 'QT_MEN' }],
          actions: [{ type: 'set_survey_status', status: 'PAUSED' }, { type: 'webhook' }],
          requiresApproval: true,
        })
        .expect(201)
    ).body;
    const watcher = (
      await http
        .post('/api/automation/rules')
        .set(admin)
        .send({ name: 'Status watcher', surveyId, trigger: 'survey.status_changed', actions: [{ type: 'notify', to: 'admins' }] })
        .expect(201)
    ).body;
    // A complete that fills QT_MEN (target 1).
    const survey = await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } });
    const r = await prisma.response.create({
      data: {
        tenantId,
        surveyId,
        versionId: survey.liveVersionId!,
        uid: `${run}-man`,
        status: 'COMPLETE',
        completedAt: new Date(),
        sessionTokenHash: `${run}-man`,
        answers: { AGE: 30, GENDER: 1 },
        quotaCells: ['QT_MEN'],
      },
    });
    await prisma.quotaCount.upsert({
      where: { surveyId_quotaId: { surveyId, quotaId: 'QT_MEN' } },
      create: { surveyId, quotaId: 'QT_MEN', count: 1 },
      update: { count: 1 },
    });
    await app.get(WebhookService).responseFinished(r.id, 'complete');
    await drain();
    const waiting = (await http.get(`/api/automation/runs?ruleId=${pause.id}`).set(admin).expect(200)).body;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ state: 'awaiting_approval', summary: 'Quota Men is full (1 of 1).' });
    expect((await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } })).status).toBe('LIVE');
    const note = (await http.get('/api/notifications').set(admin).expect(200)).body.items[0];
    expect(note.title).toBe('Approval needed: Pause when men are full');
    // Only admins approve.
    await http.post(`/api/automation/runs/${waiting[0].id}/approve`).set(programmer).expect(403);
    const done = (await http.post(`/api/automation/runs/${waiting[0].id}/approve`).set(admin).expect(200)).body;
    expect(done.state).toBe('done');
    expect(done.results[0]).toMatchObject({ type: 'set_survey_status', ok: true });
    expect((await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } })).status).toBe('PAUSED');
    await http.post(`/api/automation/runs/${waiting[0].id}/approve`).set(admin).expect(409);
    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId, action: 'survey.status', entityId: surveyId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toMatchObject({ actorId: adminId, data: expect.objectContaining({ automationRuleId: pause.id }) });
    // The status change came from an automation, so the watcher did not fire (no loops).
    await drain();
    expect((await http.get(`/api/automation/runs?ruleId=${watcher.id}`).set(admin).expect(200)).body).toEqual([]);
    await http.delete(`/api/automation/rules/${pause.id}`).set(admin).expect(204);
    await http.delete(`/api/automation/rules/${watcher.id}`).set(admin).expect(204);
    await prisma.survey.update({ where: { id: surveyId }, data: { status: 'LIVE' } });
  });

  it('runs scheduled rules on survey numbers', async () => {
    const rule = (
      await http
        .post('/api/automation/rules')
        .set(admin)
        .send({
          name: 'Daily check',
          surveyId,
          trigger: 'schedule',
          schedule: { every: 'day', at: '06:00' },
          conditions: [{ field: 'metrics.completes', op: 'gte', value: 1 }],
          actions: [{ type: 'notify', to: 'project_team', message: 'Fieldwork is moving.' }],
        })
        .expect(201)
    ).body;
    expect(new Date(rule.nextRunAt).getUTCHours()).toBe(6);
    const dry = (await http.post(`/api/automation/rules/${rule.id}/dry-run`).set(admin).send({}).expect(200)).body;
    expect(dry).toMatchObject({ wouldRun: true, conditions: [{ field: 'metrics.completes', actual: 1, ok: true }] });
    // Make it due now.
    await prisma.automationRule.update({ where: { id: rule.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await drain();
    const runs = (await http.get(`/api/automation/runs?ruleId=${rule.id}`).set(admin).expect(200)).body;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ event: 'schedule', state: 'done' });
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } })).nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    // Project team includes the programmer (organization-wide scope).
    expect((await http.get('/api/notifications').set(programmer).expect(200)).body.items[0].body).toBe('Fieldwork is moving.');
    await http.delete(`/api/automation/rules/${rule.id}`).set(admin).expect(204);
  });
});

describe('segments, dashboards and cleaning', () => {
  beforeAll(async () => {
    const survey = await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } });
    const rows = [
      { AGE: 25, GENDER: 2, AWARE: [1] },
      { AGE: 140, GENDER: 2, AWARE: [2] },
      { AGE: 45, AWARE: [1, 2] },
      { AGE: 60, GENDER: 1, AWARE: [3] },
    ].map((answers, i) => ({
      tenantId,
      surveyId,
      versionId: survey.liveVersionId!,
      uid: `${run}-seg-${i}`,
      status: 'COMPLETE' as const,
      completedAt: new Date(),
      sessionTokenHash: `${run}-seg-${i}`,
      answers,
    }));
    await prisma.response.createMany({ data: rows });
  });

  it('cleans copies of the answers and shows which rules touch a variable', async () => {
    const vars = (await http.get(`/api/surveys/${surveyId}/analysis/variables`).set(admin).expect(200)).body.variables;
    expect(vars.find((v: { id: string }) => v.id === 'AGE').cleanedBy).toEqual(['C_AGE']);
    const f = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(admin)
        .send({ variables: ['AGE', 'GENDER'] })
        .expect(200)
    ).body;
    // 5 completes (the man from the quota test and four here); the 140-year-old's age is blanked.
    expect(f.total).toBe(5);
    expect(f.frequencies[0].base).toBe(4);
    // Mode of gender: 1 and 2 are tied at two each, and a tie goes to the smaller code.
    expect(f.cleaning).toEqual({ changed: { C_AGE: 1, C_GENDER: 1 }, imputed: { C_GENDER: 1 } });
    const stored = await prisma.response.findFirstOrThrow({ where: { uid: `${run}-seg-1` } });
    expect((stored.answers as { AGE: number }).AGE).toBe(140);
  });

  it('filters tables to a segment', async () => {
    const f = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(admin)
        .send({ variables: ['AGE'], filters: { answers: [{ variable: 'AWARE', values: [1] }] } })
        .expect(200)
    ).body;
    expect(f.total).toBe(2);
    expect(f.segment).toBe('AWARE is Brand A');
    await http
      .post(`/api/surveys/${surveyId}/analysis/frequencies`)
      .set(admin)
      .send({ filters: { answers: [{ variable: 'NOPE', values: [1] }] } })
      .expect(400);
  });

  it('runs and saves a dashboard of charts', async () => {
    const d = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/dashboard`)
        .set(admin)
        .send({
          tiles: [
            { variable: 'GENDER', chart: 'donut' },
            { variable: 'AWARE', chart: 'bar' },
          ],
          filters: { answers: [{ variable: 'AGE', min: 18, max: 50 }] },
        })
        .expect(200)
    ).body;
    // Aged 18 to 50: the man (30), 25 and 45 (whose gender was imputed as 1).
    expect(d.total).toBe(3);
    expect(d.tiles.map((t: { chart: string }) => t.chart)).toEqual(['donut', 'bar']);
    expect(d.tiles[0].frequency.rows.find((r: { code: number }) => r.code === 1).count).toBe(2);
    await http
      .post(`/api/surveys/${surveyId}/analysis/dashboard`)
      .set(admin)
      .send({ tiles: [{ variable: 'AWARE_OTHER' }] })
      .expect(400);
    const saved = (
      await http
        .post(`/api/surveys/${surveyId}/reports`)
        .set(admin)
        .send({ name: 'Fieldwork dashboard', config: { type: 'dashboard', tiles: [{ variable: 'GENDER', chart: 'column' }] } })
        .expect(201)
    ).body;
    const xlsx = await http.get(`/api/reports/${saved.id}/export.xlsx`).set(admin).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('exports cleaned answers with the rules applied per row', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/export?format=csv`).set(admin).expect(200)).text;
    const lines = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    const head = lines[0]!.split(',');
    const row = lines.find((l) => l.includes(`${run}-seg-1`))!.split(',');
    expect(row[head.indexOf('AGE')]).toBe('');
    expect(row[head.indexOf('cleaning_rules')]).toBe('C_AGE');
  });
});

describe('data governance', () => {
  it('records the region and blocks outside processors when asked', async () => {
    const g = (await http.get('/api/organization/governance').set(admin).expect(200)).body;
    expect(g).toMatchObject({ dataRegion: null, blockExternalProcessors: false, retention: {} });
    expect(g.processors.map((p: { id: string }) => p.id)).toContain('ai');
    await http.get('/api/organization/governance').set(programmer).expect(403);
    await http.put('/api/organization/governance').set(admin).send({ dataRegion: 'Europe West!' }).expect(400);
    const up = (
      await http.put('/api/organization/governance').set(admin).send({ dataRegion: 'EU', blockExternalProcessors: true }).expect(200)
    ).body;
    expect(up).toMatchObject({ dataRegion: 'eu', blockExternalProcessors: true });
    const ai = await http.post(`/api/surveys/${surveyId}/ai/propose`).set(admin).send({ instruction: 'Add an age question' });
    expect(ai.status).toBe(403);
    expect(JSON.stringify(ai.body)).toMatch(/keeps data inside this deployment/);
    await http.put('/api/organization/governance').set(admin).send({ blockExternalProcessors: false }).expect(200);
  });

  it('erases old interviews and contacts by the retention policy, keeping counts', async () => {
    await http
      .put('/api/organization/governance')
      .set(admin)
      .send({ retention: { responsesDays: 30, contactsDays: 30 } })
      .expect(200);
    const survey = await prisma.survey.findUniqueOrThrow({ where: { id: surveyId } });
    const old = await prisma.response.create({
      data: {
        tenantId,
        surveyId,
        versionId: survey.liveVersionId!,
        uid: `${run}-old`,
        status: 'COMPLETE',
        startedAt: new Date(Date.now() - 40 * 86_400_000),
        completedAt: new Date(Date.now() - 40 * 86_400_000),
        sessionTokenHash: `${run}-old`,
        answers: { AGE: 33, GENDER: 2 },
        userAgent: 'Mozilla',
        ipHash: 'abc',
      },
    });
    const contact = await prisma.contact.create({
      data: { tenantId, surveyId, email: `old-${run}@example.com`, name: 'Old', createdAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    const optedOut = await prisma.contact.create({
      data: {
        tenantId,
        surveyId,
        email: `gone-${run}@example.com`,
        unsubscribedAt: new Date(),
        createdAt: new Date(Date.now() - 40 * 86_400_000),
      },
    });
    const before = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(admin)
        .send({ variables: ['AGE'] })
        .expect(200)
    ).body.total;
    const out = await app.get(GovernanceService).applyRetention();
    expect(out.responses).toBeGreaterThanOrEqual(1);
    const erased = await prisma.response.findUniqueOrThrow({ where: { id: old.id } });
    expect(erased).toMatchObject({ answers: {}, userAgent: null, ipHash: null, uid: `erased-${old.id}`, status: 'COMPLETE' });
    expect(erased.erasedAt).not.toBeNull();
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).email).toBeNull();
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: optedOut.id } })).email).toBe(`gone-${run}@example.com`);
    // Erased interviews leave analysis (the count of completes in fieldwork stays).
    const after = (
      await http
        .post(`/api/surveys/${surveyId}/analysis/frequencies`)
        .set(admin)
        .send({ variables: ['AGE'] })
        .expect(200)
    ).body.total;
    expect(after).toBe(before - 1);
    expect(await prisma.auditEvent.count({ where: { tenantId, action: 'retention.apply' } })).toBe(1);
    await http
      .put('/api/organization/governance')
      .set(admin)
      .send({ retention: { responsesDays: null, contactsDays: null } })
      .expect(200);
    expect((await http.get('/api/organization/governance').set(admin).expect(200)).body.retention).toEqual({});
  });
});

class FakeSms implements SmsProvider {
  readonly name = 'fake';
  sent: OutgoingSms[] = [];
  async send(sms: OutgoingSms) {
    this.sent.push(sms);
  }
}

describe('SMS invitations', () => {
  it('normalizes phone numbers', () => {
    expect(normalizePhone('+44 (0)20-7946 0018'.replace('(0)', ''))).toBe('+442079460018');
    expect(normalizePhone('0044 20 7946 0018')).toBe('+442079460018');
    expect(normalizePhone('020 7946 0018')).toBeNull();
  });

  it('imports phone contacts and texts personal links with an opt-out', async () => {
    const csv = 'phone,name,email\n+447700900001,Asha,\n+1 415 555 0100,Ben,ben@example.com\n12345,Bad,\n';
    const imp = (await http.post(`/api/surveys/${surveyId}/contacts/import`).set(admin).send({ csv }).expect(201)).body;
    expect(imp.added).toBe(2);
    expect(imp.errors).toEqual([{ row: 4, message: expect.stringMatching(/country code/) }]);
    await http
      .post(`/api/surveys/${surveyId}/distributions`)
      .set(admin)
      .send({ name: 'Text', channel: 'SMS', body: 'Hi [name], a short survey: [link]', sendAt: new Date().toISOString() })
      .expect(201);
    await http
      .post(`/api/surveys/${surveyId}/distributions`)
      .set(admin)
      .send({ name: 'No subject email', body: '[link]', sendAt: new Date().toISOString() })
      .expect(400);
    const sms = new FakeSms();
    const r = await app.get(DistributionService).pass(null, new Date(Date.now() + 1000), sms);
    expect(r.sent).toBe(2);
    const asha = sms.sent.find((s) => s.to === '+447700900001')!;
    expect(asha.text).toMatch(/^Hi Asha, a short survey: http\S+\/s\/\S+uid=inv-/);
    expect(asha.text).toMatch(/\nStop: http\S+\/api\/public\/unsubscribe\/inv-/);
    const waves = (await http.get(`/api/surveys/${surveyId}/distributions`).set(admin).expect(200)).body;
    expect(waves.items[0]).toMatchObject({ channel: 'sms', sent: 2 });
  });

  it('calls the Twilio Messages API (local stand-in)', async () => {
    const seen: Array<{ url: string; auth: string; body: string }> = [];
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', auth: req.headers.authorization ?? '', body });
        const ok = !body.includes('To=%2B10000000000');
        res.writeHead(ok ? 201 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ok ? { sid: 'SM1' } : { code: 21211, message: "The 'To' number is not a valid phone number." }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const p = new TwilioSmsProvider('AC123', 'secret', base, '+15005550006');
      await p.send({ to: '+447700900001', text: 'Hello' }, AbortSignal.timeout(5000));
      expect(seen[0]!.url).toBe('/2010-04-01/Accounts/AC123/Messages.json');
      expect(seen[0]!.auth).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
      expect(new URLSearchParams(seen[0]!.body).get('From')).toBe('+15005550006');
      await expect(p.send({ to: '+10000000000', text: 'x' }, AbortSignal.timeout(5000))).rejects.toThrow(/not a valid phone number.*21211/);
      const svc = new TwilioSmsProvider('AC123', 'secret', base, `MG${'a'.repeat(32)}`);
      await svc.send({ to: '+447700900001', text: 'Hi' }, AbortSignal.timeout(5000));
      expect(new URLSearchParams(seen[2]!.body).get('MessagingServiceSid')).toBe(`MG${'a'.repeat(32)}`);
    } finally {
      server.close();
    }
  });
});

describe('workspace presets and per-area themes', () => {
  it('lets admins save presets everyone can pick, with per-area theme families', async () => {
    const appearance = { preset: 'neon-ai', mode: 'dark', modules: { analysis: 'arctic-glass' } };
    await http.post('/api/tenant/appearance-presets').set(programmer).send({ name: 'Research', appearance }).expect(403);
    const p = (await http.post('/api/tenant/appearance-presets').set(admin).send({ name: 'Research', appearance }).expect(201)).body;
    expect(p.appearance.modules).toEqual({ analysis: 'arctic-glass' });
    await http.post('/api/tenant/appearance-presets').set(admin).send({ name: 'research', appearance }).expect(400);
    await http
      .post('/api/tenant/appearance-presets')
      .set(admin)
      .send({ name: 'Bad', appearance: { modules: { analysis: 'nope' } } })
      .expect(400);
    const list = (await http.get('/api/tenant/appearance-presets').set(programmer).expect(200)).body;
    expect(list.map((x: { name: string }) => x.name)).toEqual(['Research']);
    // A member picks it: their own appearance keeps the per-area families.
    const mine = (await http.put('/api/me/preferences').set(programmer).send({ appearance: p.appearance }).expect(200)).body;
    expect(mine.appearance.modules).toEqual({ analysis: 'arctic-glass' });
    await http.delete(`/api/tenant/appearance-presets/${p.id}`).set(admin).expect(204);
    expect((await http.get('/api/tenant/appearance-presets').set(admin).expect(200)).body).toEqual([]);
  });
});
