import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Prisma, SubscriptionPlan } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { PLANS, PLAN_CODES, isPlanCode, planOf, type PlanLimits } from '../plans/plans';
import { allFeatures } from './features';

export interface CatalogPlan {
  code: string;
  name: string;
  limits: PlanLimits;
  webFeatures: string[];
  mobileFeatures: string[];
}

const REFRESH_MS = 10_000;

/** Stored limits read leniently: a missing or bad value takes the most restrictive built-in plan's. */
export function readLimits(raw: unknown): PlanLimits {
  const base = PLANS.free.limits;
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof PlanLimits) => {
    const x = v[k];
    return x === null ? null : typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : (base[k] as number | null);
  };
  const bool = (k: 'sso' | 'scim') => (typeof v[k] === 'boolean' ? (v[k] as boolean) : base[k]);
  return {
    seats: num('seats'),
    interviewers: num('interviewers'),
    liveSurveys: num('liveSurveys'),
    completesPerMonth: num('completesPerMonth'),
    sso: bool('sso'),
    scim: bool('scim'),
  };
}

/**
 * Super admin: the subscription plans, kept in the database so the super admin can change them in
 * the console. Every process keeps a copy that it refreshes every 10 seconds and at once after a
 * change it made itself. On first start the built-in plans (plans.ts) are written with every feature.
 */
@Injectable()
export class PlanCatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Plans');
  private plans = new Map<string, CatalogPlan>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaults();
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async ensureDefaults() {
    try {
      if (await this.prisma.subscriptionPlan.count()) return;
      await this.prisma.subscriptionPlan.createMany({
        data: PLAN_CODES.map((code, i) => ({
          code,
          name: PLANS[code].name,
          limits: PLANS[code].limits as unknown as Prisma.InputJsonValue,
          webFeatures: allFeatures('web'),
          mobileFeatures: allFeatures('mobile'),
          sortOrder: i,
        })),
        skipDuplicates: true,
      });
    } catch (e) {
      this.log.warn(`Could not write the built-in plans: ${(e as Error).message}`);
    }
  }

  async refresh() {
    try {
      const rows = await this.prisma.subscriptionPlan.findMany();
      this.plans = new Map(rows.map((r) => [r.code, toCatalog(r)]));
    } catch (e) {
      this.log.warn(`Could not refresh plans: ${(e as Error).message}`);
    }
  }

  /**
   * The plan behind a code. A code with no saved plan keeps the built-in limits and every feature
   * when it is a built-in plan (so nothing breaks before the first refresh), and otherwise gets the
   * most restrictive limits and no features.
   */
  get(code: string): CatalogPlan {
    const saved = this.plans.get(code);
    if (saved) return saved;
    if (isPlanCode(code))
      return {
        code,
        name: PLANS[code].name,
        limits: PLANS[code].limits,
        webFeatures: allFeatures('web'),
        mobileFeatures: allFeatures('mobile'),
      };
    return { code, name: planOf(code).name, limits: PLANS.free.limits, webFeatures: [], mobileFeatures: [] };
  }

  exists(code: string) {
    return this.plans.has(code);
  }
}

function toCatalog(r: SubscriptionPlan): CatalogPlan {
  return { code: r.code, name: r.name, limits: readLimits(r.limits), webFeatures: r.webFeatures, mobileFeatures: r.mobileFeatures };
}
