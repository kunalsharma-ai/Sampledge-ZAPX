import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CatiCase, Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { SecretBox } from '../platform/secret-box';
import { InterviewService } from '../interview/interview.service';
import { config } from '../config';
import type { AuthUser } from '../auth/auth.types';

/** How long an interviewer holds a case before it goes back to the queue. */
export const CASE_LEASE_MS = 30 * 60_000;

/** Call outcomes an interviewer records. "interviewed" is only accepted once the interview has ended. */
export const DISPOSITIONS = {
  no_answer: { label: 'No answer', retryAfterMs: 2 * 3_600_000 },
  busy: { label: 'Busy', retryAfterMs: 15 * 60_000 },
  answering_machine: { label: 'Answering machine', retryAfterMs: 4 * 3_600_000 },
  callback: { label: 'Call back later', retryAfterMs: null },
  refused: { label: 'Refused', retryAfterMs: null },
  wrong_number: { label: 'Wrong number', retryAfterMs: null },
  not_eligible: { label: 'Not eligible', retryAfterMs: null },
  interviewed: { label: 'Interviewed', retryAfterMs: null },
} as const;
export type Disposition = keyof typeof DISPOSITIONS;

const PHONE = /^\+?[0-9]{6,20}$/;
/** Keep a leading + and digits; drop spaces, dashes, dots and brackets. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const phone = (trimmed.startsWith('+') ? '+' : '') + trimmed.replace(/[^0-9]/g, '');
  return PHONE.test(phone) ? phone : null;
}
const CODE = /^[A-Za-z0-9_.-]{1,64}$/;

export interface CaseInput {
  code: string;
  phone: string;
  name?: string;
  data?: Record<string, string>;
}

/**
 * CATI call lists (Milestone 9). Programmers upload a sample; interviewers work a queue of due cases
 * (callbacks first), interview through the same runtime and engine, and record a disposition per
 * call. Retries, callbacks and maximum attempts decide when a case comes back.
 */
@Injectable()
export class CatiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly secrets: SecretBox,
    private readonly interviews: InterviewService,
  ) {}

  private async survey(user: AuthUser, surveyId: string) {
    const s = await this.prisma.survey.findFirst({ where: { id: surveyId, ...this.access.surveys(user) } });
    if (!s) throw new NotFoundException('Survey not found');
    return s;
  }

  // ---- Sample (programmers) ---------------------------------------------------------------------

  async addCases(user: AuthUser, surveyId: string, cases: CaseInput[], maxAttempts: number) {
    await this.survey(user, surveyId);
    const skipped: Array<{ row: number; code: string; reason: string }> = [];
    const seen = new Set<string>();
    const rows: Prisma.CatiCaseCreateManyInput[] = [];
    cases.forEach((c, i) => {
      const code = c.code?.trim() ?? '';
      const phone = normalizePhone(c.phone ?? '');
      if (!CODE.test(code))
        return skipped.push({ row: i + 1, code, reason: 'The id must be 1-64 letters, digits, dots, dashes or underscores' });
      if (!phone) return skipped.push({ row: i + 1, code, reason: 'The phone number is not valid' });
      if (seen.has(code)) return skipped.push({ row: i + 1, code, reason: 'This id appears twice in the file' });
      seen.add(code);
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.data ?? {}).slice(0, 30))
        if (/^[A-Za-z0-9_.-]{1,64}$/.test(k)) data[k] = String(v).slice(0, 500);
      rows.push({
        tenantId: user.tenantId,
        surveyId,
        code,
        phoneSealed: this.secrets.seal(phone),
        phoneHint: phone.slice(-3),
        name: c.name?.trim().slice(0, 120) || null,
        data,
        maxAttempts,
      });
    });
    const existing = new Set(
      (await this.prisma.catiCase.findMany({ where: { surveyId, code: { in: rows.map((r) => r.code) } }, select: { code: true } })).map(
        (r) => r.code,
      ),
    );
    const fresh = rows.filter((r) => {
      if (!existing.has(r.code)) return true;
      skipped.push({ row: cases.findIndex((c) => c.code?.trim() === r.code) + 1, code: r.code, reason: 'Already in the call list' });
      return false;
    });
    const { count } = await this.prisma.catiCase.createMany({ data: fresh, skipDuplicates: true });
    await this.audit.record(user, 'cati.cases_add', 'survey', surveyId, { added: count, skipped: skipped.length });
    return { added: count, skipped: skipped.sort((a, b) => a.row - b.row) };
  }

  async summary(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const now = new Date();
    const dayStart = new Date(now.getTime() - 24 * 3_600_000);
    const [byStatus, due, byDisposition, byInterviewer] = await Promise.all([
      this.prisma.catiCase.groupBy({ by: ['status'], where: { surveyId }, _count: true }),
      this.prisma.catiCase.count({
        where: {
          surveyId,
          OR: [
            { status: { in: ['PENDING', 'CALLBACK'] }, nextCallAt: { lte: now } },
            { status: 'IN_CALL', lockedUntil: { lt: now } },
          ],
        },
      }),
      this.prisma.catiCall.groupBy({ by: ['disposition'], where: { case: { surveyId } }, _count: true }),
      this.prisma.catiCall.groupBy({ by: ['interviewerId'], where: { case: { surveyId }, endedAt: { gte: dayStart } }, _count: true }),
    ]);
    const people = await this.prisma.user.findMany({
      where: { id: { in: byInterviewer.map((r) => r.interviewerId) }, tenantId: user.tenantId },
      select: { id: true, name: true },
    });
    return {
      cases: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      dueNow: due,
      dispositions: Object.fromEntries(byDisposition.map((r) => [r.disposition, r._count])),
      callsLast24h: byInterviewer.map((r) => ({
        interviewer: people.find((p) => p.id === r.interviewerId)?.name ?? 'Unknown',
        calls: r._count,
      })),
    };
  }

  async listCases(user: AuthUser, surveyId: string, status?: string) {
    await this.survey(user, surveyId);
    const where: Prisma.CatiCaseWhereInput = { surveyId };
    if (status) where.status = status as CatiCase['status'];
    const rows = await this.prisma.catiCase.findMany({ where, orderBy: [{ nextCallAt: 'asc' }], take: 200 });
    return rows.map((c) => this.present(c, false));
  }

  /** Put a closed case back in the queue (e.g. a wrong number was corrected elsewhere). */
  async reopen(user: AuthUser, caseId: string) {
    const c = await this.caseFor(user, caseId);
    if (c.status !== 'CLOSED') throw new ConflictException('Only closed cases can be reopened');
    if (!c.phoneSealed) throw new ConflictException('The phone number of this case was erased');
    const updated = await this.prisma.catiCase.update({
      where: { id: c.id },
      data: { status: 'PENDING', nextCallAt: new Date(), closedReason: null, maxAttempts: Math.max(c.maxAttempts, c.attempts + 1) },
    });
    await this.audit.record(user, 'cati.case_reopen', 'survey', c.surveyId, { caseId: c.id, code: c.code });
    return this.present(updated, false);
  }

  /** Privacy: erase phone numbers of finished cases (done or closed); the call history stays. */
  async erasePhones(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const { count } = await this.prisma.catiCase.updateMany({
      where: { surveyId, status: { in: ['DONE', 'CLOSED'] }, phoneSealed: { not: '' } },
      data: { phoneSealed: '', phoneHint: '' },
    });
    await this.audit.record(user, 'cati.phones_erase', 'survey', surveyId, { erased: count });
    return { erased: count };
  }

  private async caseFor(user: AuthUser, caseId: string) {
    const c = await this.prisma.catiCase.findFirst({ where: { id: caseId, tenantId: user.tenantId } });
    if (!c) throw new NotFoundException('Case not found');
    await this.survey(user, c.surveyId);
    return c;
  }

  private present(c: CatiCase, withPhone: boolean) {
    return {
      id: c.id,
      surveyId: c.surveyId,
      code: c.code,
      name: c.name,
      phone: withPhone && c.phoneSealed ? this.secrets.open(c.phoneSealed) : null,
      phoneHint: c.phoneHint ? `…${c.phoneHint}` : 'erased',
      data: c.data,
      status: c.status,
      attempts: c.attempts,
      maxAttempts: c.maxAttempts,
      nextCallAt: c.nextCallAt,
      lastDisposition: c.lastDisposition,
      closedReason: c.closedReason,
      responseId: c.responseId,
    };
  }

  // ---- Calling (interviewers) --------------------------------------------------------------------

  /** Interviewers call surveys they are assigned to; admins and programmers can call any survey they see. */
  private async callable(user: AuthUser, surveyId: string) {
    const s = await this.survey(user, surveyId);
    if (user.role === 'INTERVIEWER') {
      const a = await this.prisma.capiAssignment.findUnique({ where: { surveyId_interviewerId: { surveyId, interviewerId: user.id } } });
      if (!a?.active) throw new NotFoundException('Survey not found');
    }
    return s;
  }

  async mySurveys(user: AuthUser) {
    const surveys =
      user.role === 'INTERVIEWER'
        ? (
            await this.prisma.capiAssignment.findMany({
              where: { interviewerId: user.id, active: true, survey: { deletedAt: null, status: 'LIVE' } },
              include: { survey: true },
            })
          ).map((a) => a.survey)
        : await this.prisma.survey.findMany({ where: { ...this.access.surveys(user), status: 'LIVE', catiCases: { some: {} } } });
    const now = new Date();
    return Promise.all(
      surveys
        .filter((s) => s.tenantId === user.tenantId)
        .map(async (s) => ({
          id: s.id,
          name: s.name,
          dueNow: await this.prisma.catiCase.count({
            where: {
              surveyId: s.id,
              OR: [
                { status: { in: ['PENDING', 'CALLBACK'] }, nextCallAt: { lte: now } },
                { status: 'IN_CALL', lockedUntil: { lt: now } },
              ],
            },
          }),
          mine: await this.prisma.catiCase.count({
            where: { surveyId: s.id, status: 'IN_CALL', lockedById: user.id, lockedUntil: { gte: now } },
          }),
        })),
    );
  }

  /** Give the interviewer their open case, or claim the next due one (callbacks first). */
  async next(user: AuthUser, surveyId: string) {
    const survey = await this.callable(user, surveyId);
    if (survey.status !== 'LIVE') throw new ConflictException('This survey is not live');
    const open = await this.prisma.catiCase.findFirst({
      where: { surveyId, status: 'IN_CALL', lockedById: user.id, lockedUntil: { gte: new Date() } },
    });
    if (open) return this.opened(user, open);
    for (let i = 0; i < 10; i++) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE "CatiCase" SET status = 'IN_CALL', "lockedById" = ${user.id},
          "lockedUntil" = now() + make_interval(secs => ${CASE_LEASE_MS / 1000}), "updatedAt" = now()
        WHERE id = (
          SELECT id FROM "CatiCase"
          WHERE "surveyId" = ${surveyId} AND "phoneSealed" <> '' AND (
            (status IN ('PENDING', 'CALLBACK') AND "nextCallAt" <= now())
            OR (status = 'IN_CALL' AND "lockedUntil" < now()))
          ORDER BY (status = 'CALLBACK') DESC, "nextCallAt" ASC
          LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id`;
      if (!rows.length) return null;
      const c = await this.prisma.catiCase.findUniqueOrThrow({ where: { id: rows[0]!.id } });
      // An interview finished after its screen was abandoned: close the case and look further.
      if (c.responseId) {
        const r = await this.prisma.response.findUnique({ where: { id: c.responseId }, select: { status: true } });
        if (r && r.status !== 'IN_PROGRESS') {
          await this.finish(c, r.status.toLowerCase());
          continue;
        }
      }
      return this.opened(user, c);
    }
    return null;
  }

  private async opened(user: AuthUser, c: CatiCase) {
    // Revealing a phone number is personal data access, so it is audited.
    await this.audit.record(user, 'cati.case_open', 'survey', c.surveyId, { caseId: c.id, code: c.code });
    const calls = await this.prisma.catiCall.findMany({ where: { caseId: c.id }, orderBy: { endedAt: 'desc' }, take: 20 });
    return {
      ...this.present(c, true),
      lockedUntil: c.lockedUntil,
      calls: calls.map((k) => ({ disposition: k.disposition, note: k.note, callbackAt: k.callbackAt, endedAt: k.endedAt })),
    };
  }

  private async mine(user: AuthUser, caseId: string) {
    const c = await this.prisma.catiCase.findFirst({ where: { id: caseId, tenantId: user.tenantId } });
    if (!c) throw new NotFoundException('Case not found');
    await this.callable(user, c.surveyId);
    if (c.status !== 'IN_CALL' || c.lockedById !== user.id || !c.lockedUntil || c.lockedUntil < new Date()) {
      throw new ConflictException('This case is no longer open for you. Take the next case.');
    }
    return c;
  }

  /** Start (or resume) the interview: answers the runtime address the interviewer opens. */
  async interview(user: AuthUser, caseId: string) {
    const c = await this.mine(user, caseId);
    const entry = { ...(c.data as Record<string, string>), mode: 'cati' };
    const started = await this.interviews.startCati({ surveyId: c.surveyId, uid: c.code, interviewerId: user.id, entryParams: entry });
    await this.prisma.catiCase.update({
      where: { id: c.id },
      data: { responseId: started.responseId, lockedUntil: new Date(Date.now() + CASE_LEASE_MS) },
    });
    await this.audit.record(user, started.resumed ? 'cati.interview_resume' : 'cati.interview_start', 'survey', c.surveyId, {
      caseId: c.id,
      responseId: started.responseId,
    });
    return { runtimeUrl: `${config().RUNTIME_BASE_URL.replace(/\/$/, '')}/r/${started.token}`, responseId: started.responseId };
  }

  /** Record how the call ended and decide when (or whether) the case comes back. */
  async dispose(user: AuthUser, caseId: string, input: { disposition: Disposition; note?: string; callbackAt?: Date }, startedAt: Date) {
    const c = await this.mine(user, caseId);
    const response = c.responseId ? await this.prisma.response.findUnique({ where: { id: c.responseId }, select: { status: true } }) : null;
    const finished = response && response.status !== 'IN_PROGRESS';
    if (input.disposition === 'interviewed' && !finished) {
      throw new ConflictException('The interview has not ended. Finish it, or record a callback to resume it later.');
    }
    if (input.disposition === 'callback') {
      if (!input.callbackAt) throw new BadRequestException('Choose when to call back');
      if (input.callbackAt.getTime() < Date.now() - 60_000) throw new BadRequestException('The callback time is in the past');
    }
    const disposition = finished ? 'interviewed' : input.disposition;
    const attempts = c.attempts + 1;
    const rule = DISPOSITIONS[disposition];
    let data: Prisma.CatiCaseUpdateInput;
    if (finished) data = { status: 'DONE', closedReason: response.status.toLowerCase() };
    else if (disposition === 'callback') data = { status: 'CALLBACK', nextCallAt: input.callbackAt! };
    else if (rule.retryAfterMs === null) data = { status: 'CLOSED', closedReason: disposition };
    else if (attempts >= c.maxAttempts) data = { status: 'CLOSED', closedReason: 'max_attempts' };
    else data = { status: 'PENDING', nextCallAt: new Date(Date.now() + rule.retryAfterMs) };
    const [, updated] = await this.prisma.$transaction([
      this.prisma.catiCall.create({
        data: {
          tenantId: c.tenantId,
          caseId: c.id,
          interviewerId: user.id,
          disposition,
          note: input.note?.trim().slice(0, 1000) || null,
          callbackAt: disposition === 'callback' ? input.callbackAt! : null,
          startedAt,
        },
      }),
      this.prisma.catiCase.update({
        where: { id: c.id },
        data: { ...data, attempts, lastDisposition: disposition, lockedById: null, lockedUntil: null },
      }),
    ]);
    await this.audit.record(user, 'cati.call', 'survey', c.surveyId, { caseId: c.id, disposition, attempts });
    return this.present(updated, false);
  }

  /** Give the case back without a call (e.g. the interviewer has to stop). */
  async release(user: AuthUser, caseId: string) {
    const c = await this.mine(user, caseId);
    await this.prisma.catiCase.update({
      where: { id: c.id },
      data: { status: c.lastDisposition === 'callback' ? 'CALLBACK' : 'PENDING', lockedById: null, lockedUntil: null },
    });
  }

  private async finish(c: CatiCase, outcome: string) {
    await this.prisma.catiCase.update({
      where: { id: c.id },
      data: { status: 'DONE', closedReason: outcome, lastDisposition: 'interviewed', lockedById: null, lockedUntil: null },
    });
  }
}
