import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import { generateApiKey } from '../auth/api-keys';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(['PROGRAMMER', 'VIEWER']),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

const SELECT = {
  id: true,
  name: true,
  prefix: true,
  role: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

/**
 * Organization API keys (Milestone 6) for scripts and integrations. A key acts as the member who
 * created it, with at most the key's role (programmer or viewer, never admin), and sees the same
 * projects that member sees. Admins see and can revoke every key; programmers manage their own.
 */
@Controller('api-keys')
@Roles(...CAN_EDIT)
export class ApiKeysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private static humanOnly(user: AuthUser) {
    if (user.apiKeyId) throw new ForbiddenException('API keys cannot manage API keys. Sign in to the studio.');
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    ApiKeysController.humanOnly(user);
    return this.prisma.apiKey.findMany({
      where: { tenantId: user.tenantId, ...(user.role === 'ADMIN' ? {} : { createdById: user.id }) },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    ApiKeysController.humanOnly(user);
    const input = parseBody(createSchema, body);
    const { key, prefix, secretHash } = generateApiKey();
    const created = await this.prisma.apiKey.create({
      data: {
        tenantId: user.tenantId,
        createdById: user.id,
        name: input.name,
        role: input.role,
        prefix,
        secretHash,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
      },
      select: SELECT,
    });
    await this.audit.record(user, 'api_key.create', 'api_key', created.id, { name: created.name, prefix, role: created.role });
    // The only time the full key is returned. ZAPX keeps a hash of the secret, not the key.
    return { ...created, key };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    ApiKeysController.humanOnly(user);
    const k = await this.prisma.apiKey.findFirst({
      where: { id, tenantId: user.tenantId, ...(user.role === 'ADMIN' ? {} : { createdById: user.id }) },
    });
    if (!k) throw new NotFoundException('API key not found');
    if (!k.revokedAt) await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record(user, 'api_key.revoke', 'api_key', id, { name: k.name, prefix: k.prefix });
  }
}
