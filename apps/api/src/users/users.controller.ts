import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(10).max(200),
  role: z.enum(['ADMIN', 'PROGRAMMER', 'VIEWER', 'INTERVIEWER']),
  projectScope: z.enum(['ALL', 'ASSIGNED']).default('ALL'),
});

const updateSchema = z
  .object({
    role: z.enum(['ADMIN', 'PROGRAMMER', 'VIEWER', 'INTERVIEWER']).optional(),
    projectScope: z.enum(['ALL', 'ASSIGNED']).optional(),
  })
  .refine((v) => v.role || v.projectScope, 'Nothing to change');

const SELECT = { id: true, email: true, name: true, role: true, projectScope: true, createdAt: true } as const;

/** Admins always see every project; "assigned projects" only applies to programmers and viewers. */
const scopeFor = (role: string, scope: 'ALL' | 'ASSIGNED') => (role === 'PROGRAMMER' || role === 'VIEWER' ? scope : 'ALL');

/** Team members within the caller's tenant. Admins only. */
@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId },
      select: { ...SELECT, _count: { select: { projects: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseBody(createSchema, body);
    if (await this.prisma.user.findUnique({ where: { email: input.email } }))
      throw new ForbiddenException('An account with this email already exists');
    const created = await this.prisma.user.create({
      data: {
        tenantId: user.tenantId,
        email: input.email,
        name: input.name,
        role: input.role,
        projectScope: scopeFor(input.role, input.projectScope),
        passwordHash: await hash(input.password, 10),
      },
      select: SELECT,
    });
    await this.audit.record(user, 'user.create', 'user', created.id, {
      email: created.email,
      role: created.role,
      projectScope: created.projectScope,
    });
    return created;
  }

  /** Change a member's role or project access. Applies to their next request (the guard reads it fresh). */
  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(updateSchema, body);
    const before = await this.prisma.user.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!before) throw new NotFoundException('Member not found');
    if (id === user.id && input.role && input.role !== 'ADMIN') throw new BadRequestException('You cannot remove your own admin role');
    const role = input.role ?? before.role;
    const projectScope = scopeFor(role, input.projectScope ?? before.projectScope);
    const updated = await this.prisma.user.update({ where: { id }, data: { role, projectScope }, select: SELECT });
    await this.audit.record(user, 'user.update', 'user', id, {
      before: { role: before.role, projectScope: before.projectScope },
      after: { role, projectScope },
    });
    return updated;
  }
}
