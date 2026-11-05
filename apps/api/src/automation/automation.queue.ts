/**
 * Blueprint phase 5: turns a survey event into automation runs, one per enabled rule listening to
 * it. Runs are worked by the background worker (AutomationService.pass), so an event never waits
 * for a rule's actions, and enqueue() never throws: an automation problem must not affect an
 * interview or a studio action.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { RULE_EVENTS } from './automation-rules';

/** Events caused by an automation's own action carry this, and never fire rules again (no loops). */
export const CAUSED_BY_AUTOMATION = 'automation';

@Injectable()
export class AutomationQueue {
  private readonly log = new Logger('Automation');

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(tenantId: string, event: string, data: Record<string, unknown>): Promise<number> {
    if (!(RULE_EVENTS as readonly string[]).includes(event) || data.causedBy === CAUSED_BY_AUTOMATION) return 0;
    try {
      const surveyId = typeof data.surveyId === 'string' ? data.surveyId : null;
      const rules = await this.prisma.automationRule.findMany({
        where: { tenantId, enabled: true, trigger: event, OR: [{ surveyId: null }, ...(surveyId ? [{ surveyId }] : [])] },
        select: { id: true, cooldownMinutes: true, lastFiredAt: true },
      });
      const now = Date.now();
      // A rule that fired within its cooldown does not queue more runs (the runner checks again, atomically).
      const due = rules.filter((r) => !r.cooldownMinutes || !r.lastFiredAt || now - r.lastFiredAt.getTime() >= r.cooldownMinutes * 60_000);
      if (!due.length) return 0;
      await this.prisma.automationRun.createMany({
        data: due.map((r) => ({ tenantId, ruleId: r.id, event, data: data as Prisma.InputJsonValue })),
      });
      return due.length;
    } catch (e) {
      this.log.error(`Could not queue automations for ${event}: ${(e as Error).message}`);
      return 0;
    }
  }
}
