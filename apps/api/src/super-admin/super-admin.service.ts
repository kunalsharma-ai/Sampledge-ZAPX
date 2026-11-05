/**
 * Super admin: the installation-wide console. Registers organizations and their administrators,
 * manages subscription plans (limits and the features of each plan, separately for the web CRM and
 * the mobile app), switches features on or off per organization and per member, suspends and
 * reactivates organizations, and shows every organization's activity and integrations.
 *
 * Every change is written to the audit log of the organization it touches, with the super admin as
 * the actor, so the organization's own administrators see it too.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import type { Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { PlanService } from '../plans/plan.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { IntegrationSettingsService } from '../platform/integration-settings.service';
import type { AuthUser, RoleName } from '../auth/auth.types';
import { PlanCatalogService, readLimits } from './plan-catalog.service';
import { EntitlementsService } from './entitlements.service';
import { FEATURES, SURFACES, isFeatureKey, readOverrides, resolveEntitlements, type Overrides, type Surface } from './features';
import type { CreateOrgInput, CreateUserInput, OrgPatch, PlanInput, UserPatch, ActivityQuery } from './super-admin.schemas';

const DAY = 86_400_000;

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
    private readonly catalog: PlanCatalogService,
    private readonly resets: PasswordResetService,
    private readonly integrations: IntegrationSettingsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private record(
    actor: AuthUser,
    tenantId: string,
    action: string,
    entityType: string,
    entityId: string,
    data: Record<string, unknown> = {},
  ) {
    return this.audit.record({ tenantId, id: actor.id }, action, entityType, entityId, { ...data, bySuperAdmin: actor.email });
  }

  // ---- Overview ----------------------------------------------------------------------------------

  async overview() {
    const now = Date.now();
    const week = new Date(now - 7 * DAY);
    const [orgs, suspended, users, active7, mobile7, byPlan, byStatus, ending, recent] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.user.count({ where: { disabledAt: null } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: week } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: week }, lastClient: 'mobile' } }),
      this.prisma.tenant.groupBy({ by: ['plan'], _count: { _all: true } }),
      this.prisma.tenant.groupBy({ by: ['subscriptionStatus'], _count: { _all: true } }),
      this.prisma.tenant.findMany({
        where: { subscriptionEndsAt: { gte: new Date(now), lte: new Date(now + 30 * DAY) } },
        select: { id: true, name: true, plan: true, subscriptionEndsAt: true, subscriptionStatus: true },
        orderBy: { subscriptionEndsAt: 'asc' },
        take: 10,
      }),
      this.activity({ limit: 12 }),
    ]);
    return {
      organizations: orgs,
      suspended,
      members: users,
      activeMembers7d: active7,
      mobileMembers7d: mobile7,
      byPlan: byPlan.map((p) => ({ plan: p.plan, organizations: p._count._all })),
      byStatus: byStatus.map((s) => ({ status: s.subscriptionStatus, organizations: s._count._all })),
      endingSoon: ending,
      recentActivity: recent.events,
    };
  }

  // ---- Plans -------------------------------------------------------------------------------------

  async listPlans() {
    const [rows, counts] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.prisma.tenant.groupBy({ by: ['plan'], _count: { _all: true } }),
    ]);
    const used = new Map(counts.map((c) => [c.plan, c._count._all]));
    return rows.map((r) => ({ ...r, limits: readLimits(r.limits), organizations: used.get(r.code) ?? 0 }));
  }

  private planData(input: PlanInput) {
    return {
      name: input.name,
      description: input.description ?? '',
      priceCents: input.priceCents ?? 0,
      currency: (input.currency ?? 'USD').toUpperCase(),
      interval: input.interval ?? 'month',
      limits: input.limits as unknown as Prisma.InputJsonValue,
      webFeatures: input.webFeatures.filter((k) => FEATURES.find((f) => f.key === k)?.surfaces.includes('web')),
      mobileFeatures: input.mobileFeatures.filter((k) => FEATURES.find((f) => f.key === k)?.surfaces.includes('mobile')),
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
    };
  }

  async createPlan(actor: AuthUser, input: PlanInput & { code: string }) {
    if (await this.prisma.subscriptionPlan.findUnique({ where: { code: input.code } }))
      throw new ConflictException('A plan with this code already exists');
    const plan = await this.prisma.subscriptionPlan.create({ data: { code: input.code, ...this.planData(input) } });
    await this.catalog.refresh();
    await this.record(actor, actor.tenantId, 'super.plan_created', 'plan', plan.code, { name: plan.name });
    return plan;
  }

  async updatePlan(actor: AuthUser, code: string, input: PlanInput) {
    const before = await this.prisma.subscriptionPlan.findUnique({ where: { code } });
    if (!before) throw new NotFoundException('Plan not found');
    const plan = await this.prisma.subscriptionPlan.update({ where: { code }, data: this.planData(input) });
    await this.catalog.refresh();
    const added = (a: string[], b: string[]) => b.filter((k) => !a.includes(k));
    await this.record(actor, actor.tenantId, 'super.plan_updated', 'plan', code, {
      webAdded: added(before.webFeatures, plan.webFeatures),
      webRemoved: added(plan.webFeatures, before.webFeatures),
      mobileAdded: added(before.mobileFeatures, plan.mobileFeatures),
      mobileRemoved: added(plan.mobileFeatures, before.mobileFeatures),
    });
    this.entitlements.changed();
    return plan;
  }

  async deletePlan(actor: AuthUser, code: string) {
    if (!(await this.prisma.subscriptionPlan.findUnique({ where: { code } }))) throw new NotFoundException('Plan not found');
    const using = await this.prisma.tenant.count({ where: { plan: code } });
    if (using) throw new ConflictException(`${using} organization(s) are on this plan. Move them to another plan first.`);
    await this.prisma.subscriptionPlan.delete({ where: { code } });
    await this.catalog.refresh();
    await this.record(actor, actor.tenantId, 'super.plan_deleted', 'plan', code);
  }

  // ---- Organizations -----------------------------------------------------------------------------

  async listOrganizations(q?: string, status?: string) {
    const where: Prisma.TenantWhereInput = {
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { users: { some: { email: { contains: q, mode: 'insensitive' } } } }] }
        : {}),
      ...(status === 'suspended' ? { suspendedAt: { not: null } } : status ? { subscriptionStatus: status, suspendedAt: null } : {}),
    };
    const rows = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        name: true,
        plan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        suspendedAt: true,
        platformOperator: true,
        createdAt: true,
        featureOverrides: true,
        _count: { select: { users: true, projects: true } },
        users: {
          where: { role: 'ADMIN' },
          orderBy: { createdAt: 'asc' },
          take: 3,
          select: { id: true, email: true, name: true, lastSeenAt: true },
        },
      },
    });
    const lastSeen = await this.prisma.user.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: rows.map((r) => r.id) } },
      _max: { lastSeenAt: true },
    });
    const seen = new Map(lastSeen.map((l) => [l.tenantId, l._max.lastSeenAt]));
    return rows.map(({ featureOverrides, users, _count, ...t }) => {
      const o = readOverrides(featureOverrides);
      return {
        ...t,
        planName: this.catalog.get(t.plan).name,
        members: _count.users,
        projects: _count.projects,
        admins: users,
        lastActiveAt: seen.get(t.id) ?? null,
        overrides: SURFACES.reduce((n, s) => n + Object.keys(o[s] ?? {}).length, 0),
      };
    });
  }

  async createOrganization(actor: AuthUser, input: CreateOrgInput) {
    if (await this.prisma.user.findUnique({ where: { email: input.adminEmail } }))
      throw new ConflictException('An account with this email already exists');
    if (!this.catalog.exists(input.plan)) throw new BadRequestException('Unknown plan');
    const passwordHash = await hash(input.adminPassword ?? randomBytes(24).toString('base64url'), 10);
    const { tenant, admin } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.organization,
          plan: input.plan,
          subscriptionStatus: input.subscriptionStatus ?? 'active',
          subscriptionEndsAt: input.subscriptionEndsAt ? new Date(input.subscriptionEndsAt) : null,
          adminNotes: input.notes ?? '',
        },
      });
      const admin = await tx.user.create({
        data: { tenantId: tenant.id, email: input.adminEmail, name: input.adminName, role: 'ADMIN', passwordHash },
      });
      return { tenant, admin };
    });
    await this.record(actor, tenant.id, 'super.organization_created', 'tenant', tenant.id, { plan: tenant.plan, admin: admin.email });
    // Without a password the administrator chooses one from a setup link (a password reset link).
    let setup: { url: string; expiresAt: Date; emailed: boolean } | null = null;
    if (!input.adminPassword) {
      const link = await this.resets.create(admin, actor.id);
      const emailed = await this.resets.email({ email: admin.email, name: admin.name }, link.url, link.expiresAt, true);
      setup = { ...link, emailed };
    }
    return { organization: tenant, admin: { id: admin.id, email: admin.email, name: admin.name }, setup };
  }

  private async tenantOr404(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Organization not found');
    return t;
  }

  async organization(id: string) {
    const t = await this.tenantOr404(id);
    const [members, usage, sso, scim, webhooks, apiKeys, vendors, ai, recent] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId: id },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          disabledAt: true,
          superAdmin: true,
          mobileAccess: true,
          featureOverrides: true,
          lastSeenAt: true,
          lastClient: true,
          createdAt: true,
        },
      }),
      this.plans.summary(id),
      this.prisma.tenantSso.findUnique({
        where: { tenantId: id },
        select: { enabled: true, protocol: true, enforced: true, domains: true },
      }),
      this.prisma.tenantScim.findUnique({ where: { tenantId: id }, select: { createdAt: true, lastUsedAt: true } }),
      this.prisma.webhook.count({ where: { tenantId: id, active: true } }),
      this.prisma.apiKey.count({ where: { tenantId: id, revokedAt: null } }),
      this.prisma.vendor.count({ where: { tenantId: id } }),
      this.prisma.tenantAiPolicy.findUnique({ where: { tenantId: id }, select: { enabled: true, allowedTasks: true } }),
      this.activity({ tenantId: id, limit: 25 }),
    ]);
    const plan = this.catalog.get(t.plan);
    const surfaces = Object.fromEntries(
      SURFACES.map((surface) => [
        surface,
        resolveEntitlements({ surface, plan, tenant: t, user: { superAdmin: false, mobileAccess: true, featureOverrides: {} } }).features,
      ]),
    ) as Record<Surface, Record<string, boolean>>;
    return {
      organization: { ...t, planName: plan.name },
      plan: { code: plan.code, name: plan.name, webFeatures: plan.webFeatures, mobileFeatures: plan.mobileFeatures },
      overrides: readOverrides(t.featureOverrides),
      effective: surfaces,
      usage,
      members: members.map((m) => ({ ...m, featureOverrides: readOverrides(m.featureOverrides) })),
      integrations: {
        sso: sso ? { enabled: sso.enabled, protocol: sso.protocol, enforced: sso.enforced, domains: sso.domains } : null,
        scim: scim ? { since: scim.createdAt, lastUsedAt: scim.lastUsedAt } : null,
        webhooks,
        apiKeys,
        vendors,
        ai: ai ? { enabled: ai.enabled, tasks: ai.allowedTasks } : null,
      },
      activity: recent.events,
    };
  }

  async updateOrganization(actor: AuthUser, id: string, patch: OrgPatch) {
    const before = await this.tenantOr404(id);
    if (patch.plan && !this.catalog.exists(patch.plan)) throw new BadRequestException('Unknown plan');
    const t = await this.prisma.tenant.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
        ...(patch.subscriptionStatus !== undefined ? { subscriptionStatus: patch.subscriptionStatus } : {}),
        ...(patch.subscriptionEndsAt !== undefined
          ? { subscriptionEndsAt: patch.subscriptionEndsAt ? new Date(patch.subscriptionEndsAt) : null }
          : {}),
        ...(patch.notes !== undefined ? { adminNotes: patch.notes } : {}),
      },
    });
    const changed = Object.fromEntries(
      (['name', 'plan', 'subscriptionStatus', 'subscriptionEndsAt'] as const)
        .filter((k) => patch[k] !== undefined && String(before[k] ?? '') !== String(t[k] ?? ''))
        .map((k) => [k, { from: before[k], to: t[k] }]),
    );
    if (Object.keys(changed).length || patch.notes !== undefined)
      await this.record(actor, id, 'super.organization_updated', 'tenant', id, changed);
    this.entitlements.changed();
    return t;
  }

  /** Replaces the organization's feature overrides (a value that equals the plan's is dropped). */
  async setOrganizationFeatures(actor: AuthUser, id: string, overrides: Overrides) {
    const t = await this.tenantOr404(id);
    const plan = this.catalog.get(t.plan);
    const clean: Overrides = {};
    for (const s of SURFACES) {
      const inPlan = new Set(s === 'web' ? plan.webFeatures : plan.mobileFeatures);
      const m = Object.fromEntries(Object.entries(overrides[s] ?? {}).filter(([k, on]) => isFeatureKey(k) && on !== inPlan.has(k)));
      if (Object.keys(m).length) clean[s] = m;
    }
    const before = readOverrides(t.featureOverrides);
    await this.prisma.tenant.update({ where: { id }, data: { featureOverrides: clean as Prisma.InputJsonValue } });
    await this.record(actor, id, 'super.features_changed', 'tenant', id, { before, after: clean });
    this.entitlements.changed();
    return { overrides: clean };
  }

  /** Changes one feature for the organization ("both" surfaces at once); null goes back to the plan. */
  async setOrganizationFeature(actor: AuthUser, id: string, change: { feature: string; surface: Surface | 'both'; on: boolean | null }) {
    const t = await this.tenantOr404(id);
    const o = readOverrides(t.featureOverrides);
    for (const s of change.surface === 'both' ? SURFACES : [change.surface]) {
      const m = { ...(o[s] ?? {}) };
      if (change.on === null) delete m[change.feature];
      else m[change.feature] = change.on;
      o[s] = m;
    }
    return this.setOrganizationFeatures(actor, id, o);
  }

  async suspend(actor: AuthUser, id: string, reason: string) {
    const t = await this.tenantOr404(id);
    if (t.platformOperator) throw new BadRequestException('The organization that runs this installation cannot be suspended');
    await this.prisma.tenant.update({ where: { id }, data: { suspendedAt: new Date(), suspendedReason: reason || null } });
    await this.record(actor, id, 'super.organization_suspended', 'tenant', id, { reason });
    this.entitlements.changed();
  }

  async reactivate(actor: AuthUser, id: string) {
    await this.tenantOr404(id);
    await this.prisma.tenant.update({ where: { id }, data: { suspendedAt: null, suspendedReason: null } });
    await this.record(actor, id, 'super.organization_reactivated', 'tenant', id);
    this.entitlements.changed();
  }

  // ---- Members -----------------------------------------------------------------------------------

  async listUsers(q?: string, tenantId?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        disabledAt: true,
        superAdmin: true,
        mobileAccess: true,
        lastSeenAt: true,
        lastClient: true,
        featureOverrides: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    return users.map((u) => ({ ...u, featureOverrides: readOverrides(u.featureOverrides) }));
  }

  async createUser(actor: AuthUser, tenantId: string, input: CreateUserInput) {
    await this.tenantOr404(tenantId);
    if (await this.prisma.user.findUnique({ where: { email: input.email } }))
      throw new ConflictException('An account with this email already exists');
    await this.plans.assertSeat(tenantId, input.role);
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash: await hash(randomBytes(24).toString('base64url'), 10),
      },
    });
    const link = await this.resets.create(user, actor.id);
    const emailed = await this.resets.email({ email: user.email, name: user.name }, link.url, link.expiresAt, true);
    await this.record(actor, tenantId, 'super.member_created', 'user', user.id, { email: user.email, role: user.role });
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, setup: { ...link, emailed } };
  }

  async updateUser(actor: AuthUser, id: string, patch: UserPatch) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Member not found');
    if (id === actor.id && (patch.superAdmin === false || patch.disabled === true))
      throw new BadRequestException('You cannot remove your own super admin access or disable yourself');
    if (patch.superAdmin === true) {
      const t = await this.tenantOr404(u.tenantId);
      if (!t.platformOperator) throw new BadRequestException('Super admins must belong to the organization that runs this installation');
    }
    if (patch.disabled === false && u.disabledAt) await this.plans.assertSeat(u.tenantId, patch.role ?? u.role);
    let overrides: Overrides | undefined;
    if (patch.featureOverrides) {
      // A member can only lose features: true values are dropped.
      overrides = {};
      for (const s of SURFACES) {
        const off = Object.fromEntries(
          Object.entries(patch.featureOverrides[s] ?? {}).filter(([k, on]) => isFeatureKey(k) && on === false),
        );
        if (Object.keys(off).length) overrides[s] = off;
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(patch.role ? { role: patch.role as RoleName } : {}),
        ...(patch.disabled !== undefined ? { disabledAt: patch.disabled ? new Date() : null } : {}),
        ...(patch.superAdmin !== undefined ? { superAdmin: patch.superAdmin } : {}),
        ...(patch.mobileAccess !== undefined ? { mobileAccess: patch.mobileAccess } : {}),
        ...(overrides ? { featureOverrides: overrides as Prisma.InputJsonValue } : {}),
      },
    });
    const { featureOverrides: _f, ...rest } = patch;
    await this.record(actor, u.tenantId, 'super.member_updated', 'user', id, {
      ...rest,
      ...(overrides ? { featureOverrides: overrides } : {}),
    });
    this.entitlements.changed();
    return {
      id: updated.id,
      role: updated.role,
      disabledAt: updated.disabledAt,
      superAdmin: updated.superAdmin,
      mobileAccess: updated.mobileAccess,
    };
  }

  async userResetLink(actor: AuthUser, id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Member not found');
    if (u.disabledAt) throw new BadRequestException('Enable this member before resetting their password');
    const link = await this.resets.create(u, actor.id);
    const emailed = await this.resets.email({ email: u.email, name: u.name }, link.url, link.expiresAt, true);
    await this.record(actor, u.tenantId, 'super.member_password_reset_link', 'user', id, { emailed });
    return { url: link.url, expiresAt: link.expiresAt, emailed };
  }

  // ---- Activity ----------------------------------------------------------------------------------

  async activity(q: ActivityQuery) {
    const limit = Math.min(q.limit ?? 50, 200);
    const events = await this.prisma.auditEvent.findMany({
      where: {
        ...(q.tenantId ? { tenantId: q.tenantId } : {}),
        ...(q.userId ? { actorId: q.userId } : {}),
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const more = events.length > limit;
    const page = events.slice(0, limit);
    const [actors, tenants] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(page.map((e) => e.actorId).filter((x): x is string => !!x))] } },
        select: { id: true, email: true, name: true, role: true },
      }),
      this.prisma.tenant.findMany({ where: { id: { in: [...new Set(page.map((e) => e.tenantId))] } }, select: { id: true, name: true } }),
    ]);
    const byId = new Map(actors.map((a) => [a.id, a]));
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    return {
      events: page.map((e) => ({
        id: e.id,
        at: e.createdAt,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        data: e.data,
        organization: { id: e.tenantId, name: names.get(e.tenantId) ?? null },
        actor: e.actorId ? (byId.get(e.actorId) ?? { id: e.actorId, email: null, name: null, role: null }) : null,
      })),
      next: more ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  // ---- Integrations ------------------------------------------------------------------------------

  async integrationsOverview(actor: AuthUser) {
    const [platform, orgs] = await Promise.all([
      this.integrations.list(actor),
      this.prisma.tenant.findMany({
        orderBy: { name: 'asc' },
        take: 500,
        select: {
          id: true,
          name: true,
          plan: true,
          featureOverrides: true,
          sso: { select: { enabled: true, protocol: true } },
          scim: { select: { lastUsedAt: true } },
          aiPolicy: { select: { enabled: true } },
        },
      }),
    ]);
    const ids = orgs.map((o) => o.id);
    const [hooks, keys, vendors] = await Promise.all([
      this.prisma.webhook.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, active: true }, _count: { _all: true } }),
      this.prisma.apiKey.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, revokedAt: null }, _count: { _all: true } }),
      this.prisma.vendor.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }),
    ]);
    const count = (rows: Array<{ tenantId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.tenantId, r._count._all]));
    const h = count(hooks);
    const k = count(keys);
    const v = count(vendors);
    return {
      platform: platform.integrations,
      organizations: orgs.map((o) => {
        const ent = resolveEntitlements({
          surface: 'web',
          plan: this.catalog.get(o.plan),
          tenant: { suspendedAt: null, featureOverrides: o.featureOverrides },
          user: { superAdmin: false, mobileAccess: true, featureOverrides: {} },
        }).features;
        return {
          id: o.id,
          name: o.name,
          sso: o.sso?.enabled ? o.sso.protocol : null,
          scim: !!o.scim,
          ai: o.aiPolicy ? o.aiPolicy.enabled : true,
          webhooks: h.get(o.id) ?? 0,
          apiKeys: k.get(o.id) ?? 0,
          vendors: v.get(o.id) ?? 0,
          allowed: {
            sso: ent.sso,
            webhooks: ent.webhooks,
            api_keys: ent.api_keys,
            integrations: ent.integrations,
            ai_assist: ent.ai_assist,
          },
        };
      }),
    };
  }
}
