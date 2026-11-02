/**
 * Outbound webhooks (Milestone 6): an outbox of signed JSON events, delivered by the same
 * background worker as vendor callbacks, with the same retry policy and SSRF protection.
 *
 * Payloads describe what happened (ids, statuses, scores), never respondents' answers. Test
 * responses never produce events. emit() never throws: a webhook problem must not affect an
 * interview or a studio action.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma, WebhookDelivery } from '@zapx/db';
import { DEFAULT_RETRY_POLICY, retryDelayMs, type RedirectStatus } from '@zapx/redirect-core';
import { PrismaService } from '../common/prisma.service';
import { SecretBox } from '../platform/secret-box';
import { HttpDelivery } from './http-delivery';
import { SIGNATURE_HEADER, signWebhook } from './webhook-signing';

export const WEBHOOK_EVENTS = ['response.finished', 'response.review_decided', 'survey.published', 'survey.status_changed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** Sent only by "Send test event"; not subscribable. */
export const TEST_EVENT = 'webhook.test';

const LEASE_MS = 120_000;
const BATCH = 25;

export interface WebhookRun {
  delivered: number;
  retrying: number;
  failed: number;
  dead: number;
}

@Injectable()
export class WebhookService {
  private readonly log = new Logger('Webhooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpDelivery,
    private readonly box: SecretBox,
  ) {}

  /** Queue an event for every active webhook of the tenant subscribed to it. */
  async emit(tenantId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<number> {
    try {
      const hooks = await this.prisma.webhook.findMany({ where: { tenantId, active: true, events: { has: event } }, select: { id: true } });
      if (hooks.length === 0) return 0;
      await this.prisma.webhookDelivery.createMany({ data: hooks.map((h) => this.row(tenantId, h.id, event, data)) });
      return hooks.length;
    } catch (e) {
      this.log.error(`Could not queue ${event}: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Queue a test event for one webhook, whatever it subscribes to. */
  async test(tenantId: string, webhookId: string) {
    return this.prisma.webhookDelivery.create({
      data: this.row(tenantId, webhookId, TEST_EVENT, { message: 'Test event from ZAPX. No action is needed.' }),
    });
  }

  private row(tenantId: string, webhookId: string, event: string, data: Record<string, unknown>): Prisma.WebhookDeliveryCreateManyInput {
    const id = randomUUID();
    return {
      id,
      tenantId,
      webhookId,
      event,
      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
      payload: { id, type: event, createdAt: new Date().toISOString(), data } as Prisma.InputJsonValue,
    };
  }

  /**
   * A response reached a final outcome (any mode). Reads the row fresh, so the score and review
   * state are the stored ones. A complete later rejected in review sends response.review_decided
   * instead of a second response.finished.
   */
  async responseFinished(responseId: string, status: RedirectStatus) {
    try {
      const r = await this.prisma.response.findUnique({
        where: { id: responseId },
        select: {
          id: true,
          tenantId: true,
          surveyId: true,
          uid: true,
          isTest: true,
          mode: true,
          qualityScore: true,
          reviewState: true,
          completedAt: true,
          survey: { select: { projectId: true } },
          vendor: { select: { code: true } },
        },
      });
      if (!r || r.isTest || r.reviewState === 'REJECTED') return;
      await this.emit(r.tenantId, 'response.finished', {
        responseId: r.id,
        surveyId: r.surveyId,
        projectId: r.survey.projectId,
        status,
        mode: r.mode,
        vendor: r.vendor?.code ?? null,
        uid: r.uid,
        qualityScore: r.qualityScore,
        reviewState: r.reviewState,
        finishedAt: (r.completedAt ?? new Date()).toISOString(),
      });
    } catch (e) {
      this.log.error(`Could not queue response.finished for ${responseId}: ${(e as Error).message}`);
    }
  }

  // ---- Delivery -------------------------------------------------------------------------------

  async deliverDue(): Promise<WebhookRun> {
    const run: WebhookRun = { delivered: 0, retrying: 0, failed: 0, dead: 0 };
    for (let round = 0; round < 4; round++) {
      const due = await this.prisma.$queryRaw<WebhookDelivery[]>`
        UPDATE "WebhookDelivery" SET "nextAttemptAt" = now() + (${LEASE_MS} * interval '1 millisecond'), "updatedAt" = now()
        WHERE id IN (
          SELECT id FROM "WebhookDelivery"
          WHERE state = 'PENDING' AND "nextAttemptAt" <= now()
          ORDER BY "nextAttemptAt" ASC
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *`;
      if (due.length === 0) break;
      for (const d of due) run[await this.deliver(d)]++;
    }
    return run;
  }

  private async deliver(d: WebhookDelivery): Promise<keyof WebhookRun> {
    const hook = await this.prisma.webhook.findUnique({ where: { id: d.webhookId } });
    const save = (state: WebhookDelivery['state'], httpStatus: number | null, error: string | null, next: Date | null = null) =>
      this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          state,
          attempts: { increment: 1 },
          lastHttpStatus: httpStatus,
          lastError: error,
          nextAttemptAt: next ?? undefined,
          deliveredAt: state === 'DELIVERED' ? new Date() : undefined,
        },
      });
    if (!hook || (!hook.active && d.event !== TEST_EVENT)) {
      await save('FAILED', null, hook ? 'webhook is paused' : 'webhook was deleted');
      return 'failed';
    }
    let secret: string;
    try {
      secret = this.box.open(hook.secretEnc);
    } catch {
      await save('FAILED', null, 'signing secret cannot be decrypted (was SECRETS_KEY changed?)');
      return 'failed';
    }
    const body = JSON.stringify(d.payload);
    const result = await this.http.send({
      method: 'POST',
      url: hook.url,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ZAPX-Webhooks/1',
        'X-Zapx-Event': d.event,
        'X-Zapx-Delivery': d.id,
        [SIGNATURE_HEADER]: signWebhook(secret, body, Math.floor(Date.now() / 1000)),
      },
      body,
    });
    const s = result.httpStatus;
    if (s !== null && s >= 200 && s < 300) {
      await save('DELIVERED', s, null);
      return 'delivered';
    }
    const transient = !result.permanent && (s === null || s === 408 || s === 429 || s >= 500);
    if (!transient) {
      await save('FAILED', s, result.error);
      return 'failed';
    }
    const attempts = d.attempts + 1;
    if (attempts >= d.maxAttempts) {
      await save('DEAD', s, result.error);
      return 'dead';
    }
    await save(
      'PENDING',
      s,
      result.error,
      new Date(Date.now() + retryDelayMs(attempts, { ...DEFAULT_RETRY_POLICY, maxAttempts: d.maxAttempts })),
    );
    return 'retrying';
  }
}
