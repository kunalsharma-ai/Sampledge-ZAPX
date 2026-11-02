import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
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
});

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
      select: { id: true, email: true, name: true, role: true, createdAt: true },
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
        passwordHash: await hash(input.password, 10),
      },
      select: { id: true, email: true, name: true, role: true },
    });
    await this.audit.record(user, 'user.create', 'user', created.id, { email: created.email, role: created.role });
    return created;
  }
}
