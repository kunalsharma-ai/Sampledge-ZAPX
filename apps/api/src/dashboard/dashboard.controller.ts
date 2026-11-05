/**
 * Dashboard (home screen) summary: one read of the numbers the studio home shows, computed from the
 * organization's real data and limited to the projects the member can see. Test responses are left
 * out everywhere. Respondent rows are read with the tenant's row-level security setting applied.
 */
import { Controller, Get, Query } from '@nestjs/common';
import type { ResponseStatus, SurveyStatus } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AccessService } from '../common/access.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';

/** Days of daily activity in the trend chart. */
export const TREND_DAYS = 30;

const RESPONSE_STATUSES: ResponseStatus[] = [
  'IN_PROGRESS',
  'COMPLETE',
  'TERMINATE',
  'QUOTA_FULL',
  'QUALITY_FAIL',
  'SECURITY_REJECT',
  'DUPLICATE',
  'PARTIAL',
  'TECHNICAL_ERROR',
];
const SURVEY_STATUSES: SurveyStatus[] = ['DRAFT', 'LIVE', 'PAUSED', 'CLOSED'];

export interface DashboardSummary {
  generatedAt: string;
  projects: number;
  surveys: { total: number; byStatus: Record<SurveyStatus, number> };
  responses: {
    total: number;
    byStatus: Record<ResponseStatus, number>;
    byMode: { CAWI: number; CAPI: number; CATI: number };
    byDevice: { desktop: number; mobile: number; tablet: number; unknown: number };
    /** Completes a reviewer rejected (they stay COMPLETE in the data). */
    rejectedInReview: number;
    pendingReview: number;
    /** Distinct respondent countries, and the largest ones. */
    countries: number;
    topCountries: Array<{ code: string; count: number }>;
  };
  trend: Array<{ date: string; starts: number; completes: number }>;
  qa: { surveysTested: number; surveysPassing: number; runs: number };
  recentSurveys: Array<{
    id: string;
    name: string;
    status: SurveyStatus;
    projectId: string;
    projectName: string;
    updatedAt: string;
    responses: number;
    completes: number;
  }>;
}

const zeroes = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const day = (d: Date) => d.toISOString().slice(0, 10);

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** Responses per UTC day: started (startedAt) or completed (completedAt, completes only). */
  private async daily(tenantId: string, surveyIds: string[], since: Date, column: 'startedAt' | 'completedAt') {
    if (!surveyIds.length) return [];
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
      column === 'startedAt'
        ? this.prisma.$queryRaw<Array<{ d: string; n: number }>>`
            SELECT to_char("startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM "Response"
            WHERE "tenantId" = ${tenantId} AND "surveyId" = ANY(${surveyIds}) AND "isTest" = false AND "startedAt" >= ${since}
            GROUP BY 1`
        : this.prisma.$queryRaw<Array<{ d: string; n: number }>>`
            SELECT to_char("completedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM "Response"
            WHERE "tenantId" = ${tenantId} AND "surveyId" = ANY(${surveyIds}) AND "isTest" = false AND "status" = 'COMPLETE'
              AND "completedAt" >= ${since}
            GROUP BY 1`,
    ]);
    return rows;
  }

  @Get()
  @Roles('ADMIN', 'PROGRAMMER', 'VIEWER')
  async summary(@CurrentUser() user: AuthUser): Promise<DashboardSummary> {
    const surveyWhere = this.access.surveys(user);
    const [projects, surveys] = await Promise.all([
      this.prisma.project.count({ where: this.access.projects(user) }),
      this.prisma.survey.findMany({
        where: surveyWhere,
        select: { id: true, name: true, status: true, projectId: true, updatedAt: true, project: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    const ids = surveys.map((s) => s.id);
    const byStatus = zeroes(SURVEY_STATUSES);
    for (const s of surveys) byStatus[s.status]++;

    const db = this.prisma.forTenant(user.tenantId);
    const real = { tenantId: user.tenantId, surveyId: { in: ids }, isTest: false };
    const since = new Date(Date.now() - (TREND_DAYS - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);

    const [statusRows, modeRows, deviceRows, countryRows, rejected, pending, perSurvey, starts, completes, qaRuns] = await Promise.all([
      db.response.groupBy({ by: ['status'], where: real, _count: { _all: true } }),
      db.response.groupBy({ by: ['mode'], where: real, _count: { _all: true } }),
      db.response.groupBy({ by: ['device'], where: real, _count: { _all: true } }),
      db.response.groupBy({ by: ['country'], where: { ...real, country: { not: null } }, _count: { _all: true } }),
      db.response.count({ where: { ...real, status: 'COMPLETE', reviewState: 'REJECTED' } }),
      db.response.count({ where: { ...real, status: 'COMPLETE', reviewState: 'PENDING' } }),
      db.response.groupBy({
        by: ['surveyId', 'status'],
        where: { ...real, surveyId: { in: surveys.slice(0, 6).map((s) => s.id) } },
        _count: { _all: true },
      }),
      this.daily(user.tenantId, ids, since, 'startedAt'),
      this.daily(user.tenantId, ids, since, 'completedAt'),
      this.prisma.qaRun.findMany({
        where: { tenantId: user.tenantId, surveyId: { in: ids } },
        select: { surveyId: true, passed: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const responseStatus = zeroes(RESPONSE_STATUSES);
    for (const r of statusRows) responseStatus[r.status] = r._count._all;
    const byMode = { CAWI: 0, CAPI: 0, CATI: 0 };
    for (const r of modeRows) byMode[r.mode] = r._count._all;
    const byDevice = { desktop: 0, mobile: 0, tablet: 0, unknown: 0 };
    for (const r of deviceRows) {
      const k = r.device === 'desktop' || r.device === 'mobile' || r.device === 'tablet' ? r.device : 'unknown';
      byDevice[k] += r._count._all;
    }
    const countryList = countryRows
      .map((r) => ({ code: (r.country ?? '').toUpperCase(), count: r._count._all }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

    // Daily activity, oldest first, with empty days filled in.
    const trend = new Map<string, { date: string; starts: number; completes: number }>();
    for (let i = 0; i < TREND_DAYS; i++) {
      const d = day(new Date(since.getTime() + i * 86_400_000));
      trend.set(d, { date: d, starts: 0, completes: 0 });
    }
    for (const r of starts) {
      const t = trend.get(r.d);
      if (t) t.starts = r.n;
    }
    for (const r of completes) {
      const t = trend.get(r.d);
      if (t) t.completes = r.n;
    }

    // QA: the latest run of each survey decides whether it is passing.
    const latest = new Map<string, boolean>();
    for (const r of qaRuns) if (!latest.has(r.surveyId)) latest.set(r.surveyId, r.passed);

    const counts = new Map<string, { responses: number; completes: number }>();
    for (const r of perSurvey) {
      const c = counts.get(r.surveyId) ?? { responses: 0, completes: 0 };
      c.responses += r._count._all;
      if (r.status === 'COMPLETE') c.completes += r._count._all;
      counts.set(r.surveyId, c);
    }

    return {
      generatedAt: new Date().toISOString(),
      projects,
      surveys: { total: surveys.length, byStatus },
      responses: {
        total: statusRows.reduce((n, r) => n + r._count._all, 0),
        byStatus: responseStatus,
        byMode,
        byDevice,
        rejectedInReview: rejected,
        pendingReview: pending,
        countries: countryList.length,
        topCountries: countryList.slice(0, 8),
      },
      trend: [...trend.values()],
      qa: { surveysTested: latest.size, surveysPassing: [...latest.values()].filter(Boolean).length, runs: qaRuns.length },
      recentSurveys: surveys.slice(0, 6).map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        projectId: s.projectId,
        projectName: s.project.name,
        updatedAt: s.updatedAt.toISOString(),
        ...(counts.get(s.id) ?? { responses: 0, completes: 0 }),
      })),
    };
  }

  /** Top-bar search: projects and surveys the member can see whose name (or client) contains the text. */
  @Get('search')
  @Roles('ADMIN', 'PROGRAMMER', 'VIEWER')
  async search(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    const text = (q ?? '').trim().slice(0, 100);
    if (!text) return { projects: [], surveys: [] };
    const contains = { contains: text, mode: 'insensitive' as const };
    const [projects, surveys] = await Promise.all([
      this.prisma.project.findMany({
        where: { ...this.access.projects(user), OR: [{ name: contains }, { client: contains }] },
        select: { id: true, name: true, client: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.survey.findMany({
        where: { ...this.access.surveys(user), name: contains },
        select: { id: true, name: true, status: true, project: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
    ]);
    return {
      projects,
      surveys: surveys.map((s) => ({ id: s.id, name: s.name, status: s.status, projectName: s.project.name })),
    };
  }
}
