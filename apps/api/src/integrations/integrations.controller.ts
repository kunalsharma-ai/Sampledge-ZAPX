import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import type { Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { layerSchema, readLayer } from './integration-config';
import { RedirectRepository } from './redirect.repository';
import { CallbackWorker } from './callback.worker';

/** Studio endpoints of the integration module: delivery log, replay, redirect log and defaults. */
@Controller()
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly repo: RedirectRepository,
    private readonly worker: CallbackWorker,
    private readonly access: AccessService,
  ) {}

  private async vendor(user: AuthUser, id: string) {
    const v = await this.prisma.vendor.findFirst({ where: { id, ...this.access.vendors(user) } });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  @Get('vendors/:id/callbacks')
  async callbacks(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.vendor(user, id);
    const [items, counts] = await Promise.all([this.repo.listCallbacks(user.tenantId, id), this.repo.callbackCounts(user.tenantId, id)]);
    return { items, counts: Object.fromEntries(counts.map((c) => [c.state, c._count._all])) };
  }

  @Post('callbacks/:id/replay')
  @Roles(...CAN_EDIT)
  async replay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const cb = await this.repo.findCallback(user.tenantId, id);
    if (!cb) throw new NotFoundException('Callback not found');
    const vendor = await this.vendor(user, cb.vendorId);
    const updated = await this.repo.replay(cb.id, vendor.callbackMaxAttempts);
    await this.audit.record(user, 'callback.replay', 'vendor', vendor.id, {
      callbackId: cb.id,
      previousState: cb.state,
      attempts: cb.attempts,
    });
    void this.worker.runOnce().catch(() => undefined);
    return updated;
  }

  @Get('vendors/:id/redirect-events')
  async events(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.vendor(user, id);
    return this.repo.listRedirectEvents(user.tenantId, id);
  }

  // ---- Redirect defaults: project and organization levels -------------------------------------

  @Get('projects/:id/redirect-defaults')
  async projectDefaults(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, ...this.access.projects(user) } });
    if (!p) throw new NotFoundException('Project not found');
    return readLayer(p.redirectDefaults);
  }

  @Put('projects/:id/redirect-defaults')
  @Roles(...CAN_EDIT)
  async saveProjectDefaults(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const p = await this.prisma.project.findFirst({ where: { id, ...this.access.projects(user) } });
    if (!p) throw new NotFoundException('Project not found');
    const layer = parseBody(layerSchema, body);
    await this.prisma.project.update({ where: { id }, data: { redirectDefaults: layer as Prisma.InputJsonValue } });
    await this.audit.record(user, 'project.redirect_defaults', 'project', id, { before: p.redirectDefaults, after: layer });
    return layer;
  }

  @Get('organization/redirect-defaults')
  async orgDefaults(@CurrentUser() user: AuthUser) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    return readLayer(t.redirectDefaults);
  }

  @Put('organization/redirect-defaults')
  async saveOrgDefaults(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only administrators can change organization defaults');
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    const layer = parseBody(layerSchema, body);
    await this.prisma.tenant.update({ where: { id: user.tenantId }, data: { redirectDefaults: layer as Prisma.InputJsonValue } });
    await this.audit.record(user, 'organization.redirect_defaults', 'tenant', user.tenantId, { before: t.redirectDefaults, after: layer });
    return layer;
  }
}
