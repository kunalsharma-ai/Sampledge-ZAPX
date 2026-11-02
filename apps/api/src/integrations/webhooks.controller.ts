import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import { config } from '../config';
import { SecretBox } from '../platform/secret-box';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { newWebhookSecret } from './webhook-signing';
import { WEBHOOK_EVENTS, WebhookService } from './webhook.service';

const url = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((u) => {
    const p = new URL(u).protocol;
    return p === 'https:' || (p === 'http:' && config().CALLBACK_ALLOW_PRIVATE_HOSTS);
  }, 'Use an https:// address');

const createSchema = z.object({
  url,
  description: z.string().trim().max(200).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
const updateSchema = z.object({
  url: url.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  active: z.boolean().optional(),
});

const SELECT = { id: true, url: true, description: true, events: true, active: true, createdAt: true, updatedAt: true } as const;

/** Outbound webhooks for the organization (Milestone 6). Admins only; see docs/modules/webhooks.md. */
@Controller()
@Roles('ADMIN')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly box: SecretBox,
    private readonly webhooks: WebhookService,
  ) {}

  private async own(user: AuthUser, id: string) {
    const w = await this.prisma.webhook.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!w) throw new NotFoundException('Webhook not found');
    return w;
  }

  @Get('webhook-events')
  events() {
    return WEBHOOK_EVENTS;
  }

  @Get('webhooks')
  async list(@CurrentUser() user: AuthUser) {
    const [hooks, counts] = await Promise.all([
      this.prisma.webhook.findMany({ where: { tenantId: user.tenantId }, select: SELECT, orderBy: { createdAt: 'asc' } }),
      this.prisma.webhookDelivery.groupBy({ by: ['webhookId', 'state'], where: { tenantId: user.tenantId }, _count: { _all: true } }),
    ]);
    return hooks.map((h) => ({
      ...h,
      counts: Object.fromEntries(counts.filter((c) => c.webhookId === h.id).map((c) => [c.state, c._count._all])),
    }));
  }

  @Post('webhooks')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseBody(createSchema, body);
    const secret = newWebhookSecret();
    const hook = await this.prisma.webhook.create({
      data: {
        tenantId: user.tenantId,
        url: input.url,
        description: input.description ?? null,
        events: input.events,
        secretEnc: this.box.seal(secret),
        createdById: user.id,
      },
      select: SELECT,
    });
    await this.audit.record(user, 'webhook.create', 'webhook', hook.id, { url: hook.url, events: hook.events });
    // The signing secret is shown once; rotate it to get a new one.
    return { ...hook, secret };
  }

  @Patch('webhooks/:id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const before = await this.own(user, id);
    const input = parseBody(updateSchema, body);
    const hook = await this.prisma.webhook.update({ where: { id }, data: input, select: SELECT });
    await this.audit.record(user, 'webhook.update', 'webhook', id, {
      before: { url: before.url, events: before.events, active: before.active },
      after: { url: hook.url, events: hook.events, active: hook.active },
    });
    return hook;
  }

  @Post('webhooks/:id/rotate-secret')
  async rotate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.own(user, id);
    const secret = newWebhookSecret();
    await this.prisma.webhook.update({ where: { id }, data: { secretEnc: this.box.seal(secret) } });
    await this.audit.record(user, 'webhook.rotate_secret', 'webhook', id);
    return { secret };
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const w = await this.own(user, id);
    await this.prisma.webhook.delete({ where: { id } });
    await this.audit.record(user, 'webhook.delete', 'webhook', id, { url: w.url });
  }

  @Post('webhooks/:id/test')
  async test(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.own(user, id);
    const d = await this.webhooks.test(user.tenantId, id);
    void this.webhooks.deliverDue().catch(() => undefined);
    return { deliveryId: d.id };
  }

  @Get('webhooks/:id/deliveries')
  async deliveries(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.own(user, id);
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        event: true,
        state: true,
        attempts: true,
        lastHttpStatus: true,
        lastError: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
  }

  @Post('webhook-deliveries/:id/redeliver')
  async redeliver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const d = await this.prisma.webhookDelivery.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!d) throw new NotFoundException('Delivery not found');
    const updated = await this.prisma.webhookDelivery.update({
      where: { id },
      data: { state: 'PENDING', nextAttemptAt: new Date(), attempts: 0, lastError: null },
      select: { id: true, state: true },
    });
    await this.audit.record(user, 'webhook.redeliver', 'webhook', d.webhookId, { deliveryId: id, previousState: d.state });
    void this.webhooks.deliverDue().catch(() => undefined);
    return updated;
  }
}
