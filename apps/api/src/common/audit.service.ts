import { Injectable } from '@nestjs/common';
import type { Prisma } from '@zapx/db';
import { PrismaService } from './prisma.service';
import type { AuthUser } from '../auth/auth.types';

/** Append-only audit trail. Every change to projects, surveys and vendors is recorded. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    actor: AuthUser | { tenantId: string; id?: string | null },
    action: string,
    entityType: string,
    entityId: string,
    data: Record<string, unknown> = {},
    tx?: Prisma.TransactionClient,
  ) {
    await (tx ?? this.prisma).auditEvent.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id ?? null,
        action,
        entityType,
        entityId,
        // Changes made with an organization API key say which key, next to the member it acts for.
        data: ('apiKeyId' in actor && actor.apiKeyId ? { ...data, viaApiKey: actor.apiKeyId } : data) as Prisma.InputJsonValue,
      },
    });
  }
}
