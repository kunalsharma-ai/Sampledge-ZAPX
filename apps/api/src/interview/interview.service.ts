/**
 * Respondent interview flow (CAWI). The server is authoritative: it decides which page comes
 * next, validates every answer, applies terminations and quotas, and resolves vendor redirects.
 * The browser only renders what it is given.
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma, Response, Survey, Vendor } from '@zapx/db';
import {
  firstMatchingTermination,
  matchingQuotas,
  nextPageIndex,
  pageIsVisible,
  parseCached,
  progressPercent,
  references,
  renderQuestion,
  validatePage,
  conditionHolds,
  type FieldError,
} from '@zapx/logic-engine';
import type { Answers, OutcomeStatus, Question, SurveyDefinition } from '@zapx/survey-schema';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { RedirectService } from '../vendors/redirect.service';
import { isAllowedReturnUrl, verifySignedParams } from '../vendors/redirects';

const MAX_PARAMS = 30;
const MAX_PARAM_LENGTH = 2000;
const UID_PATTERN = /^[\x21-\x7e]{1,200}$/; // printable ASCII, no spaces
const RESERVED = new Set(['vid', 'uid', 'cc', 'sig', 'exp', 'test', 'tsig']);

export type PublicQuestion = Question & {
  renderedText: string;
  /** Present only when visibility depends on other answers on the same page. */
  condition?: string;
};

export type InterviewState =
  | {
      state: 'in_progress';
      token?: string;
      survey: { title: string; welcome?: string; showProgress: boolean; allowBack: boolean; language: string };
      page: { id: string; title?: string; questions: PublicQuestion[] };
      /** Answers already given for this page (when resuming or going back). */
      answers: Answers;
      /** Earlier answers referenced by same-page conditions. */
      context: Answers;
      progress: number;
      isFirstPage: boolean;
      isTest: boolean;
    }
  | { state: 'finished'; status: OutcomeStatus; message: string; redirectUrl: string | null; isTest: boolean }
  | { state: 'unavailable'; message: string };

export class InterviewValidationError extends UnprocessableEntityException {
  constructor(public readonly errors: FieldError[]) {
    super({ message: 'Some answers need attention', errors });
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const toEnum = (s: OutcomeStatus) => s.toUpperCase() as Response['status'];
const fromEnum = (s: Response['status']) => s.toLowerCase() as OutcomeStatus;

const MESSAGES: Record<OutcomeStatus, string> = {
  complete: 'Thank you, your answers have been recorded.',
  terminate: 'Thank you for your time. Unfortunately you do not qualify for this survey.',
  quota_full: 'Thank you for your interest. We already have enough responses from people like you.',
  quality_fail: 'Thank you for your time.',
  security_reject: 'This survey link is not valid.',
  duplicate: 'You have already taken part in this survey. Thank you.',
};

/** Test links are signed with the server secret so that only the studio can create them. */
export function testSignature(surveyId: string, uid: string): string {
  return createHmac('sha256', config().JWT_SECRET).update(`test:${surveyId}:${uid}`).digest('hex');
}

function validTestSignature(surveyId: string, uid: string, sig: string | undefined): boolean {
  if (!sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const a = Buffer.from(testSignature(surveyId, uid), 'hex');
  const b = Buffer.from(sig, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

class QuotaFull extends Error {
  constructor(public readonly quotaId: string) {
    super(quotaId);
  }
}

@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redirects: RedirectService,
  ) {}

  // ---- Entry --------------------------------------------------------------------------------

  async start(surveyId: string, rawQuery: Record<string, unknown>, userAgent?: string): Promise<InterviewState & { token?: string }> {
    const survey = await this.prisma.survey.findUnique({ where: { id: surveyId } });
    if (!survey || !survey.liveVersionId) return { state: 'unavailable', message: 'This survey is not available.' };

    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawQuery).slice(0, MAX_PARAMS)) {
      if (typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(k)) params[k] = v.slice(0, MAX_PARAM_LENGTH);
    }

    const isTest = params.test === '1' && !!params.uid && validTestSignature(surveyId, params.uid, params.tsig);

    let vendor: Vendor | null = null;
    if (params.vid) {
      vendor = await this.prisma.vendor.findUnique({ where: { projectId_code: { projectId: survey.projectId, code: params.vid } } });
      if (!vendor) return { state: 'unavailable', message: 'This survey link is not valid.' };
    } else if (!isTest) {
      return { state: 'unavailable', message: 'This survey link is not valid.' };
    }

    const uid = params.uid;
    if (!uid || !UID_PATTERN.test(uid)) {
      return this.rejectWithoutRecord(survey, vendor, uid ?? '', params, 'security_reject', 'missing_or_invalid_uid');
    }

    if (vendor?.requireSignedEntry && !isTest) {
      const check = verifySignedParams(params, vendor.secret);
      if (!check.ok) return this.rejectWithoutRecord(survey, vendor, uid, params, 'security_reject', check.reason);
    }

    if (survey.status !== 'LIVE' && !isTest) {
      return this.rejectWithoutRecord(survey, vendor, uid, params, 'quota_full', `survey_${survey.status.toLowerCase()}`);
    }

    // Dynamic return URL (only stored when it points at an allowed host).
    let returnUrl: string | null = null;
    if (vendor && vendor.redirectMode !== 'STATIC') {
      const candidate = params[vendor.dynamicParam];
      if (candidate && isAllowedReturnUrl(candidate, vendor.dynamicAllowedHosts)) returnUrl = candidate;
    }

    const entryParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (!RESERVED.has(k) && k !== vendor?.dynamicParam) entryParams[k] = v;
    }

    const existing = vendor
      ? await this.prisma.response.findUnique({ where: { surveyId_vendorId_uid: { surveyId, vendorId: vendor.id, uid } } })
      : await this.prisma.response.findFirst({ where: { surveyId, vendorId: null, uid } });
    if (existing) return this.reenter(existing, vendor);

    const version = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: survey.liveVersionId } });
    const def = version.definition as unknown as SurveyDefinition;
    const token = randomBytes(32).toString('base64url');
    try {
      const response = await this.prisma.response.create({
        data: {
          tenantId: survey.tenantId,
          surveyId,
          versionId: version.id,
          vendorId: vendor?.id ?? null,
          uid,
          country: params.cc?.slice(0, 10) ?? null,
          isTest,
          currentPage: nextPageIndex(def, {}, -1),
          entryParams: entryParams as Prisma.InputJsonValue,
          returnUrl,
          sessionTokenHash: hashToken(token),
          userAgent: userAgent?.slice(0, 500),
        },
      });
      return { ...(await this.stateOf(response, def, vendor)), token };
    } catch (e) {
      // Two simultaneous entries with the same UID: the second one is a re-entry.
      const again = vendor
        ? await this.prisma.response.findUnique({ where: { surveyId_vendorId_uid: { surveyId, vendorId: vendor.id, uid } } })
        : null;
      if (again) return this.reenter(again, vendor);
      throw e;
    }
  }

  /** Same UID again: resume an unfinished interview, otherwise it is a duplicate. */
  private async reenter(existing: Response, vendor: Vendor | null) {
    if (existing.status === 'IN_PROGRESS') {
      const token = randomBytes(32).toString('base64url');
      const updated = await this.prisma.response.update({ where: { id: existing.id }, data: { sessionTokenHash: hashToken(token) } });
      return { ...(await this.stateOf(updated, await this.definitionOf(updated), vendor)), token };
    }
    return this.outcomeState(vendor, existing, 'duplicate');
  }

  private async rejectWithoutRecord(
    survey: Survey,
    vendor: Vendor | null,
    uid: string,
    params: Record<string, string>,
    status: OutcomeStatus,
    reason: string,
  ): Promise<InterviewState> {
    await this.audit.record({ tenantId: survey.tenantId }, `interview.${status}`, 'survey', survey.id, {
      reason,
      vid: vendor?.code ?? null,
      uid: uid.slice(0, 200),
    });
    const pseudo = { id: 'none', uid, country: params.cc ?? null, returnUrl: null, entryParams: {}, isTest: false } as unknown as Response;
    return this.outcomeState(vendor, pseudo, status);
  }

  // ---- Session ------------------------------------------------------------------------------

  private async byToken(token: string): Promise<Response> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new NotFoundException('Session not found');
    const r = await this.prisma.response.findUnique({ where: { sessionTokenHash: hashToken(token) } });
    if (!r) throw new NotFoundException('Session not found');
    return r;
  }

  private async definitionOf(r: Response): Promise<SurveyDefinition> {
    const v = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: r.versionId } });
    return v.definition as unknown as SurveyDefinition;
  }

  private vendorOf(r: Response) {
    return r.vendorId ? this.prisma.vendor.findUnique({ where: { id: r.vendorId } }) : Promise.resolve(null);
  }

  async state(token: string): Promise<InterviewState> {
    const r = await this.byToken(token);
    return this.stateOf(r, await this.definitionOf(r), await this.vendorOf(r));
  }

  private async outcomeState(vendor: Vendor | null, r: Response, status: OutcomeStatus): Promise<InterviewState> {
    const redirect = vendor
      ? await this.redirects.resolve(
          vendor,
          {
            responseId: r.id,
            uid: r.uid,
            country: r.country,
            returnUrl: r.returnUrl,
            entryParams: (r.entryParams ?? {}) as Record<string, string>,
          },
          status,
        )
      : { url: null };
    return { state: 'finished', status, message: MESSAGES[status], redirectUrl: r.isTest ? null : redirect.url, isTest: r.isTest };
  }

  private async stateOf(r: Response, def: SurveyDefinition, vendor: Vendor | null): Promise<InterviewState> {
    if (r.status !== 'IN_PROGRESS' || r.currentPage < 0) {
      const status = fromEnum(r.status === 'IN_PROGRESS' ? 'COMPLETE' : r.status);
      const finished = await this.outcomeState(vendor, r, status);
      if (finished.state === 'finished' && status === 'complete' && def.thankYou) finished.message = def.thankYou;
      return finished;
    }
    const answers = (r.answers ?? {}) as Answers;
    const page = def.pages[r.currentPage]!;
    const samePage = new Set(page.questions.map((q) => q.id));
    const questions: PublicQuestion[] = [];
    const contextVars = new Set<string>();
    for (const q of page.questions) {
      let dynamic = false;
      if (q.condition) {
        const refs = references(parseCached(q.condition)).map((x) => x.name);
        dynamic = refs.some((n) => samePage.has(n));
        if (dynamic) refs.filter((n) => !samePage.has(n)).forEach((n) => contextVars.add(n));
        else if (!conditionHolds(q.condition, def, answers)) continue;
      }
      const rendered = renderQuestion(q, def, answers, r.id) as PublicQuestion;
      if (!dynamic) delete rendered.condition;
      questions.push(rendered);
    }
    const pageAnswers: Answers = {};
    for (const q of page.questions) if (answers[q.id] !== undefined) pageAnswers[q.id] = answers[q.id]!;
    const context: Answers = {};
    for (const v of contextVars) context[v] = answers[v] ?? null;
    const first = nextPageIndex(def, answers, -1);
    return {
      state: 'in_progress',
      survey: {
        title: def.title,
        welcome: r.currentPage === first ? def.welcome : undefined,
        showProgress: def.settings.showProgress,
        allowBack: def.settings.allowBack,
        language: def.language,
      },
      page: { id: page.id, title: page.title, questions },
      answers: pageAnswers,
      context,
      progress: progressPercent(def, r.currentPage),
      isFirstPage: r.currentPage === first,
      isTest: r.isTest,
    };
  }

  // ---- Answering ----------------------------------------------------------------------------

  async submit(token: string, pageId: string, submitted: Record<string, unknown>): Promise<InterviewState> {
    const r = await this.byToken(token);
    const def = await this.definitionOf(r);
    const vendor = await this.vendorOf(r);
    if (r.status !== 'IN_PROGRESS') return this.stateOf(r, def, vendor);
    const page = def.pages[r.currentPage];
    if (!page || page.id !== pageId) throw new ConflictException('This page is out of date. Reload to continue.');

    const prior = (r.answers ?? {}) as Answers;
    const result = validatePage(def, page, prior, submitted);
    if (!result.ok) throw new InterviewValidationError(result.errors);
    const answers: Answers = { ...prior, ...result.answers };

    const termination = firstMatchingTermination(def, answers);
    if (termination) return this.finish(r, def, vendor, answers, termination.status, termination.id);

    if (!r.isTest) {
      const full = await this.firstFullQuota(r.surveyId, def, answers);
      if (full) return this.finish(r, def, vendor, answers, 'quota_full', full);
    }

    const next = nextPageIndex(def, answers, r.currentPage);
    if (next === -1) return this.complete(r, def, vendor, answers);

    const moved = await this.prisma.response.updateMany({
      where: { id: r.id, status: 'IN_PROGRESS', currentPage: r.currentPage },
      data: { answers: answers as Prisma.InputJsonValue, currentPage: next },
    });
    if (moved.count === 0) throw new ConflictException('This page was already submitted. Reload to continue.');
    return this.stateOf({ ...r, answers: answers as Prisma.JsonValue, currentPage: next }, def, vendor);
  }

  async back(token: string): Promise<InterviewState> {
    const r = await this.byToken(token);
    const def = await this.definitionOf(r);
    const vendor = await this.vendorOf(r);
    if (r.status !== 'IN_PROGRESS' || !def.settings.allowBack) return this.stateOf(r, def, vendor);
    const answers = (r.answers ?? {}) as Answers;
    let prev = -1;
    for (let i = r.currentPage - 1; i >= 0; i--) {
      if (pageIsVisible(def.pages[i]!, def, answers)) {
        prev = i;
        break;
      }
    }
    if (prev === -1) return this.stateOf(r, def, vendor);
    await this.prisma.response.update({ where: { id: r.id }, data: { currentPage: prev } });
    return this.stateOf({ ...r, currentPage: prev }, def, vendor);
  }

  private async firstFullQuota(surveyId: string, def: SurveyDefinition, answers: Answers): Promise<string | null> {
    const matching = matchingQuotas(def, answers);
    if (matching.length === 0) return null;
    const counts = await this.prisma.quotaCount.findMany({ where: { surveyId, quotaId: { in: matching.map((q) => q.id) } } });
    for (const q of matching) {
      const count = counts.find((c) => c.quotaId === q.id)?.count ?? 0;
      if (count >= q.target) return q.id;
    }
    return null;
  }

  /** Complete the interview, counting it toward every matching quota atomically (no overfill). */
  private async complete(r: Response, def: SurveyDefinition, vendor: Vendor | null, answers: Answers): Promise<InterviewState> {
    const quotas = r.isTest ? [] : matchingQuotas(def, answers);
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const q of quotas) {
          const n = await tx.$executeRaw`UPDATE "QuotaCount" SET "count" = "count" + 1
            WHERE "surveyId" = ${r.surveyId} AND "quotaId" = ${q.id} AND "count" < ${q.target}`;
          if (n === 0) throw new QuotaFull(q.id);
        }
        const done = await tx.response.updateMany({
          where: { id: r.id, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETE', answers: answers as Prisma.InputJsonValue, currentPage: -1, completedAt: new Date() },
        });
        if (done.count === 0) throw new ConflictException('This interview has already finished.');
      });
    } catch (e) {
      if (e instanceof QuotaFull) return this.finish(r, def, vendor, answers, 'quota_full', e.quotaId);
      throw e;
    }
    const finished = await this.outcomeState(vendor, r, 'complete');
    if (finished.state === 'finished' && def.thankYou) finished.message = def.thankYou;
    return finished;
  }

  private async finish(
    r: Response,
    def: SurveyDefinition,
    vendor: Vendor | null,
    answers: Answers,
    status: OutcomeStatus,
    reason: string,
  ): Promise<InterviewState> {
    await this.prisma.response.updateMany({
      where: { id: r.id, status: 'IN_PROGRESS' },
      data: { status: toEnum(status), outcomeReason: reason, answers: answers as Prisma.InputJsonValue, currentPage: -1, completedAt: new Date() },
    });
    const fresh = await this.prisma.response.findUniqueOrThrow({ where: { id: r.id } });
    return this.stateOf(fresh, def, vendor);
  }
}
