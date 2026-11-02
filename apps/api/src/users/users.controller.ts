import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { PlanService } from '../plans/plan.service';

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
    /** Disable (true) or re-enable (false) the member. Disabled members cannot sign in. */
    disabled: z.boolean().optional(),
  })
  .refine((v) => v.role || v.projectScope || v.disabled !== undefined, 'Nothing to change');

export const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  projectScope: true,
  disabledAt: true,
  ssoSubject: true,
  scimExternalId: true,
  createdAt: true,
} as const;
const SELECT = USER_SELECT;

/** Admins always see every project; "assigned projects" only applies to programmers and viewers. */
export const scopeFor = (role: string, scope: 'ALL' | 'ASSIGNED') => (role === 'PROGRAMMER' || role === 'VIEWER' ? scope : 'ALL');

/** Team members within the caller's tenant. Admins only. */
@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
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
    await this.plans.assertSeat(user.tenantId, input.role);
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
    if (id === user.id && input.disabled) throw new BadRequestException('You cannot disable yourself');
    const role = input.role ?? before.role;
    const projectScope = scopeFor(role, input.projectScope ?? before.projectScope);
    const disabledAt = input.disabled === undefined ? before.disabledAt : input.disabled ? (before.disabledAt ?? new Date()) : null;
    // Re-enabling, or moving between interviewer and studio seats, takes a seat of the new kind.
    const kind = (r: string) => (r === 'INTERVIEWER' ? 'i' : 's');
    if (!disabledAt && (before.disabledAt || kind(role) !== kind(before.role))) await this.plans.assertSeat(user.tenantId, role);
    const updated = await this.prisma.user.update({ where: { id }, data: { role, projectScope, disabledAt }, select: SELECT });
    await this.audit.record(
      user,
      input.disabled === undefined ? 'user.update' : input.disabled ? 'user.disable' : 'user.enable',
      'user',
      id,
      {
        before: { role: before.role, projectScope: before.projectScope, disabled: !!before.disabledAt },
        after: { role, projectScope, disabled: !!disabledAt },
      },
    );
    return updated;
  }
}
