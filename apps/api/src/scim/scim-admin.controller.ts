import { Controller, Delete, Get, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { PlanService } from '../plans/plan.service';
import { config } from '../config';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { generateScimToken } from './scim-token';

/** Admins create, rotate and revoke the organization's SCIM token, and read the plan and usage. */
@Controller()
export class ScimAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
  ) {}

  @Get('plan')
  @Roles('ADMIN', 'PROGRAMMER', 'VIEWER')
  plan(@CurrentUser() user: AuthUser) {
    return this.plans.summary(user.tenantId);
  }

  @Get('scim/token')
  @Roles('ADMIN')
  async status(@CurrentUser() user: AuthUser) {
    const [row, plan] = await Promise.all([
      this.prisma.tenantScim.findUnique({ where: { tenantId: user.tenantId } }),
      this.plans.plan(user.tenantId),
    ]);
    return {
      available: plan.limits.scim,
      baseUrl: `${config().STUDIO_URL.replace(/\/$/, '')}/api/scim/v2`,
      token: row ? { prefix: row.prefix, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt } : null,
    };
  }

  /** Creates the token, or replaces the current one (which stops working at once). Shown once. */
  @Post('scim/token')
  @Roles('ADMIN')
  async create(@CurrentUser() user: AuthUser) {
    await this.plans.assertFeature(user.tenantId, 'scim');
    const t = generateScimToken();
    const data = { prefix: t.prefix, secretHash: t.secretHash, createdById: user.id, createdAt: new Date(), lastUsedAt: null };
    const before = await this.prisma.tenantScim.findUnique({ where: { tenantId: user.tenantId } });
    await this.prisma.tenantScim.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, ...data }, update: data });
    await this.audit.record(user, before ? 'scim.token_rotate' : 'scim.token_create', 'tenant', user.tenantId, { prefix: t.prefix });
    return { token: t.token, prefix: t.prefix };
  }

  @Delete('scim/token')
  @Roles('ADMIN')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser) {
    const row = await this.prisma.tenantScim.findUnique({ where: { tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('There is no SCIM token');
    await this.prisma.tenantScim.delete({ where: { tenantId: user.tenantId } });
    await this.audit.record(user, 'scim.token_revoke', 'tenant', user.tenantId, { prefix: row.prefix });
  }
}
