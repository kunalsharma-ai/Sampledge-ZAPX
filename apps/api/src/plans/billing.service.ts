/**
 * Billing through Stripe (Milestone 13). Off unless BILLING=stripe; then an admin can buy or change
 * a plan with Stripe Checkout and manage payment details in the Stripe customer portal, and Stripe's
 * signed webhooks keep the organization's plan in step with its subscription.
 *
 * ZAPX never sees card details. Plans and their limits stay in code (plans.ts); Stripe only says which
 * price an organization pays for (STRIPE_PRICES maps plan codes to Stripe price IDs). Every webhook is
 * checked against STRIPE_WEBHOOK_SECRET, applied once (BillingEvent), and answered by re-reading the
 * subscription from Stripe, so events that arrive late or out of order cannot set an old state.
 *
 * Status handling: active and trialing grant the paid plan; past_due keeps it while Stripe retries the
 * payment; canceled, unpaid, incomplete_expired (and a deleted subscription) fall back to
 * BILLING_FALLBACK_PLAN. Limits then apply as in docs/adr/0014: nothing already collected is lost.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { integration } from '../platform/integrations';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { PLANS, isPlanCode, type PlanCode } from './plans';

const SIGNATURE_TOLERANCE_S = 300;
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

export class StripeSignatureError extends Error {}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
  current_period_end?: number;
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** Verify a Stripe-Signature header (t=...,v1=...) over the raw request body. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, nowS = Date.now() / 1000) {
  if (!header) throw new StripeSignatureError('missing Stripe-Signature');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) throw new StripeSignatureError('malformed Stripe-Signature');
  if (Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S) throw new StripeSignatureError('timestamp outside the tolerance');
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  const ok = sigs.some((s) => {
    const b = Buffer.from(s, 'hex');
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
  if (!ok) throw new StripeSignatureError('signature does not match');
}

@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** On in Settings > Integrations (or BILLING=stripe until Stripe is saved there). */
  enabled() {
    return integration('stripe').enabled;
  }

  /** Plan code -> Stripe price ID, for the plans that can be bought. */
  private prices(): Partial<Record<PlanCode, string>> {
    try {
      return JSON.parse(integration('stripe').values.prices || '{}') as Partial<Record<PlanCode, string>>;
    } catch {
      return {};
    }
  }

  private planForPrice(priceId: string | undefined): PlanCode | null {
    for (const [plan, id] of Object.entries(this.prices())) if (id === priceId && isPlanCode(plan)) return plan;
    return null;
  }

  private async stripe<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
    const s = integration('stripe').values;
    if (!s.secretKey) throw new ServiceUnavailableException('Billing is not configured');
    const res = await fetch(`${config().STRIPE_API_BASE.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${s.secretKey}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(s.apiVersion ? { 'Stripe-Version': s.apiVersion } : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(15_000),
    }).catch((e: Error) => {
      throw new ServiceUnavailableException(`Could not reach Stripe (${e.message})`);
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) {
      this.log.warn(`Stripe ${method} ${path} answered ${res.status}: ${data.error?.message ?? ''}`);
      throw new ServiceUnavailableException(`Stripe refused the request: ${data.error?.message ?? `HTTP ${res.status}`}`);
    }
    return data;
  }

  async summary(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const prices = this.prices();
    return {
      enabled: this.enabled(),
      plan: t.plan,
      status: t.billingStatus,
      periodEnd: t.billingPeriodEnd,
      hasSubscription: !!t.billingSubscriptionId,
      canManage: this.enabled() && !!t.billingCustomerId,
      purchasable: this.enabled()
        ? (Object.keys(prices).filter(isPlanCode) as PlanCode[]).map((code) => ({
            code,
            name: PLANS[code].name,
            limits: PLANS[code].limits,
          }))
        : [],
    };
  }

  private studio(path: string) {
    return `${config().STUDIO_URL.replace(/\/$/, '')}${path}`;
  }

  /** A Stripe Checkout page for the plan; the plan changes when Stripe confirms the subscription. */
  async checkout(user: AuthUser, plan: string) {
    if (!this.enabled()) throw new NotFoundException('Billing is not turned on');
    const price = isPlanCode(plan) ? this.prices()[plan] : undefined;
    if (!price) throw new BadRequestException('This plan cannot be bought online');
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    if (t.billingSubscriptionId && t.billingStatus && PAID_STATUSES.has(t.billingStatus)) {
      throw new BadRequestException('This organization already has a subscription; change the plan in the billing portal');
    }
    const session = await this.stripe<{ id: string; url: string }>('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: user.tenantId,
      'metadata[tenantId]': user.tenantId,
      'subscription_data[metadata][tenantId]': user.tenantId,
      ...(t.billingCustomerId ? { customer: t.billingCustomerId } : { customer_email: user.email }),
      success_url: this.studio('/settings?billing=success'),
      cancel_url: this.studio('/settings?billing=cancelled'),
    });
    await this.audit.record(user, 'billing.checkout', 'tenant', user.tenantId, { plan, checkoutSession: session.id });
    return { url: session.url };
  }

  /** The Stripe customer portal: payment method, invoices, plan changes, cancellation. */
  async portal(user: AuthUser) {
    if (!this.enabled()) throw new NotFoundException('Billing is not turned on');
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    if (!t.billingCustomerId) throw new BadRequestException('Buy a plan first');
    const s = await this.stripe<{ url: string }>('POST', '/v1/billing_portal/sessions', {
      customer: t.billingCustomerId,
      return_url: this.studio('/settings'),
    });
    return { url: s.url };
  }

  /** A webhook from Stripe. Returns what was done, for the log and the tests. */
  async webhook(raw: Buffer | undefined, signature: string | undefined) {
    const secret = integration('stripe').values.webhookSecret;
    if (!this.enabled() || !secret) throw new NotFoundException();
    if (!raw) throw new StripeSignatureError('no body');
    verifyStripeSignature(raw, signature, secret);
    const event = JSON.parse(raw.toString('utf8')) as StripeEvent;
    if (!event?.id || !event.type) throw new BadRequestException('Not a Stripe event');
    const seen = await this.prisma.billingEvent.findUnique({ where: { id: event.id } });
    if (seen) return { event: event.id, result: 'duplicate' };

    const obj = event.data?.object ?? {};
    let tenantId: string | null = null;
    let result = 'ignored';
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
      tenantId = typeof obj.client_reference_id === 'string' ? obj.client_reference_id : null;
      const tenant = tenantId ? await this.prisma.tenant.findUnique({ where: { id: tenantId } }) : null;
      const owner =
        typeof obj.customer === 'string' ? await this.prisma.tenant.findUnique({ where: { billingCustomerId: obj.customer } }) : null;
      if (owner && tenant && owner.id !== tenant.id) {
        // One Stripe customer pays for one organization; this needs a person to look at it.
        this.log.error(`Stripe customer ${String(obj.customer)} already belongs to organization ${owner.id}, not ${tenant.id}`);
        result = 'customer belongs to another organization';
      } else if (tenant && typeof obj.customer === 'string' && typeof obj.subscription === 'string') {
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: { billingCustomerId: obj.customer, billingSubscriptionId: obj.subscription },
        });
        result = await this.sync(tenant.id, obj.subscription);
      } else result = 'unknown organization';
    } else if (event.type.startsWith('customer.subscription.') && typeof obj.id === 'string') {
      const sub = obj as unknown as StripeSubscription;
      const tenant =
        (sub.metadata?.tenantId && (await this.prisma.tenant.findUnique({ where: { id: sub.metadata.tenantId } }))) ||
        (await this.prisma.tenant.findUnique({ where: { billingCustomerId: sub.customer } }));
      if (tenant) {
        tenantId = tenant.id;
        // A tenant follows one subscription; events about an older one do not change the plan.
        if (!tenant.billingSubscriptionId || tenant.billingSubscriptionId === sub.id) {
          if (!tenant.billingSubscriptionId)
            await this.prisma.tenant.update({
              where: { id: tenant.id },
              data: { billingSubscriptionId: sub.id, billingCustomerId: sub.customer },
            });
          result = await this.sync(tenant.id, sub.id);
        } else result = 'other subscription';
      } else result = 'unknown organization';
    }
    await this.prisma.billingEvent.create({ data: { id: event.id, type: event.type, tenantId } });
    this.log.log(`Stripe ${event.type} ${event.id}: ${result}`);
    return { event: event.id, result };
  }

  /** Read the subscription from Stripe and set the plan it pays for. */
  private async sync(tenantId: string, subscriptionId: string): Promise<string> {
    const sub = await this.stripe<StripeSubscription>('GET', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
    const item = sub.items?.data?.[0];
    const paidPlan = this.planForPrice(item?.price?.id);
    const before = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const fallback = (integration('stripe').values.fallbackPlan || config().BILLING_FALLBACK_PLAN) as PlanCode;
    const plan = PAID_STATUSES.has(sub.status) ? (paidPlan ?? before.plan) : fallback;
    const periodEnd = sub.current_period_end ?? item?.current_period_end;
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { plan, billingStatus: sub.status, billingPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null },
    });
    if (plan !== before.plan || sub.status !== before.billingStatus) {
      await this.audit.record({ tenantId }, 'billing.plan_sync', 'tenant', tenantId, {
        from: before.plan,
        to: plan,
        status: sub.status,
        subscription: sub.id,
        ...(paidPlan || !PAID_STATUSES.has(sub.status)
          ? {}
          : { warning: `price ${item?.price?.id} is not one of the plan prices in Settings > Integrations` }),
      });
    }
    return `${sub.status}: plan ${before.plan} -> ${plan}`;
  }
}
