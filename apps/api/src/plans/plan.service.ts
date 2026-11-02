import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { monthStart, planOf, type PlanLimits } from './plans';

type Seat = 'seats' | 'interviewers';

/** 402-style refusal with a stable code the studio can recognise. */
export class PlanLimitError extends HttpException {
  constructor(message: string, limit: keyof PlanLimits) {
    super({ message, code: 'PLAN_LIMIT', limit }, HttpStatus.FORBIDDEN);
  }
}

/** Reads an organization's plan and usage, and refuses actions that would go over a limit. */
@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  async plan(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { plan: true } });
    return { code: t.plan, ...planOf(t.plan) };
  }

  async usage(tenantId: string) {
    const active = { tenantId, disabledAt: null };
    const [seats, interviewers, liveSurveys, completesThisMonth] = await Promise.all([
      this.prisma.user.count({ where: { ...active, role: { not: 'INTERVIEWER' } } }),
      this.prisma.user.count({ where: { ...active, role: 'INTERVIEWER' } }),
      this.prisma.survey.count({ where: { tenantId, status: 'LIVE', deletedAt: null } }),
      this.completesThisMonth(tenantId),
    ]);
    return { seats, interviewers, liveSurveys, completesThisMonth };
  }

  completesThisMonth(tenantId: string) {
    return this.prisma.response.count({
      where: { tenantId, status: 'COMPLETE', isTest: false, completedAt: { gte: monthStart() } },
    });
  }

  async summary(tenantId: string) {
    const [plan, usage] = await Promise.all([this.plan(tenantId), this.usage(tenantId)]);
    return { plan: { code: plan.code, name: plan.name }, limits: plan.limits, usage, periodStart: monthStart().toISOString() };
  }

  /** Refuse adding (or re-enabling) a member when the plan's seats for that kind are taken. */
  async assertSeat(tenantId: string, role: string) {
    const kind: Seat = role === 'INTERVIEWER' ? 'interviewers' : 'seats';
    const { limits } = await this.plan(tenantId);
    const max = limits[kind];
    if (max === null) return;
    const used = await this.prisma.user.count({
      where: { tenantId, disabledAt: null, role: kind === 'interviewers' ? 'INTERVIEWER' : { not: 'INTERVIEWER' } },
    });
    if (used >= max) {
      const what = kind === 'interviewers' ? 'interviewers' : 'team members';
      throw new PlanLimitError(`Your plan allows ${max} active ${what}. Disable someone or change plan.`, kind);
    }
  }

  /** Refuse a survey going live when the plan's live surveys are taken. */
  async assertLiveSurvey(tenantId: string) {
    const { limits } = await this.plan(tenantId);
    if (limits.liveSurveys === null) return;
    const live = await this.prisma.survey.count({ where: { tenantId, status: 'LIVE', deletedAt: null } });
    if (live >= limits.liveSurveys) {
      throw new PlanLimitError(`Your plan allows ${limits.liveSurveys} live surveys at a time. Pause or close one first.`, 'liveSurveys');
    }
  }

  /** True when the organization has used this month's completes. New interviews are then refused. */
  async completesExhausted(tenantId: string) {
    const { limits } = await this.plan(tenantId);
    if (limits.completesPerMonth === null) return false;
    return (await this.completesThisMonth(tenantId)) >= limits.completesPerMonth;
  }

  async assertFeature(tenantId: string, feature: 'sso' | 'scim') {
    const plan = await this.plan(tenantId);
    if (!plan.limits[feature]) {
      const label = feature === 'sso' ? 'Single sign-on' : 'SCIM provisioning';
      throw new PlanLimitError(`${label} is not included in the ${plan.name} plan.`, feature);
    }
  }
}
