/**
 * Data quality: scores completes (online and CAPI) with @zapx/quality-core, keeps the evidence the
 * checks need (open-answer fingerprints, a keyed network hash), and runs the human review queue.
 *
 * A reviewer's rejection turns a complete into quality_fail: the quota place is released, the
 * vendor is told through the normal callback outbox, and the decision is audited. Rejection is
 * final, because the vendor may already have acted on it.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma, type Response } from '@zapx/db';
import { matchingQuotas } from '@zapx/logic-engine';
import {
  MIN_COMPLETES_FOR_MEDIAN,
  assessQuality,
  fieldwork,
  openEndFingerprints,
  qualityDecision,
  type FieldworkRow,
  type FieldworkStatus,
  type QualityDecision,
  type QualityResult,
} from '@zapx/quality-core';
import { allQuestions, qualitySettingsOf, type Answers, type SurveyDefinition } from '@zapx/survey-schema';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { WebhookService } from '../integrations/webhook.service';
import { RedirectService } from '../integrations/redirect.service';
import type { AuthUser } from '../auth/auth.types';

type Db = Prisma.TransactionClient | PrismaService;

export type ScoredFor = Pick<Response, 'id' | 'surveyId' | 'isTest' | 'ipHash'>;

export interface Assessment extends QualityResult {
  decision: QualityDecision;
}

/** Interview time on one page is capped, so a respondent who left the tab open is not a slow outlier forever. */
export const MAX_PAGE_MS = 30 * 60 * 1000;

export type ReviewFilter = 'pending' | 'accepted' | 'rejected' | 'flagged';

@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redirects: RedirectService,
    private readonly access: AccessService,
    private readonly webhooks: WebhookService,
  ) {}

  /**
   * Keyed hash of the respondent's network address, scoped to the organization. The address itself
   * is never stored, and the hash cannot be compared across organizations.
   */
  networkHash(tenantId: string, ip: string | undefined): string | null {
    if (!ip) return null;
    const key = createHmac('sha256', config().JWT_SECRET).update('zapx:network-hash').digest();
    return createHmac('sha256', key).update(`${tenantId}:${ip}`).digest('hex').slice(0, 32);
  }

  /** Score a complete before it is recorded. Test respondents are scored but never compared with real ones. */
  async assess(
    r: ScoredFor,
    def: SurveyDefinition,
    answers: Answers,
    durationMs: number | null,
    db: Db = this.prisma,
  ): Promise<Assessment> {
    const settings = qualitySettingsOf(def);
    if (!settings.enabled) return { score: 100, flags: [], decision: 'pass' };

    let medianMs: number | null = null;
    let duplicateOpenEnds = new Set<string>();
    let sameNetworkCompletes = 0;
    if (!r.isTest) {
      const [m] = await db.$queryRaw<Array<{ median: number | null; n: bigint }>>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS median, count(*) AS n
        FROM "Response"
        WHERE "surveyId" = ${r.surveyId} AND "status" = 'COMPLETE' AND "isTest" = false AND "durationMs" IS NOT NULL AND "id" <> ${r.id}`;
      if (m && Number(m.n) >= MIN_COMPLETES_FOR_MEDIAN && m.median !== null) medianMs = Number(m.median);

      const prints = openEndFingerprints(def, answers);
      if (prints.length) {
        const seen = await db.openEndFingerprint.findMany({
          where: { surveyId: r.surveyId, responseId: { not: r.id }, OR: prints.map((p) => ({ questionId: p.questionId, hash: p.hash })) },
          select: { questionId: true },
        });
        duplicateOpenEnds = new Set(seen.map((s) => s.questionId));
      }
      if (settings.sameNetwork && r.ipHash) {
        sameNetworkCompletes = await db.response.count({
          where: { surveyId: r.surveyId, ipHash: r.ipHash, status: 'COMPLETE', isTest: false, id: { not: r.id } },
        });
      }
    }
    const result = assessQuality({ def, answers, durationMs, medianMs, duplicateOpenEnds, sameNetworkCompletes });
    return { ...result, decision: qualityDecision(settings, result.score) };
  }

  /** Fields to store with a scored interview. No score when quality scoring is off for the survey. */
  fields(def: SurveyDefinition, a: Assessment, isTest: boolean) {
    return {
      qualityScore: qualitySettingsOf(def).enabled ? a.score : null,
      qualityFlags: a.flags as unknown as Prisma.InputJsonValue,
      reviewState: (a.decision === 'review' && !isTest ? 'PENDING' : 'NONE') as Response['reviewState'],
    };
  }

  /** Remember long open answers so later respondents giving the same text are flagged. */
  async rememberOpenEnds(r: ScoredFor, def: SurveyDefinition, answers: Answers, db: Db = this.prisma) {
    if (r.isTest) return;
    const prints = openEndFingerprints(def, answers);
    if (prints.length === 0) return;
    await db.openEndFingerprint.createMany({
      data: prints.map((p) => ({ surveyId: r.surveyId, questionId: p.questionId, hash: p.hash, responseId: r.id })),
      skipDuplicates: true,
    });
  }

  // ---- Review queue ---------------------------------------------------------------------------

  private async survey(user: AuthUser, surveyId: string) {
    const s = await this.prisma.survey.findFirst({ where: { id: surveyId, ...this.access.surveys(user) } });
    if (!s) throw new NotFoundException('Survey not found');
    return s;
  }

  async queue(user: AuthUser, surveyId: string, filter: ReviewFilter, take: number) {
    await this.survey(user, surveyId);
    const where: Prisma.ResponseWhereInput = { surveyId, isTest: false };
    if (filter === 'pending') Object.assign(where, { reviewState: 'PENDING', status: 'COMPLETE' });
    if (filter === 'accepted') where.reviewState = 'ACCEPTED';
    if (filter === 'rejected') where.reviewState = 'REJECTED';
    if (filter === 'flagged') Object.assign(where, { qualityScore: { lt: 100 } });
    const rows = await this.prisma.forTenant(user.tenantId).response.findMany({
      where,
      orderBy: [{ qualityScore: 'asc' }, { completedAt: 'asc' }],
      take,
      select: {
        id: true,
        uid: true,
        status: true,
        mode: true,
        outcomeReason: true,
        qualityScore: true,
        qualityFlags: true,
        reviewState: true,
        reviewNote: true,
        reviewedAt: true,
        durationMs: true,
        completedAt: true,
        answers: true,
        versionId: true,
        vendor: { select: { code: true } },
        interviewer: { select: { name: true } },
      },
    });
    const versions = await this.prisma.surveyVersion.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.versionId))] } } });
    const openIds = new Map(
      versions.map((v) => [
        v.id,
        allQuestions(v.definition as unknown as SurveyDefinition)
          .filter((q) => q.type === 'open')
          .map((q) => q.id),
      ]),
    );
    const counts = await this.prisma.response.groupBy({
      by: ['reviewState'],
      where: { surveyId, isTest: false, OR: [{ reviewState: { not: 'PENDING' } }, { status: 'COMPLETE' }] },
      _count: true,
    });
    return {
      counts: Object.fromEntries(counts.map((c) => [c.reviewState.toLowerCase(), c._count])),
      items: rows.map(({ answers, versionId, ...r }) => ({
        ...r,
        openEnds: (openIds.get(versionId) ?? [])
          .map((id) => ({ questionId: id, text: (answers as Answers)[id] }))
          .filter((o): o is { questionId: string; text: string } => typeof o.text === 'string' && o.text !== ''),
      })),
    };
  }

  async decide(user: AuthUser, surveyId: string, ids: string[], decision: 'accept' | 'reject', note: string | undefined) {
    await this.survey(user, surveyId);
    const result = { accepted: 0, rejected: 0, skipped: 0 };
    for (const id of ids) {
      const r = await this.prisma.forTenant(user.tenantId).response.findFirst({ where: { id, surveyId } });
      if (!r || r.status !== 'COMPLETE' || r.reviewState === 'REJECTED') {
        result.skipped++;
        continue;
      }
      if (decision === 'accept') {
        const n = await this.prisma.response.updateMany({
          where: { id, status: 'COMPLETE', reviewState: { not: 'REJECTED' } },
          data: { reviewState: 'ACCEPTED', reviewedAt: new Date(), reviewedById: user.id, reviewNote: note ?? null },
        });
        if (n.count === 1) {
          result.accepted++;
          await this.audit.record(user, 'quality.accept', 'response', id, { uid: r.uid, score: r.qualityScore, note: note ?? null });
          await this.decided(r, 'accepted');
        } else result.skipped++;
        continue;
      }
      const rejected = await this.prisma.$transaction(async (tx) => {
        const n = await tx.response.updateMany({
          where: { id, status: 'COMPLETE', reviewState: { not: 'REJECTED' } },
          data: {
            status: 'QUALITY_FAIL',
            outcomeReason: 'quality_review',
            reviewState: 'REJECTED',
            reviewedAt: new Date(),
            reviewedById: user.id,
            reviewNote: note ?? null,
          },
        });
        if (n.count === 0) return false;
        if (!r.isTest) {
          const version = await tx.surveyVersion.findUniqueOrThrow({ where: { id: r.versionId } });
          for (const q of matchingQuotas(version.definition as unknown as SurveyDefinition, (r.answers ?? {}) as Answers)) {
            await tx.$executeRaw`UPDATE "QuotaCount" SET "count" = "count" - 1 WHERE "surveyId" = ${surveyId} AND "quotaId" = ${q.id} AND "count" > 0`;
          }
        }
        await this.audit.record(user, 'quality.reject', 'response', id, { uid: r.uid, score: r.qualityScore, note: note ?? null }, tx);
        return true;
      });
      if (!rejected) {
        result.skipped++;
        continue;
      }
      result.rejected++;
      await this.redirects.outcomeRecorded(r, 'quality_fail');
      await this.decided(r, 'rejected');
    }
    return result;
  }

  private async decided(
    r: { id: string; tenantId: string; surveyId: string; uid: string; isTest: boolean; qualityScore: number | null },
    decision: 'accepted' | 'rejected',
  ) {
    if (r.isTest) return;
    const s = await this.prisma.survey.findUnique({ where: { id: r.surveyId }, select: { projectId: true } });
    await this.webhooks.emit(r.tenantId, 'response.review_decided', {
      responseId: r.id,
      surveyId: r.surveyId,
      projectId: s?.projectId ?? null,
      uid: r.uid,
      decision,
      status: decision === 'rejected' ? 'quality_fail' : 'complete',
      qualityScore: r.qualityScore,
    });
  }

  // ---- Fieldwork dashboard ----------------------------------------------------------------------

  async fieldwork(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const rows = await this.prisma.forTenant(user.tenantId).response.findMany({
      where: { surveyId, isTest: false },
      select: {
        status: true,
        mode: true,
        durationMs: true,
        qualityScore: true,
        reviewState: true,
        lastPageId: true,
        vendor: { select: { code: true } },
        interviewer: { select: { name: true } },
      },
    });
    const toRow = (r: (typeof rows)[number]): FieldworkRow => ({
      status: r.status.toLowerCase() as FieldworkStatus,
      vendor: r.vendor?.code ?? (r.interviewer ? `CAPI · ${r.interviewer.name}` : null),
      durationMs: r.durationMs,
      qualityScore: r.qualityScore,
      reviewState: r.reviewState.toLowerCase() as FieldworkRow['reviewState'],
      lastPageId: r.lastPageId,
    });
    const all = fieldwork(rows.map(toRow));
    return {
      ...all,
      modes: {
        cawi: rows.filter((r) => r.mode === 'CAWI').length,
        capi: rows.filter((r) => r.mode === 'CAPI').length,
        cati: rows.filter((r) => r.mode === 'CATI').length,
      },
    };
  }
}
