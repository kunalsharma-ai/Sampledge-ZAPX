import { Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PlatformAutomation, Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { PlanService } from '../plans/plan.service';
import { config } from '../config';
import { emailProvider } from '../distribution/mailer';
import type { AuthUser } from '../auth/auth.types';
import { PlanCatalogService } from './plan-catalog.service';
import { EntitlementsService } from './entitlements.service';
import { readOverrides } from './features';
import {
  actionSchema,
  automationSchema,
  describeRule,
  fill,
  paramsSchema,
  type AutomationInput,
  type PlatformAction,
  type TriggerParams,
} from './platform-automation';

const DAY = 86_400_000;
/** At most this many organizations are handled per rule per sweep; the rest follow next time. */
const BATCH = 200;

interface Match {
  tenantId: string;
  name: string;
  plan: string;
  dedupeKey: string;
  vars: Record<string, string>;
}

interface ActionResult {
  type: PlatformAction['type'];
  ok: boolean;
  detail: string;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
const month = (d = new Date()) => d.toISOString().slice(0, 7);

/** Stored JSON read back leniently: actions that no longer validate are dropped. */
function readRule(r: PlatformAutomation): AutomationInput & { id: string } {
  const params = paramsSchema.safeParse(r.params);
  const actions = (Array.isArray(r.actions) ? r.actions : []).flatMap((a) => {
    const p = actionSchema.safeParse(a);
    return p.success ? [p.data] : [];
  });
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger as AutomationInput['trigger'],
    params: params.success ? params.data : {},
    actions,
  };
}

/**
 * Runs the super admin's automation rules: every PLATFORM_AUTOMATION_MS each enabled rule finds the
 * organizations its trigger matches and runs its actions once per firing. Several API processes can
 * run this at the same time: a firing is claimed by inserting its run row, which is unique per rule
 * and dedupe key, so only one process acts on it.
 */
@Injectable()
export class PlatformAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PlatformAutomation');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
    private readonly catalog: PlanCatalogService,
    private readonly entitlements: EntitlementsService,
  ) {}

  onModuleInit() {
    if (config().PLATFORM_AUTOMATION !== 'on') return;
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn((e as Error).message)), config().PLATFORM_AUTOMATION_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- Rules -------------------------------------------------------------------------------------

  async list() {
    const rows = await this.prisma.platformAutomation.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { runs: true } } },
    });
    return rows.map((r) => {
      const rule = readRule(r);
      return { ...rule, summary: describeRule(rule), runs: r._count.runs, lastRunAt: r.lastRunAt, createdAt: r.createdAt };
    });
  }

  async create(actor: AuthUser, input: AutomationInput) {
    const r = await this.prisma.platformAutomation.create({
      data: { ...this.data(input), createdById: actor.id },
    });
    await this.audit.record({ tenantId: actor.tenantId, id: actor.id }, 'super.automation_created', 'platform_automation', r.id, {
      name: r.name,
      bySuperAdmin: actor.email,
    });
    return readRule(r);
  }

  async update(actor: AuthUser, id: string, input: Partial<AutomationInput>) {
    const before = await this.prisma.platformAutomation.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Automation not found');
    const merged = automationSchema.parse({ ...readRule(before), ...input });
    const r = await this.prisma.platformAutomation.update({ where: { id }, data: this.data(merged) });
    await this.audit.record({ tenantId: actor.tenantId, id: actor.id }, 'super.automation_updated', 'platform_automation', id, {
      name: r.name,
      enabled: r.enabled,
      bySuperAdmin: actor.email,
    });
    return readRule(r);
  }

  async remove(actor: AuthUser, id: string) {
    const r = await this.prisma.platformAutomation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Automation not found');
    await this.prisma.platformAutomation.delete({ where: { id } });
    await this.audit.record({ tenantId: actor.tenantId, id: actor.id }, 'super.automation_deleted', 'platform_automation', id, {
      name: r.name,
      bySuperAdmin: actor.email,
    });
  }

  private data(input: AutomationInput) {
    return {
      name: input.name,
      enabled: input.enabled,
      trigger: input.trigger,
      params: input.params as Prisma.InputJsonValue,
      actions: input.actions as unknown as Prisma.InputJsonValue,
    };
  }

  async runs(automationId?: string) {
    const runs = await this.prisma.platformAutomationRun.findMany({
      where: automationId ? { automationId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { automation: { select: { name: true } } },
    });
    const names = new Map(
      (
        await this.prisma.tenant.findMany({
          where: { id: { in: [...new Set(runs.map((r) => r.tenantId))] } },
          select: { id: true, name: true },
        })
      ).map((t) => [t.id, t.name]),
    );
    return runs.map((r) => ({
      id: r.id,
      automation: { id: r.automationId, name: r.automation.name },
      organization: { id: r.tenantId, name: names.get(r.tenantId) ?? null },
      outcome: r.outcome,
      results: r.results,
      at: r.createdAt,
    }));
  }

  /** Which organizations the rule would act on now, and which of them it already acted on. */
  async preview(id: string) {
    const r = await this.prisma.platformAutomation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Automation not found');
    const rule = readRule(r);
    const matches = await this.matches(rule.trigger, rule.params, r.createdAt);
    const done = new Set(
      (
        await this.prisma.platformAutomationRun.findMany({
          where: { automationId: id, dedupeKey: { in: matches.map((m) => m.dedupeKey) } },
          select: { dedupeKey: true },
        })
      ).map((x) => x.dedupeKey),
    );
    return {
      summary: describeRule(rule),
      organizations: matches.map((m) => ({ id: m.tenantId, name: m.name, plan: m.plan, alreadyDone: done.has(m.dedupeKey) })),
    };
  }

  // ---- Running -----------------------------------------------------------------------------------

  /** Check every enabled rule once. Returns how many firings ran. */
  async sweep(onlyId?: string) {
    if (this.running) return 0;
    this.running = true;
    let fired = 0;
    try {
      const rules = await this.prisma.platformAutomation.findMany({ where: { enabled: true, ...(onlyId ? { id: onlyId } : {}) } });
      for (const r of rules) {
        const rule = readRule(r);
        if (!rule.actions.length) continue;
        for (const m of await this.matches(rule.trigger, rule.params, r.createdAt)) {
          if (await this.fire(r.id, rule.actions, m)) fired++;
        }
        await this.prisma.platformAutomation.update({ where: { id: r.id }, data: { lastRunAt: new Date() } });
      }
    } finally {
      this.running = false;
    }
    if (fired) this.entitlements.changed();
    return fired;
  }

  private async fire(automationId: string, actions: PlatformAction[], m: Match) {
    let runId: string;
    try {
      runId = (
        await this.prisma.platformAutomationRun.create({
          data: { automationId, tenantId: m.tenantId, dedupeKey: m.dedupeKey, outcome: 'running' },
          select: { id: true },
        })
      ).id;
    } catch {
      return false; // Already fired (here or in another process).
    }
    const results: ActionResult[] = [];
    for (const a of actions) {
      try {
        results.push(await this.act(a, m));
      } catch (e) {
        results.push({ type: a.type, ok: false, detail: (e as Error).message.slice(0, 300) });
      }
    }
    const ok = results.filter((x) => x.ok).length;
    const outcome = ok === results.length ? 'ok' : ok ? 'partial' : 'failed';
    await this.prisma.platformAutomationRun.update({
      where: { id: runId },
      data: { outcome, results: results as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record({ tenantId: m.tenantId, id: null }, 'super.automation_ran', 'platform_automation', automationId, {
      outcome,
      results: results.map((r) => `${r.type}: ${r.detail}`),
    });
    return true;
  }

  private async act(a: PlatformAction, m: Match): Promise<ActionResult> {
    switch (a.type) {
      case 'notify_super_admins': {
        const admins = await this.prisma.user.findMany({
          where: { superAdmin: true, disabledAt: null },
          select: { id: true, tenantId: true },
        });
        const body = fill(a.message || '{organization}: automation rule matched.', m.vars);
        await this.prisma.notification.createMany({
          data: admins.map((u) => ({
            tenantId: u.tenantId,
            userId: u.id,
            title: 'Super admin automation',
            body,
            link: `/super-admin/organizations/${m.tenantId}`,
          })),
        });
        return { type: a.type, ok: true, detail: `Notified ${admins.length} super admin(s)` };
      }
      case 'email_org_admins': {
        const provider = emailProvider();
        if (!provider) return { type: a.type, ok: false, detail: 'Email sending is off (EMAIL_PROVIDER)' };
        const admins = await this.prisma.user.findMany({
          where: { tenantId: m.tenantId, role: 'ADMIN', disabledAt: null },
          select: { email: true, name: true },
          take: 20,
        });
        for (const u of admins)
          await provider.send(
            {
              to: { email: u.email, name: u.name },
              subject: fill(a.subject || '[ZAPX] Your subscription', m.vars),
              text: fill(a.message || '', m.vars),
            },
            AbortSignal.timeout(20_000),
          );
        return {
          type: a.type,
          ok: admins.length > 0,
          detail: admins.length ? `Emailed ${admins.length} administrator(s)` : 'No administrator to email',
        };
      }
      case 'change_plan': {
        if (!this.catalog.exists(a.plan)) return { type: a.type, ok: false, detail: `Unknown plan ${a.plan}` };
        await this.prisma.tenant.update({ where: { id: m.tenantId }, data: { plan: a.plan } });
        return { type: a.type, ok: true, detail: `Plan ${m.plan} → ${a.plan}` };
      }
      case 'set_subscription': {
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: m.tenantId }, select: { subscriptionEndsAt: true } });
        let endsAt: Date | null | undefined;
        if (a.clearEnd) endsAt = null;
        else if (a.extendDays) {
          const from = t.subscriptionEndsAt && t.subscriptionEndsAt.getTime() > Date.now() ? t.subscriptionEndsAt.getTime() : Date.now();
          endsAt = new Date(from + a.extendDays * DAY);
        }
        await this.prisma.tenant.update({
          where: { id: m.tenantId },
          data: { ...(a.status ? { subscriptionStatus: a.status } : {}), ...(endsAt !== undefined ? { subscriptionEndsAt: endsAt } : {}) },
        });
        const parts = [a.status ? `status ${a.status}` : '', endsAt === null ? 'no end date' : endsAt ? `ends ${day(endsAt)}` : ''];
        return { type: a.type, ok: true, detail: parts.filter(Boolean).join(', ') || 'No change' };
      }
      case 'suspend_org': {
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: m.tenantId }, select: { platformOperator: true } });
        if (t.platformOperator) return { type: a.type, ok: false, detail: 'The operator organization is never suspended' };
        await this.prisma.tenant.update({
          where: { id: m.tenantId },
          data: { suspendedAt: new Date(), suspendedReason: a.reason || 'Automation' },
        });
        return { type: a.type, ok: true, detail: 'Suspended' };
      }
      case 'reactivate_org':
        await this.prisma.tenant.update({ where: { id: m.tenantId }, data: { suspendedAt: null, suspendedReason: null } });
        return { type: a.type, ok: true, detail: 'Reactivated' };
      case 'set_feature': {
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: m.tenantId }, select: { featureOverrides: true } });
        const o = readOverrides(t.featureOverrides);
        for (const s of a.surface === 'both' ? (['web', 'mobile'] as const) : [a.surface]) o[s] = { ...(o[s] ?? {}), [a.feature]: a.on };
        await this.prisma.tenant.update({ where: { id: m.tenantId }, data: { featureOverrides: o as Prisma.InputJsonValue } });
        return { type: a.type, ok: true, detail: `${a.feature} ${a.on ? 'on' : 'off'} (${a.surface})` };
      }
    }
  }

  // ---- Triggers ----------------------------------------------------------------------------------

  async matches(trigger: string, p: TriggerParams, ruleCreatedAt: Date): Promise<Match[]> {
    const now = new Date();
    const select = { id: true, name: true, plan: true, subscriptionEndsAt: true, subscriptionStatus: true, createdAt: true } as const;
    const base: Prisma.TenantWhereInput = { platformOperator: false, ...(p.status ? { subscriptionStatus: p.status } : {}) };
    const vars = (t: { name: string; plan: string; subscriptionEndsAt: Date | null }, extra: Record<string, string> = {}) => ({
      organization: t.name,
      plan: this.catalog.get(t.plan).name,
      endsAt: day(t.subscriptionEndsAt),
      ...extra,
    });
    const match = (
      t: { id: string; name: string; plan: string; subscriptionEndsAt: Date | null },
      key: string,
      extra?: Record<string, string>,
    ) => ({
      tenantId: t.id,
      name: t.name,
      plan: t.plan,
      dedupeKey: `${t.id}:${key}`,
      vars: vars(t, extra),
    });

    switch (trigger) {
      case 'org_created': {
        const ts = await this.prisma.tenant.findMany({ where: { ...base, createdAt: { gte: ruleCreatedAt } }, select, take: BATCH });
        return ts.map((t) => match(t, 'created'));
      }
      case 'subscription_ending': {
        const ts = await this.prisma.tenant.findMany({
          where: { ...base, suspendedAt: null, subscriptionEndsAt: { gt: now, lte: new Date(now.getTime() + (p.days ?? 7) * DAY) } },
          select,
          take: BATCH,
        });
        return ts.map((t) => match(t, `ending:${day(t.subscriptionEndsAt)}`));
      }
      case 'subscription_ended': {
        const ts = await this.prisma.tenant.findMany({ where: { ...base, subscriptionEndsAt: { lte: now } }, select, take: BATCH });
        return ts.map((t) => match(t, `ended:${day(t.subscriptionEndsAt)}`));
      }
      case 'completes_used': {
        const ts = await this.prisma.tenant.findMany({ where: { ...base, suspendedAt: null }, select, take: 1000 });
        const out: Match[] = [];
        for (const t of ts) {
          const limit = this.catalog.get(t.plan).limits.completesPerMonth;
          if (!limit) continue;
          const used = await this.plans.completesThisMonth(t.id);
          const pct = Math.floor((used / limit) * 100);
          if (pct >= (p.percent ?? 90)) out.push(match(t, `completes:${month()}`, { percent: String(pct) }));
          if (out.length >= BATCH) break;
        }
        return out;
      }
      case 'seats_full': {
        const ts = await this.prisma.tenant.findMany({ where: { ...base, suspendedAt: null }, select, take: 1000 });
        const counts = new Map(
          (
            await this.prisma.user.groupBy({
              by: ['tenantId'],
              where: { tenantId: { in: ts.map((t) => t.id) }, disabledAt: null, role: { not: 'INTERVIEWER' } },
              _count: { _all: true },
            })
          ).map((c) => [c.tenantId, c._count._all]),
        );
        return ts
          .filter((t) => {
            const max = this.catalog.get(t.plan).limits.seats;
            return max !== null && (counts.get(t.id) ?? 0) >= max;
          })
          .slice(0, BATCH)
          .map((t) => match(t, `seats:${month()}`));
      }
      case 'admins_inactive': {
        const since = new Date(now.getTime() - (p.days ?? 30) * DAY);
        const ts = await this.prisma.tenant.findMany({
          where: {
            ...base,
            suspendedAt: null,
            createdAt: { lte: since },
            users: { none: { role: 'ADMIN', lastSeenAt: { gte: since } } },
          },
          select,
          take: BATCH,
        });
        // Once per period of inactivity: the key changes every N days.
        const period = Math.floor(now.getTime() / ((p.days ?? 30) * DAY));
        return ts.map((t) => match(t, `inactive:${period}`));
      }
      default:
        return [];
    }
  }
}
