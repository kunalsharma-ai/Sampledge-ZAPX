/**
 * CAPI (face-to-face interviewing) on the server side: interviewer assignments, the survey package
 * the offline app downloads, and sync of interviews recorded offline.
 *
 * The device is never trusted. Every uploaded interview is replayed against the published version it
 * was recorded on (same logic engine), so the server decides the outcome, the quotas and the quality
 * score. Uploads are idempotent by the device-generated client id, so a retried sync never stores an
 * interview twice. Interviews are never thrown away: answers that do not fit the version are kept as
 * technical_error for a person to look at.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type ResponseStatus, type SurveyVersion } from '@zapx/db';
import { classifyDevice, matchingQuotas, replayInterview } from '@zapx/logic-engine';
import type { Answers, SurveyDefinition } from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { QualityService } from '../quality/quality.service';

export interface UploadedInterview {
  clientId: string;
  surveyId: string;
  versionId: string;
  answers: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  /** Time spent on pages, measured on the device. */
  durationMs: number;
  language?: string;
  /** The interviewer ended the interview before the last page. */
  endedEarly?: boolean;
}

export interface SyncResult {
  clientId: string;
  result: 'stored' | 'already_synced' | 'rejected';
  status?: string;
  reason?: string;
}

/** How far back a device clock may claim an interview started (older uploads are still kept, with the server time). */
const MAX_AGE_MS = 180 * 24 * 3600 * 1000;

class QuotaFullAtSync extends Error {
  constructor(public readonly quotaId: string) {
    super(quotaId);
  }
}

@Injectable()
export class CapiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quality: QualityService,
  ) {}

  // ---- Assignments (studio) ---------------------------------------------------------------------

  private async survey(user: AuthUser, surveyId: string) {
    const s = await this.prisma.survey.findFirst({ where: { id: surveyId, tenantId: user.tenantId, deletedAt: null } });
    if (!s) throw new NotFoundException('Survey not found');
    return s;
  }

  async assignments(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const [list, interviewers, done] = await Promise.all([
      this.prisma.capiAssignment.findMany({
        where: { surveyId },
        include: { interviewer: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { tenantId: user.tenantId, role: 'INTERVIEWER' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.response.groupBy({ by: ['interviewerId', 'status'], where: { surveyId, mode: 'CAPI' }, _count: true }),
    ]);
    return {
      interviewers,
      assignments: list.map((a) => ({
        ...a,
        synced: done.filter((d) => d.interviewerId === a.interviewerId).reduce((n, d) => n + d._count, 0),
        completes: done.find((d) => d.interviewerId === a.interviewerId && d.status === 'COMPLETE')?._count ?? 0,
      })),
    };
  }

  async assign(user: AuthUser, surveyId: string, interviewerId: string, target: number | null) {
    await this.survey(user, surveyId);
    const interviewer = await this.prisma.user.findFirst({ where: { id: interviewerId, tenantId: user.tenantId } });
    if (!interviewer) throw new NotFoundException('Interviewer not found');
    if (interviewer.role !== 'INTERVIEWER') throw new BadRequestException('Only team members with the interviewer role can be assigned');
    const a = await this.prisma.capiAssignment.upsert({
      where: { surveyId_interviewerId: { surveyId, interviewerId } },
      create: { tenantId: user.tenantId, surveyId, interviewerId, target },
      update: { active: true, target },
    });
    await this.audit.record(user, 'capi.assign', 'survey', surveyId, { interviewer: interviewer.email, target });
    return a;
  }

  async unassign(user: AuthUser, surveyId: string, assignmentId: string) {
    await this.survey(user, surveyId);
    const n = await this.prisma.capiAssignment.updateMany({ where: { id: assignmentId, surveyId }, data: { active: false } });
    if (n.count === 0) throw new NotFoundException('Assignment not found');
    await this.audit.record(user, 'capi.unassign', 'survey', surveyId, { assignmentId });
  }

  // ---- Interviewer app ---------------------------------------------------------------------------

  /** Everything the offline app needs: the live version of each assigned survey, with its presentation. */
  async package(user: AuthUser) {
    const list = await this.prisma.capiAssignment.findMany({
      where: { interviewerId: user.id, tenantId: user.tenantId, active: true, survey: { deletedAt: null, liveVersionId: { not: null } } },
      include: { survey: true },
      orderBy: { createdAt: 'asc' },
    });
    const versions = await this.prisma.surveyVersion.findMany({ where: { id: { in: list.map((a) => a.survey.liveVersionId!) } } });
    const mine = await this.prisma.response.groupBy({
      by: ['surveyId'],
      where: { interviewerId: user.id, status: 'COMPLETE', surveyId: { in: list.map((a) => a.surveyId) } },
      _count: true,
    });
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, name: true, email: true } });
    return {
      interviewer: me,
      generatedAt: new Date().toISOString(),
      surveys: list.map((a) => {
        const v = versions.find((x) => x.id === a.survey.liveVersionId)!;
        return {
          assignmentId: a.id,
          surveyId: a.surveyId,
          name: a.survey.name,
          /** Only LIVE surveys accept new interviews; the app still syncs ones already recorded. */
          status: a.survey.status,
          target: a.target,
          completesSynced: mine.find((m) => m.surveyId === a.surveyId)?._count ?? 0,
          version: { id: v.id, version: v.version, definition: v.definition, presentation: v.presentation },
        };
      }),
    };
  }

  async sync(user: AuthUser, deviceId: string, interviews: UploadedInterview[], userAgent: string | undefined): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    const versions = new Map<string, SurveyVersion | null>();
    for (const item of interviews) {
      try {
        results.push(await this.syncOne(user, deviceId, item, userAgent, versions));
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // Two uploads of the same interview raced: the other one stored it.
          results.push(await this.existing(user, item.clientId));
        } else throw e;
      }
    }
    await this.audit.record(user, 'capi.sync', 'device', deviceId, {
      uploaded: interviews.length,
      stored: results.filter((r) => r.result === 'stored').length,
      rejected: results.filter((r) => r.result === 'rejected').length,
    });
    return results;
  }

  private async existing(user: AuthUser, clientId: string): Promise<SyncResult> {
    const r = await this.prisma.response.findUnique({ where: { clientId } });
    if (!r || r.tenantId !== user.tenantId || r.interviewerId !== user.id)
      return { clientId, result: 'rejected', reason: 'This interview id belongs to another interviewer.' };
    return { clientId, result: 'already_synced', status: r.status.toLowerCase() };
  }

  private async syncOne(
    user: AuthUser,
    deviceId: string,
    item: UploadedInterview,
    userAgent: string | undefined,
    versions: Map<string, SurveyVersion | null>,
  ): Promise<SyncResult> {
    if (await this.prisma.response.findUnique({ where: { clientId: item.clientId }, select: { id: true } }))
      return this.existing(user, item.clientId);

    const assignment = await this.prisma.capiAssignment.findUnique({
      where: { surveyId_interviewerId: { surveyId: item.surveyId, interviewerId: user.id } },
      include: { survey: true },
    });
    // An assignment that was later deactivated still covers interviews already recorded offline.
    if (!assignment || assignment.tenantId !== user.tenantId || assignment.survey.deletedAt)
      return { clientId: item.clientId, result: 'rejected', reason: 'You are not assigned to this survey.' };

    if (!versions.has(item.versionId))
      versions.set(
        item.versionId,
        await this.prisma.surveyVersion.findFirst({ where: { id: item.versionId, surveyId: item.surveyId, status: { not: 'DRAFT' } } }),
      );
    const version = versions.get(item.versionId);
    if (!version) return { clientId: item.clientId, result: 'rejected', reason: 'Unknown survey version.' };
    const def = version.definition as unknown as SurveyDefinition;

    const now = Date.now();
    const finished = clampDate(item.finishedAt, now, now);
    const started = clampDate(item.startedAt, now, finished.getTime());
    const elapsed = finished.getTime() - started.getTime();
    const durationMs = Math.max(0, Math.min(Math.round(item.durationMs), elapsed || Math.round(item.durationMs)));

    const replay = replayInterview(def, item.answers);
    let status: ResponseStatus;
    let reason: string | null = null;
    let answers: Answers = replay.answers;
    const lastPageId: string | null = 'lastPageId' in replay ? replay.lastPageId : replay.pageId;
    switch (replay.outcome) {
      case 'invalid':
        status = 'TECHNICAL_ERROR';
        reason = `capi_invalid:${replay.pageId}`;
        answers = item.answers as Answers; // keep what the interviewer recorded, for a person to look at
        break;
      case 'incomplete':
        status = 'PARTIAL';
        reason = item.endedEarly ? 'capi_ended_early' : 'capi_incomplete';
        break;
      case 'terminate':
      case 'quality_fail':
        status = replay.outcome === 'terminate' ? 'TERMINATE' : 'QUALITY_FAIL';
        reason = replay.reason;
        break;
      case 'complete':
        status = 'COMPLETE';
        break;
    }

    const id = cuidLike();
    const base = {
      id,
      tenantId: user.tenantId,
      surveyId: item.surveyId,
      versionId: version.id,
      uid: item.clientId,
      clientId: item.clientId,
      mode: 'CAPI' as const,
      interviewerId: user.id,
      deviceId,
      syncedAt: new Date(),
      language: item.language?.slice(0, 35) ?? def.language,
      device: classifyDevice(userAgent, {}),
      userAgent: userAgent?.slice(0, 500),
      sessionTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      startedAt: started,
      completedAt: finished,
      currentPage: -1,
      durationMs,
      lastPageId,
    };

    let quality = {};
    if (status === 'COMPLETE') {
      const assessment = await this.quality.assess({ id, surveyId: item.surveyId, isTest: false, ipHash: null }, def, answers, durationMs);
      quality = this.quality.fields(def, assessment, false);
      if (assessment.decision === 'reject') {
        status = 'QUALITY_FAIL';
        reason = `quality:${[...new Set(assessment.flags.map((f) => f.code))].join(',')}`.slice(0, 200);
      }
    }

    const create = (s: ResponseStatus, why: string | null, tx: Prisma.TransactionClient) =>
      tx.response.create({ data: { ...base, ...quality, status: s, outcomeReason: why, answers: answers as Prisma.InputJsonValue } });

    try {
      await this.prisma.$transaction(async (tx) => {
        if (status === 'COMPLETE') {
          // Offline interviewers cannot see live quotas. The server never overfills: a complete that
          // arrives after its quota filled is kept, marked quota_full with the quota that was full.
          for (const q of matchingQuotas(def, answers)) {
            const n = await tx.$executeRaw`UPDATE "QuotaCount" SET "count" = "count" + 1
              WHERE "surveyId" = ${item.surveyId} AND "quotaId" = ${q.id} AND "count" < ${q.target}`;
            if (n === 0) throw new QuotaFullAtSync(q.id);
          }
        }
        await create(status, reason, tx);
      });
    } catch (e) {
      if (!(e instanceof QuotaFullAtSync)) throw e;
      status = 'QUOTA_FULL';
      reason = `quota_full_at_sync:${e.quotaId}`;
      quality = { ...quality, reviewState: 'NONE' };
      await this.prisma.$transaction((tx) => create(status, reason, tx));
    }
    if (status === 'COMPLETE')
      await this.quality.rememberOpenEnds({ id, surveyId: item.surveyId, isTest: false, ipHash: null }, def, answers);
    return { clientId: item.clientId, result: 'stored', status: status.toLowerCase(), ...(reason ? { reason } : {}) };
  }
}

function clampDate(iso: string, now: number, max: number): Date {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t > max || t < now - MAX_AGE_MS) return new Date(max);
  return new Date(t);
}

/** Response ids are generated here so the quality check can exclude the interview itself. */
function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}
