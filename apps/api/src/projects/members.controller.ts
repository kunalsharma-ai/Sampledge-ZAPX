import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';

const addSchema = z.object({ userId: z.string().min(1).max(64) });

/**
 * Who can see a project (Milestone 6). Admins and members with "all projects" scope always can;
 * members with "assigned projects" scope only when they are added here.
 */
@Controller('projects/:id/members')
export class ProjectMembersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  private async project(user: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, ...this.access.projects(user) } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.project(user, id);
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        role: { not: 'INTERVIEWER' },
        OR: [{ role: 'ADMIN' }, { projectScope: 'ALL' }, { projects: { some: { projectId: id } } }],
      },
      select: { id: true, name: true, email: true, role: true, projectScope: true },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({ ...u, access: u.role === 'ADMIN' || u.projectScope === 'ALL' ? 'organization' : 'member' }));
  }

  @Post()
  @Roles('ADMIN')
  async add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    await this.project(user, id);
    const { userId } = parseBody(addSchema, body);
    const member = await this.prisma.user.findFirst({ where: { id: userId, tenantId: user.tenantId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'INTERVIEWER') throw new BadRequestException('Interviewers get surveys through interviewer assignments');
    if (member.role === 'ADMIN' || member.projectScope === 'ALL')
      throw new BadRequestException(`${member.name} already sees every project. Set their access to assigned projects first.`);
    await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId } },
      update: {},
      create: { projectId: id, userId, tenantId: user.tenantId, addedById: user.id },
    });
    await this.audit.record(user, 'project.member_add', 'project', id, { userId, email: member.email });
    return { ok: true };
  }

  @Delete(':userId')
  @Roles('ADMIN')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    await this.project(user, id);
    const gone = await this.prisma.projectMember.deleteMany({ where: { projectId: id, userId, tenantId: user.tenantId } });
    if (gone.count === 0) throw new NotFoundException('That member is not on this project');
    await this.audit.record(user, 'project.member_remove', 'project', id, { userId });
  }
}
