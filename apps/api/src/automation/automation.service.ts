/**
 * Blueprint phase 5: the automation engine. Rules are kept per organization; the background
 * worker runs scheduled rules when due and works the queued runs: it checks the conditions, holds
 * the actions for an administrator when the rule asks for approval, and otherwise runs them. Every
 * run is logged with the values its conditions saw and what each action did.
 */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AutomationRule, AutomationRun, Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { PlanService } from '../plans/plan.service';
import type { AuthUser } from '../auth/auth.types';
import { config } from '../config';
import { emailProvider } from '../distribution/mailer';
import { WebhookService } from '../integrations/webhook.service';
import { CAUSED_BY_AUTOMATION } from './automation.queue';
import {
  actionSchema,
  computeMetrics,
  conditionSchema,
  describeEvent,
  describeRule,
  evaluateConditions,
  metricsNeeded,
  nextRun,
  ruleSchema,
  scheduleSchema,
  type Action,
  type Audience,
  type Metric,
  type RuleInput,
} from './automation-rules';

const BATCH = 50;
const MAX_RECIPIENTS = 50;

export interface ActionResult {
  type: Action['type'];
  ok: boolean;
  detail: string;
}

/** Stored JSON read back leniently: anything that no longer validates is dropped. */
function readRule(r: AutomationRule): RuleInput {
  const conditions = (Array.isArray(r.conditions) ? r.conditions : []).flatMap((c) => {
    const p = conditionSchema.safeParse(c);
    return p.success ? [p.data] : [];
  });
  const actions = (Array.isArray(r.actions) ? r.actions : []).flatMap((a) => {
    const p = actionSchema.safeParse(a);
    return p.success ? [p.data] : [];
  });
  const schedule = r.schedule ? scheduleSchema.safeParse(r.schedule) : null;
  return {
    name: r.name,
    enabled: r.enabled,
    surveyId: r.surveyId,
    trigger: r.trigger as RuleInput['trigger'],
    schedule: schedule?.success ? schedule.data : null,
    conditions,
    actions,
    requiresApproval: r.requiresApproval,
    cooldownMinutes: r.cooldownMinutes,
  };
}

@Injectable()
export class AutomationService {
  private readonly log = new Logger('Automation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly plans: PlanService,
    private readonly webhooks: WebhookService,
  ) {}

  // ---- Rules ------------------------------------------------------------------------------------

  private present(r: AutomationRule) {
    const rule = readRule(r);
    return {
      id: r.id,
      ...rule,
      description: describeRule(rule),
      nextRunAt: r.nextRunAt,
      lastFiredAt: r.lastFiredAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private async checkSurvey(user: AuthUser, surveyId: string | null) {
    if (!surveyId) return;
    const s = await this.prisma.survey.findFirst({ where: { id: surveyId, ...this.access.surveys(user) }, select: { id: true } });
    if (!s) throw new NotFoundException('Survey not found');
  }

  async surveys(user: AuthUser) {
    const rows = await this.prisma.survey.findMany({
      where: this.access.surveys(user),
      select: { id: true, name: true, status: true, project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((s) => ({ id: s.id, name: s.name, status: s.status.toLowerCase(), project: s.project.name }));
  }

  async list(user: AuthUser, surveyId?: string) {
    const rules = await this.prisma.automationRule.findMany({
      where: { tenantId: user.tenantId, ...(surveyId ? { surveyId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    const visible: AutomationRule[] = [];
    for (const r of rules) {
      if (!r.surveyId || (await this.prisma.survey.count({ where: { id: r.surveyId, ...this.access.surveys(user) } }))) visible.push(r);
    }
    const counts = await this.prisma.automationRun.groupBy({
      by: ['ruleId', 'state'],
      where: { ruleId: { in: visible.map((r) => r.id) } },
      _count: true,
    });
    return visible.map((r) => ({
      ...this.present(r),
      runs: Object.fromEntries(counts.filter((c) => c.ruleId === r.id).map((c) => [c.state.toLowerCase(), c._count])),
    }));
  }

  private async own(user: AuthUser, id: string) {
    const r = await this.prisma.automationRule.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!r) throw new NotFoundException('Rule not found');
    await this.checkSurvey(user, r.surveyId);
    return r;
  }

  async create(user: AuthUser, body: unknown) {
    const input = this.parse(body);
    await this.checkSurvey(user, input.surveyId);
    const r = await this.prisma.automationRule.create({
      data: {
        ...this.columns(input),
        tenantId: user.tenantId,
        createdById: user.id,
      },
    });
    await this.audit.record(user, 'automation.create', 'automation_rule', r.id, { name: r.name, trigger: r.trigger });
    return this.present(r);
  }

  async update(user: AuthUser, id: string, body: unknown) {
    const before = await this.own(user, id);
    const input = this.parse({ ...readRule(before), ...(body && typeof body === 'object' ? body : {}) });
    await this.checkSurvey(user, input.surveyId);
    const r = await this.prisma.automationRule.update({ where: { id }, data: this.columns(input) });
    await this.audit.record(user, 'automation.update', 'automation_rule', id, { name: r.name, enabled: r.enabled });
    return this.present(r);
  }

  async remove(user: AuthUser, id: string) {
    const r = await this.own(user, id);
    await this.prisma.automationRule.delete({ where: { id } });
    await this.audit.record(user, 'automation.delete', 'automation_rule', id, { name: r.name });
  }

  private parse(body: unknown): RuleInput {
    const p = ruleSchema.safeParse(body);
    if (!p.success) throw new BadRequestException(p.error.issues.map((i) => `${i.path.join('.') || 'rule'}: ${i.message}`).join('; '));
    return p.data;
  }

  private columns(input: RuleInput) {
    return {
      name: input.name,
      enabled: input.enabled,
      surveyId: input.surveyId,
      trigger: input.trigger,
      schedule: (input.schedule ?? undefined) as Prisma.InputJsonValue | undefined,
      conditions: input.conditions as Prisma.InputJsonValue,
      actions: input.actions as Prisma.InputJsonValue,
      requiresApproval: input.requiresApproval,
      cooldownMinutes: input.cooldownMinutes,
      nextRunAt: input.trigger === 'schedule' && input.schedule && input.enabled ? nextRun(input.schedule, new Date()) : null,
    };
  }

  /** Check the conditions against the survey's numbers now, without running anything. */
  async dryRun(user: AuthUser, id: string, event: Record<string, unknown> = {}) {
    const r = await this.own(user, id);
    const rule = readRule(r);
    const metrics = await this.metrics(user.tenantId, r.surveyId, metricsNeeded(rule.conditions));
    const { ok, results } = evaluateConditions(rule.conditions, event, metrics);
    return {
      wouldRun: ok,
      conditions: results.map((x) => ({
        field: x.condition.field,
        op: x.condition.op,
        value: x.condition.value,
        actual: x.actual,
        ok: x.ok,
      })),
      description: describeRule(rule),
    };
  }

  // ---- Runs and approvals -------------------------------------------------------------------------

  async runs(user: AuthUser, q: { ruleId?: string; state?: string }) {
    const state = q.state?.toUpperCase();
    const rows = await this.prisma.automationRun.findMany({
      where: {
        tenantId: user.tenantId,
        ...(q.ruleId ? { ruleId: q.ruleId } : {}),
        ...(state && ['PENDING', 'AWAITING_APPROVAL', 'RUNNING', 'DONE', 'SKIPPED', 'REJECTED', 'FAILED'].includes(state)
          ? { state: state as AutomationRun['state'] }
          : {}),
      },
      include: { rule: { select: { name: true, surveyId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const out = [];
    for (const r of rows) {
      if (r.rule.surveyId && !(await this.prisma.survey.count({ where: { id: r.rule.surveyId, ...this.access.surveys(user) } }))) continue;
      out.push({
        id: r.id,
        ruleId: r.ruleId,
        ruleName: r.rule.name,
        event: r.event,
        summary: describeEvent(r.event, (r.data ?? {}) as Record<string, unknown>),
        state: r.state.toLowerCase(),
        note: r.note,
        results: r.results,
        decidedAt: r.decidedAt,
        createdAt: r.createdAt,
      });
    }
    return out;
  }

  async decide(user: AuthUser, runId: string, decision: 'approve' | 'reject') {
    const run = await this.prisma.automationRun.findFirst({ where: { id: runId, tenantId: user.tenantId }, include: { rule: true } });
    if (!run) throw new NotFoundException('Run not found');
    const claimed = await this.prisma.automationRun.updateMany({
      where: { id: runId, state: 'AWAITING_APPROVAL' },
      data: { state: decision === 'approve' ? 'RUNNING' : 'REJECTED', decidedById: user.id, decidedAt: new Date() },
    });
    if (!claimed.count) throw new ConflictException('This run is not waiting for approval');
    await this.audit.record(user, `automation.${decision}`, 'automation_run', runId, { ruleId: run.ruleId, rule: run.rule.name });
    if (decision === 'reject') return { state: 'rejected' };
    const results = await this.perform(run.rule, readRule(run.rule), run, user.id);
    const state = results.some((x) => x.ok) || !results.length ? 'DONE' : 'FAILED';
    await this.prisma.automationRun.update({ where: { id: runId }, data: { state, results: results as unknown as Prisma.InputJsonValue } });
    return { state: state.toLowerCase(), results };
  }

  // ---- Worker -------------------------------------------------------------------------------------

  /** One pass: queue due schedules, then work queued runs. */
  async pass(now = new Date()): Promise<{ scheduled: number; done: number; skipped: number; awaiting: number; failed: number }> {
    const out = { scheduled: 0, done: 0, skipped: 0, awaiting: 0, failed: 0 };
    const due = await this.prisma.automationRule.findMany({
      where: { trigger: 'schedule', enabled: true, nextRunAt: { lte: now } },
      take: BATCH,
    });
    for (const r of due) {
      const rule = readRule(r);
      if (!rule.schedule) continue;
      // Claim by moving nextRunAt on, so two workers never queue the same slot.
      const claimed = await this.prisma.automationRule.updateMany({
        where: { id: r.id, nextRunAt: r.nextRunAt },
        data: { nextRunAt: nextRun(rule.schedule, now) },
      });
      if (!claimed.count) continue;
      await this.prisma.automationRun.create({
        data: { tenantId: r.tenantId, ruleId: r.id, event: 'schedule', data: { surveyId: r.surveyId, at: now.toISOString() } },
      });
      out.scheduled++;
    }
    for (let round = 0; round < 4; round++) {
      const runs = await this.prisma.$queryRaw<AutomationRun[]>`
        UPDATE "AutomationRun" SET state = 'RUNNING', "updatedAt" = now()
        WHERE id IN (
          SELECT id FROM "AutomationRun" WHERE state = 'PENDING' ORDER BY "createdAt" ASC LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
        )
        RETURNING *`;
      if (!runs.length) break;
      for (const run of runs) {
        const state = await this.execute(run, now).catch(async (e: Error) => {
          this.log.error(`Automation run ${run.id} failed: ${e.message}`);
          await this.prisma.automationRun.update({ where: { id: run.id }, data: { state: 'FAILED', note: e.message.slice(0, 300) } });
          return 'FAILED' as const;
        });
        if (state === 'DONE') out.done++;
        else if (state === 'SKIPPED') out.skipped++;
        else if (state === 'AWAITING_APPROVAL') out.awaiting++;
        else out.failed++;
      }
    }
    return out;
  }

  private async execute(run: AutomationRun, now: Date): Promise<AutomationRun['state']> {
    const finish = (state: AutomationRun['state'], note: string | null, results?: ActionResult[]) =>
      this.prisma.automationRun
        .update({
          where: { id: run.id },
          data: { state, note: note?.slice(0, 500) ?? null, ...(results ? { results: results as unknown as Prisma.InputJsonValue } : {}) },
        })
        .then(() => state);
    const r = await this.prisma.automationRule.findUnique({ where: { id: run.ruleId } });
    if (!r || !r.enabled) return finish('SKIPPED', 'The rule is switched off');
    const rule = readRule(r);
    const data = (run.data ?? {}) as Record<string, unknown>;
    const surveyId = r.surveyId ?? (typeof data.surveyId === 'string' ? data.surveyId : null);
    const metrics = await this.metrics(r.tenantId, surveyId, metricsNeeded(rule.conditions), now);
    const check = evaluateConditions(rule.conditions, data, metrics);
    const seen = check.results.map((x) => `${x.condition.field} = ${String(x.actual ?? 'none')}${x.ok ? '' : ' (no)'}`).join('; ');
    if (!check.ok) return finish('SKIPPED', `Conditions not met: ${seen}`);
    if (r.cooldownMinutes > 0) {
      const claimed = await this.prisma.automationRule.updateMany({
        where: { id: r.id, OR: [{ lastFiredAt: null }, { lastFiredAt: { lte: new Date(now.getTime() - r.cooldownMinutes * 60_000) } }] },
        data: { lastFiredAt: now },
      });
      if (!claimed.count) return finish('SKIPPED', `Fired less than ${r.cooldownMinutes} minutes ago`);
    } else {
      await this.prisma.automationRule.update({ where: { id: r.id }, data: { lastFiredAt: now } });
    }
    if (rule.requiresApproval) {
      await this.notifyUsers(
        await this.recipients(r, 'admins', surveyId),
        r.tenantId,
        `Approval needed: ${r.name}`,
        `${describeEvent(run.event, data)} ${describeRule(rule)}`,
        '/automation',
      );
      return finish('AWAITING_APPROVAL', seen || null);
    }
    const results = await this.perform(r, rule, run, null);
    return finish(results.some((x) => x.ok) || !results.length ? 'DONE' : 'FAILED', seen || null, results);
  }

  private async perform(r: AutomationRule, rule: RuleInput, run: AutomationRun, approverId: string | null): Promise<ActionResult[]> {
    const data = (run.data ?? {}) as Record<string, unknown>;
    const surveyId = r.surveyId ?? (typeof data.surveyId === 'string' ? data.surveyId : null);
    const summary = describeEvent(run.event, data);
    const link = surveyId ? `/surveys/${surveyId}` : '/automation';
    const out: ActionResult[] = [];
    for (const a of rule.actions) {
      try {
        out.push(await this.act(a, r, run, surveyId, summary, link, approverId));
      } catch (e) {
        out.push({ type: a.type, ok: false, detail: (e as Error).message.slice(0, 300) });
      }
    }
    return out;
  }

  private async act(
    a: Action,
    r: AutomationRule,
    run: AutomationRun,
    surveyId: string | null,
    summary: string,
    link: string,
    approverId: string | null,
  ): Promise<ActionResult> {
    switch (a.type) {
      case 'notify': {
        const users = await this.recipients(r, a.to, surveyId);
        await this.notifyUsers(users, r.tenantId, r.name, a.message || summary, link);
        return { type: a.type, ok: users.length > 0, detail: users.length ? `Notified ${users.length} member(s)` : 'Nobody to notify' };
      }
      case 'email': {
        const provider = emailProvider();
        if (!provider) return { type: a.type, ok: false, detail: 'Email sending is off (EMAIL_PROVIDER)' };
        const users = await this.recipients(r, a.to, surveyId);
        let sent = 0;
        const url = `${config().STUDIO_URL.replace(/\/$/, '')}${link}`;
        for (const u of users) {
          await provider.send(
            { to: { email: u.email, name: u.name }, subject: `[ZAPX] ${r.name}`, text: `${a.message || summary}\n\n${url}` },
            AbortSignal.timeout(20_000),
          );
          sent++;
        }
        return { type: a.type, ok: sent > 0, detail: sent ? `Emailed ${sent} member(s)` : 'Nobody to email' };
      }
      case 'webhook': {
        const n = await this.webhooks.emit(r.tenantId, 'automation.fired', {
          ruleId: r.id,
          rule: r.name,
          trigger: run.event,
          surveyId,
          summary,
          event: run.data,
          causedBy: CAUSED_BY_AUTOMATION,
        });
        return { type: a.type, ok: true, detail: n ? `Queued for ${n} webhook(s)` : 'No webhook subscribes to automation.fired' };
      }
      case 'set_survey_status': {
        if (!surveyId) return { type: a.type, ok: false, detail: 'The rule watches no survey' };
        const s = await this.prisma.survey.findFirst({ where: { id: surveyId, tenantId: r.tenantId, deletedAt: null } });
        if (!s) return { type: a.type, ok: false, detail: 'The survey no longer exists' };
        if (s.status === a.status) return { type: a.type, ok: true, detail: `Already ${a.status.toLowerCase()}` };
        if (a.status === 'LIVE' && !s.liveVersionId) return { type: a.type, ok: false, detail: 'The survey has no published version' };
        if (a.status === 'LIVE') await this.plans.assertLiveSurvey(r.tenantId);
        await this.prisma.survey.update({ where: { id: s.id }, data: { status: a.status } });
        await this.audit.record({ tenantId: r.tenantId, id: approverId }, 'survey.status', 'survey', s.id, {
          from: s.status,
          to: a.status,
          automationRuleId: r.id,
          automationRunId: run.id,
        });
        await this.webhooks.emit(r.tenantId, 'survey.status_changed', {
          surveyId: s.id,
          projectId: s.projectId,
          from: s.status,
          to: a.status,
          causedBy: CAUSED_BY_AUTOMATION,
        });
        return { type: a.type, ok: true, detail: `Survey set to ${a.status.toLowerCase()}` };
      }
    }
  }

  private async recipients(r: AutomationRule, to: Audience, surveyId: string | null) {
    const active = { tenantId: r.tenantId, disabledAt: null };
    const select = { id: true, email: true, name: true } as const;
    if (to === 'rule_owner')
      return r.createdById ? this.prisma.user.findMany({ where: { ...active, id: r.createdById }, select }) : Promise.resolve([]);
    if (to === 'project_team' && surveyId) {
      const s = await this.prisma.survey.findUnique({ where: { id: surveyId }, select: { projectId: true } });
      if (s)
        return this.prisma.user.findMany({
          where: {
            ...active,
            role: { in: ['ADMIN', 'PROGRAMMER', 'VIEWER'] },
            OR: [{ role: 'ADMIN' }, { projectScope: 'ALL' }, { projects: { some: { projectId: s.projectId } } }],
          },
          select,
          take: MAX_RECIPIENTS,
        });
    }
    return this.prisma.user.findMany({ where: { ...active, role: 'ADMIN' }, select, take: MAX_RECIPIENTS });
  }

  private async notifyUsers(users: Array<{ id: string }>, tenantId: string, title: string, body: string, link: string) {
    if (!users.length) return;
    await this.prisma.notification.createMany({
      data: users.map((u) => ({ tenantId, userId: u.id, title: title.slice(0, 200), body: body.slice(0, 1000), link })),
    });
  }

  /** The survey numbers a rule's conditions read (only those). */
  async metrics(tenantId: string, surveyId: string | null, needed: Metric[], now = new Date()): Promise<Partial<Record<Metric, number>>> {
    if (!needed.length || !surveyId) return {};
    const base = { tenantId, surveyId, isTest: false };
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [byStatus, rejected, today, last] = await Promise.all([
      this.prisma.response.groupBy({ by: ['status'], where: base, _count: true }),
      this.prisma.response.count({ where: { ...base, status: 'COMPLETE', reviewState: 'REJECTED' } }),
      this.prisma.response.count({ where: { ...base, status: 'COMPLETE', reviewState: { not: 'REJECTED' }, completedAt: { gte: day } } }),
      this.prisma.response.findFirst({
        where: { ...base, status: 'COMPLETE', reviewState: { not: 'REJECTED' } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);
    const n = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
    const all = computeMetrics(
      {
        completes: n('COMPLETE') - rejected,
        completesToday: today,
        terminates: n('TERMINATE'),
        quotaFulls: n('QUOTA_FULL'),
        qualityFails: n('QUALITY_FAIL') + rejected,
      },
      last?.completedAt ?? null,
      now,
    );
    return Object.fromEntries(needed.map((m) => [m, all[m]]));
  }

  // ---- Notifications ------------------------------------------------------------------------------

  async notifications(user: AuthUser) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt })),
    };
  }

  async markRead(user: AuthUser, id?: string) {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
  }
}
