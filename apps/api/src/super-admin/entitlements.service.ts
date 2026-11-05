import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { PrismaService } from '../common/prisma.service';
import { PlanCatalogService } from './plan-catalog.service';
import { resolveEntitlements, type Entitlements, type Surface } from './features';

/**
 * The features a signed-in member has right now, for the web CRM or the mobile app. Read fresh from
 * the database on every call, so a change by the super admin applies to the next request. Streams
 * (GET /api/me/entitlements/stream) are told at once about changes made in this process, and check
 * every few seconds for changes made by another process.
 */
@Injectable()
export class EntitlementsService {
  private readonly events = new EventEmitter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
  ) {
    this.events.setMaxListeners(0);
  }

  async forUser(userId: string, surface: Surface): Promise<Entitlements & { updatedAt: string }> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        superAdmin: true,
        mobileAccess: true,
        featureOverrides: true,
        tenant: { select: { plan: true, suspendedAt: true, featureOverrides: true } },
      },
    });
    const ent = resolveEntitlements({ surface, plan: this.plans.get(u.tenant.plan), tenant: u.tenant, user: u });
    return { ...ent, updatedAt: new Date().toISOString() };
  }

  /** Something that can change features was saved: wake every open stream in this process. */
  changed() {
    this.events.emit('changed');
  }

  onChange(fn: () => void) {
    this.events.on('changed', fn);
    return () => void this.events.off('changed', fn);
  }
}
