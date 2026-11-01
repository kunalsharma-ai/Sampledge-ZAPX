/** Database access of the AI gateway: tenant AI policy and the usage ledger. */
import { Injectable } from '@nestjs/common';
import type { Prisma, TenantAiPolicy } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';

/** Outcomes that reached (or would have reached) the provider and count toward rate limits. */
export const BILLABLE_OUTCOMES = ['ok', 'error', 'refused'];

@Injectable()
export class AiUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  policy(tenantId: string): Promise<TenantAiPolicy | null> {
    return this.prisma.tenantAiPolicy.findUnique({ where: { tenantId } });
  }

  savePolicy(tenantId: string, data: Omit<Prisma.TenantAiPolicyUncheckedCreateInput, 'tenantId'>) {
    return this.prisma.tenantAiPolicy.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  }

  countSince(tenantId: string, since: Date) {
    return this.prisma.aiUsage.count({ where: { tenantId, createdAt: { gte: since }, outcome: { in: BILLABLE_OUTCOMES } } });
  }

  async costSince(tenantId: string, since: Date): Promise<bigint> {
    const r = await this.prisma.aiUsage.aggregate({ where: { tenantId, createdAt: { gte: since } }, _sum: { costMicroUsd: true } });
    return r._sum.costMicroUsd ?? 0n;
  }

  record(data: Prisma.AiUsageUncheckedCreateInput) {
    return this.prisma.aiUsage.create({ data });
  }

  summary(tenantId: string, since: Date) {
    return this.prisma.aiUsage.groupBy({
      by: ['task', 'model', 'outcome'],
      where: { tenantId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costMicroUsd: true },
    });
  }

  recent(tenantId: string, take = 50) {
    return this.prisma.aiUsage.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take });
  }
}
