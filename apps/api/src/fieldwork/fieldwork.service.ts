/**
 * Blueprint phase 3: supervising face-to-face fieldwork.
 *
 * - Back-checks: a share of each interviewer's completed CAPI interviews is drawn at random for a
 *   supervisor to verify (call the respondent, visit, or listen to the recording). A failed check
 *   rejects the interview through the normal quality review, so quotas and webhooks stay right.
 * - Supervisor dashboard: per-interviewer productivity and quality, exceptions, and a map of where
 *   interviews started. Everything is computed from stored interviews; nothing is estimated.
 * - Appeals: an interviewer asks for a rejected interview to be looked at again; a supervisor upholds
 *   the rejection or overturns it (the interview is reinstated if its quotas have room).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { BackCheckMethod, BackCheckState } from '@zapx/db';
import { capiSettingsOf, type SurveyDefinition } from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { QualityService } from '../quality/quality.service';
import type { AuthUser } from '../auth/auth.types';

/** Flags that point at how the interview was conducted (shown as exceptions to supervisors). */
export const FIELD_EXCEPTION_FLAGS = [
  'outside_geofence',
  'gps_missing',
  'gps_moved',
  'interviewer_overlap',
  'interrupted',
  'speeder_hard',
  'speeder',
] as const;

const DAY_MS = 24 * 3600 * 1000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

interface Flag {
  code: string;
  detail?: string;
}

@Injectable()
export class FieldworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly quality: QualityService,
  ) {}

  private async survey(user: AuthUser, surveyId: string) {
    const s = await this.prisma.survey.findFirst({ where: { id: surveyId, ...this.access.surveys(user) } });
    if (!s) throw new NotFoundException('Survey not found');
    return s;
  }

  // ---- Back-checks -------------------------------------------------------------------------------

  /**
   * Draw completed CAPI interviews that were not drawn before: `percent` of each interviewer's
   * interviews, and at least `minPerInterviewer` (when they have that many).
   */
  async sample(user: AuthUser, surveyId: string, input: { percent: number; minPerInterviewer: number; method: BackCheckMethod }) {
    await this.survey(user, surveyId);
    const drawn = await this.prisma.backCheck.findMany({ where: { surveyId }, select: { responseId: true } });
    const pool = await this.prisma.response.findMany({
      where: {
        surveyId,
        tenantId: user.tenantId,
        mode: 'CAPI',
        status: 'COMPLETE',
        isTest: false,
        id: { notIn: drawn.map((d) => d.responseId) },
      },
      select: { id: true, interviewerId: true },
    });
    const byInterviewer = new Map<string, string[]>();
    for (const r of pool) {
      const k = r.interviewerId ?? '';
      byInterviewer.set(k, [...(byInterviewer.get(k) ?? []), r.id]);
    }
    const chosen: Array<{ id: string; interviewerId: string | null }> = [];
    for (const [interviewerId, ids] of byInterviewer) {
      const n = Math.min(ids.length, Math.max(input.minPerInterviewer, Math.ceil((ids.length * input.percent) / 100)));
      // Fisher-Yates with a cryptographic source: interviewers cannot predict which interviews are checked.
      const a = [...ids];
      for (let i = a.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      for (const id of a.slice(0, n)) chosen.push({ id, interviewerId: interviewerId || null });
    }
    if (chosen.length)
      await this.prisma.backCheck.createMany({
        data: chosen.map((c) => ({
          tenantId: user.tenantId,
          surveyId,
          responseId: c.id,
          interviewerId: c.interviewerId,
          method: input.method,
          sampledById: user.id,
        })),
        skipDuplicates: true,
      });
    await this.audit.record(user, 'backcheck.sample', 'survey', surveyId, { ...input, drawn: chosen.length, eligible: pool.length });
    return { drawn: chosen.length, eligible: pool.length };
  }

  async backChecks(user: AuthUser, surveyId: string, state?: BackCheckState) {
    await this.survey(user, surveyId);
    const rows = await this.prisma.backCheck.findMany({
      where: { surveyId, tenantId: user.tenantId, ...(state ? { state } : {}) },
      orderBy: [{ state: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    const responses = await this.prisma.response.findMany({
      where: { id: { in: rows.map((r) => r.responseId) } },
      select: { id: true, uid: true, status: true, completedAt: true, durationMs: true, interviewer: { select: { name: true } } },
    });
    const people = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, id: { in: rows.map((r) => r.checkedById).filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    });
    const counts = await this.prisma.backCheck.groupBy({ by: ['state'], where: { surveyId }, _count: true });
    return {
      counts: Object.fromEntries(counts.map((c) => [c.state.toLowerCase(), c._count])),
      items: rows.map((b) => {
        const r = responses.find((x) => x.id === b.responseId);
        return {
          id: b.id,
          responseId: b.responseId,
          uid: r?.uid ?? null,
          interviewer: r?.interviewer?.name ?? null,
          completedAt: r?.completedAt ?? null,
          durationMs: r?.durationMs ?? null,
          responseStatus: r?.status.toLowerCase() ?? null,
          method: b.method.toLowerCase(),
          state: b.state.toLowerCase(),
          mismatches: b.mismatches,
          note: b.note,
          checkedBy: people.find((p) => p.id === b.checkedById)?.name ?? null,
          checkedAt: b.checkedAt,
        };
      }),
    };
  }

  /** Record a back-check. FAILED rejects the interview (quality review), so it stops counting. */
  async recordBackCheck(
    user: AuthUser,
    surveyId: string,
    checkId: string,
    input: { state: Exclude<BackCheckState, 'PENDING'>; method?: BackCheckMethod; mismatches: string[]; note?: string },
  ) {
    await this.survey(user, surveyId);
    const b = await this.prisma.backCheck.findFirst({ where: { id: checkId, surveyId, tenantId: user.tenantId } });
    if (!b) throw new NotFoundException('Back-check not found');
    if (input.state === 'FAILED' && !input.note?.trim()) throw new BadRequestException('Say why the back-check failed');
    await this.prisma.backCheck.update({
      where: { id: b.id },
      data: {
        state: input.state,
        ...(input.method ? { method: input.method } : {}),
        mismatches: input.mismatches,
        note: input.note ?? null,
        checkedById: user.id,
        checkedAt: new Date(),
      },
    });
    await this.audit.record(user, 'backcheck.record', 'response', b.responseId, { state: input.state, mismatches: input.mismatches });
    let rejected = false;
    if (input.state === 'FAILED') {
      const r = await this.quality.decide(user, surveyId, [b.responseId], 'reject', `Back-check failed: ${input.note}`);
      rejected = r.rejected === 1;
    }
    return { ok: true, rejected };
  }

  // ---- Supervisor dashboard -----------------------------------------------------------------------

  async supervisor(user: AuthUser, surveyId: string) {
    const survey = await this.survey(user, surveyId);
    const [rows, assignments, checks, appeals] = await Promise.all([
      this.prisma.response.findMany({
        where: { surveyId, tenantId: user.tenantId, mode: 'CAPI', isTest: false },
        select: {
          id: true,
          uid: true,
          status: true,
          interviewerId: true,
          startedAt: true,
          completedAt: true,
          syncedAt: true,
          durationMs: true,
          qualityScore: true,
          qualityFlags: true,
          reviewState: true,
          location: true,
          evidence: true,
        },
        orderBy: { completedAt: 'desc' },
        take: 20_000,
      }),
      this.prisma.capiAssignment.findMany({
        where: { surveyId },
        include: { interviewer: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.backCheck.groupBy({ by: ['interviewerId', 'state'], where: { surveyId }, _count: true }),
      this.prisma.qualityAppeal.count({ where: { surveyId, state: 'OPEN' } }),
    ]);
    const version = survey.liveVersionId ? await this.prisma.surveyVersion.findUnique({ where: { id: survey.liveVersionId } }) : null;
    const fences = version ? capiSettingsOf(version.definition as unknown as SurveyDefinition).geofences : [];
    const names = new Map(assignments.map((a) => [a.interviewerId, a.interviewer.name]));
    const missing = [...new Set(rows.map((r) => r.interviewerId).filter((x): x is string => !!x && !names.has(x)))];
    if (missing.length)
      for (const u of await this.prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } }))
        names.set(u.id, u.name);

    const flagsOf = (r: (typeof rows)[number]) => (Array.isArray(r.qualityFlags) ? (r.qualityFlags as unknown as Flag[]) : []);
    const interviewerIds = [...new Set([...assignments.map((a) => a.interviewerId), ...rows.map((r) => r.interviewerId ?? '')])].filter(
      Boolean,
    );
    const interviewers = interviewerIds.map((iid) => {
      const mine = rows.filter((r) => r.interviewerId === iid);
      const completes = mine.filter((r) => r.status === 'COMPLETE');
      const days = new Set(completes.map((r) => r.completedAt?.toISOString().slice(0, 10)).filter(Boolean));
      const scores = completes.map((r) => r.qualityScore).filter((x): x is number => x !== null);
      const interruptions = mine
        .map((r) => (r.evidence as { interruptions?: { count: number } } | null)?.interruptions?.count)
        .filter((x): x is number => typeof x === 'number');
      const bc = (s: BackCheckState) => checks.find((c) => c.interviewerId === iid && c.state === s)?._count ?? 0;
      const a = assignments.find((x) => x.interviewerId === iid);
      return {
        id: iid,
        name: names.get(iid) ?? 'Former interviewer',
        active: a?.active ?? false,
        target: a?.target ?? null,
        interviews: mine.length,
        completes: completes.length,
        partials: mine.filter((r) => r.status === 'PARTIAL').length,
        qualityFails: mine.filter((r) => r.status === 'QUALITY_FAIL').length,
        pendingReview: mine.filter((r) => r.reviewState === 'PENDING').length,
        medianLoiMs: median(completes.map((r) => r.durationMs).filter((x): x is number => x !== null)),
        completesPerDay: days.size ? Math.round((completes.length / days.size) * 10) / 10 : null,
        averageQuality: scores.length ? Math.round(scores.reduce((n, x) => n + x, 0) / scores.length) : null,
        exceptions: mine.filter((r) => flagsOf(r).some((f) => (FIELD_EXCEPTION_FLAGS as readonly string[]).includes(f.code))).length,
        outsideArea: mine.filter((r) => flagsOf(r).some((f) => f.code === 'outside_geofence')).length,
        interruptionsPerInterview: interruptions.length
          ? Math.round((interruptions.reduce((n, x) => n + x, 0) / interruptions.length) * 10) / 10
          : null,
        backChecks: { pending: bc('PENDING'), verified: bc('VERIFIED'), failed: bc('FAILED'), unreachable: bc('UNREACHABLE') },
        lastSyncAt: mine.reduce<Date | null>((m, r) => (r.syncedAt && (!m || r.syncedAt > m) ? r.syncedAt : m), null),
      };
    });

    const exceptions = rows
      .flatMap((r) => {
        const fl = flagsOf(r).filter((f) => (FIELD_EXCEPTION_FLAGS as readonly string[]).includes(f.code));
        return fl.length
          ? [
              {
                responseId: r.id,
                uid: r.uid,
                interviewer: names.get(r.interviewerId ?? '') ?? null,
                status: r.status.toLowerCase(),
                completedAt: r.completedAt,
                flags: fl.map((f) => ({ code: f.code, detail: f.detail ?? '' })),
              },
            ]
          : [];
      })
      .slice(0, 100);

    const points = rows
      .flatMap((r) => {
        const p = (r.location as { start?: { lat: number; lon: number } | null } | null)?.start;
        return p
          ? [{ lat: p.lat, lon: p.lon, status: r.status.toLowerCase(), interviewer: names.get(r.interviewerId ?? '') ?? null, uid: r.uid }]
          : [];
      })
      .slice(0, 5000);

    const since = Date.now() - 14 * DAY_MS;
    const daily = new Map<string, number>();
    for (let t = since; t <= Date.now(); t += DAY_MS) daily.set(new Date(t).toISOString().slice(0, 10), 0);
    for (const r of rows)
      if (r.status === 'COMPLETE' && r.completedAt && r.completedAt.getTime() >= since) {
        const d = r.completedAt.toISOString().slice(0, 10);
        daily.set(d, (daily.get(d) ?? 0) + 1);
      }

    return {
      totals: {
        interviews: rows.length,
        completes: rows.filter((r) => r.status === 'COMPLETE').length,
        target: assignments.reduce<number | null>((n, a) => (a.active && a.target ? (n ?? 0) + a.target : n), null),
        exceptions: exceptions.length,
        openAppeals: appeals,
        pendingBackChecks: checks.filter((c) => c.state === 'PENDING').reduce((n, c) => n + c._count, 0),
      },
      interviewers,
      exceptions,
      map: { points, fences },
      daily: [...daily.entries()].map(([day, completes]) => ({ day, completes })),
    };
  }

  // ---- Appeals ------------------------------------------------------------------------------------

  /** The interviewer's own interviews of the last 90 days that can be appealed, with any appeal. */
  async myInterviews(user: AuthUser) {
    const rows = await this.prisma.response.findMany({
      where: { interviewerId: user.id, tenantId: user.tenantId, mode: 'CAPI', syncedAt: { gte: new Date(Date.now() - 90 * DAY_MS) } },
      select: {
        id: true,
        clientId: true,
        status: true,
        outcomeReason: true,
        reviewState: true,
        reviewNote: true,
        completedAt: true,
        survey: { select: { name: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 300,
    });
    const appeals = await this.prisma.qualityAppeal.findMany({ where: { responseId: { in: rows.map((r) => r.id) } } });
    return rows.map((r) => {
      const a = appeals.find((x) => x.responseId === r.id);
      return {
        clientId: r.clientId,
        survey: r.survey.name,
        status: r.status.toLowerCase(),
        reason: r.outcomeReason,
        reviewNote: r.reviewNote,
        completedAt: r.completedAt,
        canAppeal: r.status === 'QUALITY_FAIL' && !a,
        appeal: a ? { state: a.state.toLowerCase(), message: a.message, decisionNote: a.decisionNote, decidedAt: a.decidedAt } : null,
      };
    });
  }

  async appeal(user: AuthUser, clientId: string, message: string) {
    const r = await this.prisma.response.findUnique({ where: { clientId } });
    if (!r || r.tenantId !== user.tenantId || r.interviewerId !== user.id) throw new NotFoundException('Interview not found');
    if (r.status !== 'QUALITY_FAIL') throw new BadRequestException('Only interviews rejected for quality can be appealed');
    if (await this.prisma.qualityAppeal.findUnique({ where: { responseId: r.id } }))
      throw new BadRequestException('This interview was already appealed');
    const a = await this.prisma.qualityAppeal.create({
      data: { tenantId: user.tenantId, surveyId: r.surveyId, responseId: r.id, raisedById: user.id, message },
    });
    await this.audit.record(user, 'appeal.raise', 'response', r.id, { uid: r.uid });
    return { id: a.id, state: 'open' };
  }

  async appeals(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const rows = await this.prisma.qualityAppeal.findMany({
      where: { surveyId, tenantId: user.tenantId },
      orderBy: [{ state: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    const responses = await this.prisma.response.findMany({
      where: { id: { in: rows.map((r) => r.responseId) } },
      select: { id: true, uid: true, status: true, outcomeReason: true, qualityScore: true, qualityFlags: true, reviewNote: true },
    });
    const people = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, id: { in: rows.flatMap((r) => [r.raisedById, r.decidedById ?? '']) } },
      select: { id: true, name: true },
    });
    return rows.map((a) => {
      const r = responses.find((x) => x.id === a.responseId);
      return {
        id: a.id,
        responseId: a.responseId,
        uid: r?.uid ?? null,
        responseStatus: r?.status.toLowerCase() ?? null,
        reason: r?.outcomeReason ?? null,
        qualityScore: r?.qualityScore ?? null,
        flags: (Array.isArray(r?.qualityFlags) ? (r!.qualityFlags as unknown as Flag[]) : []).map((f) => f.detail ?? f.code),
        reviewNote: r?.reviewNote ?? null,
        raisedBy: people.find((p) => p.id === a.raisedById)?.name ?? null,
        message: a.message,
        state: a.state.toLowerCase(),
        decisionNote: a.decisionNote,
        decidedBy: people.find((p) => p.id === a.decidedById)?.name ?? null,
        createdAt: a.createdAt,
      };
    });
  }

  /** Uphold the rejection, or overturn it: the interview is reinstated as a complete. */
  async decideAppeal(user: AuthUser, surveyId: string, appealId: string, decision: 'uphold' | 'overturn', note: string) {
    await this.survey(user, surveyId);
    const a = await this.prisma.qualityAppeal.findFirst({ where: { id: appealId, surveyId, tenantId: user.tenantId } });
    if (!a) throw new NotFoundException('Appeal not found');
    if (a.state !== 'OPEN') throw new BadRequestException('This appeal was already decided');
    if (decision === 'overturn') await this.quality.reinstate(user, surveyId, a.responseId, `Appeal upheld: ${note}`);
    await this.prisma.qualityAppeal.update({
      where: { id: a.id },
      data: { state: decision === 'overturn' ? 'OVERTURNED' : 'UPHELD', decisionNote: note, decidedById: user.id, decidedAt: new Date() },
    });
    await this.audit.record(user, `appeal.${decision}`, 'response', a.responseId, { note });
    return { state: decision === 'overturn' ? 'overturned' : 'upheld' };
  }
}
