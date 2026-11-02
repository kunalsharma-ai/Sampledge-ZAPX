import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CatiCase, Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { SecretBox } from '../platform/secret-box';
import { InterviewService } from '../interview/interview.service';
import { config } from '../config';
import type { AuthUser } from '../auth/auth.types';
import { hhmm, isTimeZone, phoneHash, withinHours, type CallingHours } from './calling-rules';

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
  /** The respondent asked not to be called again: the number joins the organization's do-not-call list. */
  do_not_call: { label: 'Do not call again', retryAfterMs: null },
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
  timeZone?: string;
  data?: Record<string, string>;
}

/** Calling hours until a survey has its own: 09:00 to 21:00, Monday to Saturday, UTC. */
export const DEFAULT_HOURS: CallingHours = { timeZone: 'UTC', callFrom: 9 * 60, callUntil: 21 * 60, days: [1, 2, 3, 4, 5, 6] };

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
      const tz = c.timeZone?.trim();
      if (tz && !isTimeZone(tz)) return skipped.push({ row: i + 1, code, reason: `Unknown time zone ${tz.slice(0, 64)}` });
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
        phoneHash: phoneHash(user.tenantId, phone),
        timeZone: tz || null,
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
    const hours = await this.prisma.catiSettings.findUnique({ where: { surveyId } });
    const [dnc] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM "CatiCase" c
      WHERE c."surveyId" = ${surveyId} AND c.status IN ('PENDING', 'CALLBACK')
        AND EXISTS (SELECT 1 FROM "DoNotCall" d WHERE d."tenantId" = c."tenantId" AND d."phoneHash" = c."phoneHash")`;
    return {
      cases: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      dueNow: due,
      /** Waiting cases whose number is on the do-not-call list (they are never offered). */
      doNotCall: Number(dnc?.n ?? 0),
      callingHours: hours ? { timeZone: hours.timeZone, from: hhmm(hours.callFrom), until: hhmm(hours.callUntil), days: hours.days } : null,
      /** Whether it is inside calling hours now in the survey's own time zone (cases may have their own). */
      withinHoursNow: hours ? withinHours(hours, new Date()) : true,
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
    await this.backfillHashes(survey.tenantId, surveyId);
    for (let i = 0; i < 10; i++) {
      // Due cases, callbacks first. Numbers on the do-not-call list are never offered, and cases
      // other than agreed callbacks only inside the survey's calling hours in the respondent's zone.
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE "CatiCase" SET status = 'IN_CALL', "lockedById" = ${user.id},
          "lockedUntil" = now() + make_interval(secs => ${CASE_LEASE_MS / 1000}), "updatedAt" = now()
        WHERE id = (
          SELECT c.id FROM "CatiCase" c
          LEFT JOIN "CatiSettings" s ON s."surveyId" = c."surveyId"
          WHERE c."surveyId" = ${surveyId} AND c."phoneSealed" <> '' AND (
            (c.status IN ('PENDING', 'CALLBACK') AND c."nextCallAt" <= now())
            OR (c.status = 'IN_CALL' AND c."lockedUntil" < now()))
          AND NOT EXISTS (SELECT 1 FROM "DoNotCall" d WHERE d."tenantId" = c."tenantId" AND d."phoneHash" = c."phoneHash")
          AND (c.status = 'CALLBACK' OR s."surveyId" IS NULL OR (
            EXTRACT(ISODOW FROM now() AT TIME ZONE COALESCE(c."timeZone", s."timeZone"))::int = ANY(s.days)
            AND (EXTRACT(HOUR FROM now() AT TIME ZONE COALESCE(c."timeZone", s."timeZone")) * 60
              + EXTRACT(MINUTE FROM now() AT TIME ZONE COALESCE(c."timeZone", s."timeZone")))::int >= s."callFrom"
            AND (EXTRACT(HOUR FROM now() AT TIME ZONE COALESCE(c."timeZone", s."timeZone")) * 60
              + EXTRACT(MINUTE FROM now() AT TIME ZONE COALESCE(c."timeZone", s."timeZone")))::int < s."callUntil"))
          ORDER BY (c.status = 'CALLBACK') DESC, c."nextCallAt" ASC
          LIMIT 1 FOR UPDATE OF c SKIP LOCKED)
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

  /** Cases added before Milestone 18 have no number hash yet; compute it so the do-not-call list applies. */
  private async backfillHashes(tenantId: string, surveyId: string) {
    const rows = await this.prisma.catiCase.findMany({
      where: { surveyId, phoneHash: null, phoneSealed: { not: '' } },
      select: { id: true, phoneSealed: true },
      take: 1000,
    });
    for (const r of rows)
      await this.prisma.catiCase.update({
        where: { id: r.id },
        data: { phoneHash: phoneHash(tenantId, this.secrets.open(r.phoneSealed)) },
      });
  }

  // ---- Calling hours (Milestone 18) ------------------------------------------------------------

  async hours(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const s = await this.prisma.catiSettings.findUnique({ where: { surveyId } });
    return s
      ? { set: true, timeZone: s.timeZone, from: hhmm(s.callFrom), until: hhmm(s.callUntil), days: s.days }
      : {
          set: false,
          timeZone: DEFAULT_HOURS.timeZone,
          from: hhmm(DEFAULT_HOURS.callFrom),
          until: hhmm(DEFAULT_HOURS.callUntil),
          days: DEFAULT_HOURS.days,
        };
  }

  async setHours(user: AuthUser, surveyId: string, h: { timeZone: string; from: string; until: string; days: number[] } | null) {
    const survey = await this.survey(user, surveyId);
    if (!h) {
      await this.prisma.catiSettings.deleteMany({ where: { surveyId } });
      await this.audit.record(user, 'cati.hours_clear', 'survey', surveyId, {});
      return this.hours(user, surveyId);
    }
    if (!isTimeZone(h.timeZone)) throw new BadRequestException(`Unknown time zone ${h.timeZone}`);
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const callFrom = minutes(h.from);
    const callUntil = h.until === '24:00' ? 1440 : minutes(h.until);
    if (callFrom >= callUntil) throw new BadRequestException('Calls must start before they end (overnight windows are not supported)');
    const days = [...new Set(h.days)].sort((a, b) => a - b);
    const data = { timeZone: h.timeZone, callFrom, callUntil, days };
    await this.prisma.catiSettings.upsert({ where: { surveyId }, create: { surveyId, tenantId: survey.tenantId, ...data }, update: data });
    await this.audit.record(user, 'cati.hours_set', 'survey', surveyId, { ...data });
    return this.hours(user, surveyId);
  }

  // ---- Do-not-call list (Milestone 18) ---------------------------------------------------------

  async doNotCall(user: AuthUser) {
    const [count, latest] = await Promise.all([
      this.prisma.doNotCall.count({ where: { tenantId: user.tenantId } }),
      this.prisma.doNotCall.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return { count, latest: latest.map((d) => ({ id: d.id, hint: `…${d.hint}`, source: d.source, note: d.note, createdAt: d.createdAt })) };
  }

  /** Add numbers (one or a whole file). Numbers already on the list are left as they are. */
  async addDoNotCall(user: AuthUser, phones: string[], source: 'upload' | 'manual', note?: string) {
    const invalid: string[] = [];
    const rows = new Map<string, { hint: string }>();
    for (const raw of phones) {
      const p = normalizePhone(raw);
      if (!p) {
        if (raw.trim()) invalid.push(raw.slice(0, 40));
        continue;
      }
      rows.set(phoneHash(user.tenantId, p), { hint: p.slice(-3) });
    }
    const { count } = await this.prisma.doNotCall.createMany({
      data: [...rows].map(([hash, r]) => ({
        tenantId: user.tenantId,
        phoneHash: hash,
        hint: r.hint,
        source,
        note: note?.trim().slice(0, 200) || null,
        createdById: user.id,
      })),
      skipDuplicates: true,
    });
    await this.audit.record(user, 'cati.dnc_add', 'tenant', user.tenantId, { added: count, invalid: invalid.length, source });
    return { added: count, alreadyListed: rows.size - count, invalid: invalid.slice(0, 20), invalidCount: invalid.length };
  }

  async removeDoNotCall(user: AuthUser, id: string) {
    const { count } = await this.prisma.doNotCall.deleteMany({ where: { id, tenantId: user.tenantId } });
    if (!count) throw new NotFoundException('Not on the list');
    await this.audit.record(user, 'cati.dnc_remove', 'do_not_call', id, {});
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
    // The respondent asked not to be called again: every survey of the organization respects it.
    if (disposition === 'do_not_call' && c.phoneSealed) {
      const p = this.secrets.open(c.phoneSealed);
      await this.prisma.doNotCall.createMany({
        data: [
          { tenantId: c.tenantId, phoneHash: phoneHash(c.tenantId, p), hint: p.slice(-3), source: 'respondent', createdById: user.id },
        ],
        skipDuplicates: true,
      });
    }
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
