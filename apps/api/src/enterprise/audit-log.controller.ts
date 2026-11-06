import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import type { Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import { csvEscape } from '../exports/export.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';

const EXPORT_LIMIT = 50_000;

const filterSchema = z.object({
  action: z.string().max(80).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Cursor: the id of the last event of the previous page. */
  after: z.string().max(64).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});
type Filter = z.infer<typeof filterSchema>;

/**
 * The organization's audit trail (Milestone 6): every change to projects, surveys, vendors,
 * members, keys, webhooks, quality decisions and settings. Admins only. Read-only: nothing in
 * SampCode can edit or delete audit events.
 */
@Controller('audit')
@Roles('ADMIN')
export class AuditLogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private where(user: AuthUser, f: Filter): Prisma.AuditEventWhereInput {
    return {
      tenantId: user.tenantId,
      ...(f.action ? { action: f.action.endsWith('.') ? { startsWith: f.action } : f.action } : {}),
      ...(f.entityType ? { entityType: f.entityType } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(f.actorId ? { actorId: f.actorId } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    };
  }

  private async actors(tenantId: string, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    const users = unique.length
      ? await this.prisma.user.findMany({ where: { tenantId, id: { in: unique } }, select: { id: true, name: true, email: true } })
      : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    const f = parseBody(filterSchema, query);
    const rows = await this.prisma.auditEvent.findMany({
      where: this.where(user, f),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: f.take + 1,
      ...(f.after ? { cursor: { id: f.after }, skip: 1 } : {}),
    });
    const page = rows.slice(0, f.take);
    const actors = await this.actors(
      user.tenantId,
      page.map((r) => r.actorId),
    );
    return {
      items: page.map((r) => ({
        ...r,
        actor: r.actorId ? (actors.get(r.actorId) ?? { id: r.actorId, name: 'Removed member', email: null }) : null,
      })),
      next: rows.length > f.take ? page[page.length - 1]!.id : null,
    };
  }

  /** Distinct action names, for the filter. */
  @Get('actions')
  async actions(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.auditEvent.findMany({
      where: { tenantId: user.tenantId },
      distinct: ['action'],
      select: { action: true },
    });
    return rows.map((r) => r.action).sort();
  }

  @Get('export.csv')
  async export(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>, @Res() res: ExpressResponse) {
    const f = parseBody(filterSchema, query);
    const rows = await this.prisma.auditEvent.findMany({
      where: this.where(user, f),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_LIMIT,
    });
    const actors = await this.actors(
      user.tenantId,
      rows.map((r) => r.actorId),
    );
    await this.audit.record(user, 'audit.export', 'tenant', user.tenantId, { rows: rows.length, filter: { ...f, take: undefined } });
    const header = ['time', 'actor_email', 'actor_name', 'action', 'entity_type', 'entity_id', 'details'];
    const lines = rows.map((r) => {
      const a = r.actorId ? actors.get(r.actorId) : undefined;
      return [
        r.createdAt.toISOString(),
        a?.email ?? (r.actorId ? r.actorId : 'system'),
        a?.name ?? '',
        r.action,
        r.entityType,
        r.entityId,
        JSON.stringify(r.data),
      ]
        .map(csvEscape)
        .join(',');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zapx-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    if (rows.length === EXPORT_LIMIT) res.setHeader('X-Zapx-Truncated', String(EXPORT_LIMIT));
    res.send('﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n');
  }

  /** Security posture an admin should know about. */
  @Get('security')
  security() {
    return { rowLevelSecurity: this.prisma.rls };
  }
}
