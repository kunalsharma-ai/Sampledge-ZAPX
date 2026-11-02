import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService, isScoped } from '../common/access.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';

const createSchema = z.object({ name: z.string().min(1).max(200), client: z.string().max(200).optional() });

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.project.findMany({
      where: this.access.projects(user),
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { surveys: { where: { deletedAt: null } }, vendors: { where: { deletedAt: null } } } } },
    });
  }

  @Post()
  @Roles(...CAN_EDIT)
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseBody(createSchema, body);
    const project = await this.prisma.project.create({
      // A member who only sees assigned projects is added to the project they create.
      data: {
        ...input,
        tenantId: user.tenantId,
        ...(isScoped(user) ? { members: { create: { userId: user.id, tenantId: user.tenantId } } } : {}),
      },
    });
    await this.audit.record(user, 'project.create', 'project', project.id, input);
    return project;
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, ...this.access.projects(user) },
      include: {
        surveys: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        vendors: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, code: true, redirectMode: true, integration: true },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /**
   * Soft delete: the project, its surveys and vendors disappear from the studio and their links
   * stop working; responses, audit trail and logs are kept. Live surveys must be closed first.
   */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, ...this.access.projects(user) },
      include: { surveys: { where: { deletedAt: null } } },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.surveys.some((s) => s.status === 'LIVE'))
      throw new ConflictException('Close or pause the live surveys in this project first');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.survey.updateMany({ where: { projectId: id, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.vendor.updateMany({ where: { projectId: id, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.project.update({ where: { id }, data: { deletedAt: now } }),
    ]);
    await this.audit.record(user, 'project.delete', 'project', id, { surveys: project.surveys.length });
  }

  @Get(':id/audit')
  async audit_(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, ...this.access.projects(user), deletedAt: undefined },
      include: { surveys: true, vendors: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    const ids = [project.id, ...project.surveys.map((s) => s.id), ...project.vendors.map((v) => v.id)];
    return this.prisma.auditEvent.findMany({
      where: { tenantId: user.tenantId, entityId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
