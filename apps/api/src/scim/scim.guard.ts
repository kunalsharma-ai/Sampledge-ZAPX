import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service';
import { PlanService } from '../plans/plan.service';
import { secretMatches } from '../auth/api-keys';
import { parseScimToken } from './scim-token';
import { ScimError } from './scim.errors';

export interface ScimRequest extends Request {
  scimTenantId?: string;
}

/** Authenticates the identity provider's SCIM token; the request then acts on that organization only. */
@Injectable()
export class ScimGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<ScimRequest>();
    const header = req.headers.authorization;
    const parsed = header?.startsWith('Bearer ') ? parseScimToken(header.slice(7)) : null;
    const row = parsed ? await this.prisma.tenantScim.findUnique({ where: { prefix: parsed.prefix } }) : null;
    if (!parsed || !row || !secretMatches(parsed.secret, row.secretHash)) throw new ScimError(401, 'Invalid SCIM token');
    if (!(await this.plans.plan(row.tenantId)).limits.scim) throw new ScimError(403, 'SCIM provisioning is not included in this plan');
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await this.prisma.tenantScim.update({ where: { tenantId: row.tenantId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    req.scimTenantId = row.tenantId;
    return true;
  }
}
