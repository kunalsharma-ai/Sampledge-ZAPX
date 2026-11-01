import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';

const createSchema = z.object({ name: z.string().min(1).max(200), client: z.string().max(200).optional() });

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.project.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { surveys: true, vendors: true } } },
    });
  }

  @Post()
  @Roles(...CAN_EDIT)
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseBody(createSchema, body);
    const project = await this.prisma.project.create({ data: { ...input, tenantId: user.tenantId } });
    await this.audit.record(user, 'project.create', 'project', project.id, input);
    return project;
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        surveys: { orderBy: { createdAt: 'desc' } },
        vendors: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, code: true, redirectMode: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  @Get(':id/audit')
  async audit_(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, tenantId: user.tenantId }, include: { surveys: true, vendors: true } });
    if (!project) throw new NotFoundException('Project not found');
    const ids = [project.id, ...project.surveys.map((s) => s.id), ...project.vendors.map((v) => v.id)];
    return this.prisma.auditEvent.findMany({
      where: { tenantId: user.tenantId, entityId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
