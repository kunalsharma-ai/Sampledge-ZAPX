/**
 * Respondent interview flow (CAWI). The server is authoritative: it decides which page comes
 * next, validates every answer, applies terminations and quotas, and resolves vendor redirects.
 * The browser only renders what it is given.
 */
import { ConflictException, HttpException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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
  chooseLanguage,
  classifyDevice,
  fillMessage,
  localizeDefinition,
  localizeMessages,
  type DeviceHints,
  type FieldError,
  type SystemMessages,
} from '@zapx/logic-engine';
import {
  defaultPresentation,
  parsePresentation,
  type Answers,
  type DeviceType,
  type OutcomeStatus,
  type Presentation,
  type Question,
  type SurveyDefinition,
  type Theme,
} from '@zapx/survey-schema';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { isAllowedReturnUrl, verifySignedParams } from '@zapx/redirect-core';
import { RedirectService } from '../integrations/redirect.service';
import { MAX_PAGE_MS, QualityService } from '../quality/quality.service';
import { PlanService } from '../plans/plan.service';

const MAX_PARAMS = 30;
const MAX_PARAM_LENGTH = 2000;
const UID_PATTERN = /^[\x21-\x7e]{1,200}$/; // printable ASCII, no spaces
const RESERVED = new Set(['vid', 'uid', 'cc', 'sig', 'exp', 'test', 'tsig', 'lang']);

export type PublicQuestion = Question & {
  renderedText: string;
  /** Present only when visibility depends on other answers on the same page. */
  condition?: string;
};

/** How the respondent screens look: theme, grid layout, button labels and the language menu. */
export interface Look {
  theme: Theme;
  gridOnMobile: 'cards' | 'scroll';
  language: string;
  languages: Array<{ tag: string; name: string }>;
  ui: Pick<
    SystemMessages,
    | 'next'
    | 'back'
    | 'saving'
    | 'language'
    | 'fixErrors'
    | 'rankUp'
    | 'rankDown'
    | 'sumRemaining'
    | 'playToEnd'
    | 'readAloud'
    | 'stopReading'
  >;
  /** Offer "Read aloud" on each question (the respondent's own device voices). */
  readAloud: boolean;
}

export type InterviewState =
  | {
      state: 'in_progress';
      token?: string;
      look: Look;
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
  | { state: 'finished'; status: OutcomeStatus; message: string; redirectUrl: string | null; isTest: boolean; look?: Look }
  | { state: 'unavailable'; message: string };

export class InterviewValidationError extends UnprocessableEntityException {
  constructor(public readonly errors: FieldError[]) {
    super({ message: 'Some answers need attention', errors });
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const toEnum = (s: OutcomeStatus) => s.toUpperCase() as Response['status'];
const fromEnum = (s: Response['status']) => s.toLowerCase() as OutcomeStatus;

const OUTCOME_MESSAGE: Record<OutcomeStatus, keyof SystemMessages> = {
  complete: 'outcomeComplete',
  terminate: 'outcomeTerminate',
  quota_full: 'outcomeQuotaFull',
  quality_fail: 'outcomeQualityFail',
  security_reject: 'outcomeSecurityReject',
  duplicate: 'outcomeDuplicate',
  partial: 'outcomePartial',
  technical_error: 'outcomeTechnicalError',
};

/** A survey version as one respondent sees it: localized definition, messages and look. */
interface Ctx {
  /** Definition in the respondent's language. Ids, codes and logic are identical to the source. */
  def: SurveyDefinition;
  presentation: Presentation;
  msg: SystemMessages;
  look: Look;
}

export function interviewContext(version: { definition: unknown; presentation: unknown }, requested: string | null | undefined): Ctx {
  const source = version.definition as SurveyDefinition;
  const parsed = parsePresentation(version.presentation);
  const presentation = parsed.ok ? parsed.presentation : defaultPresentation();
  const offered = presentation.languages.filter((l) => l.enabled);
  const lang = offered.find((l) => l.tag === requested);
  const msg = localizeMessages(presentation, lang);
  return {
    def: localizeDefinition(source, lang),
    presentation,
    msg,
    look: {
      theme: presentation.theme,
      gridOnMobile: presentation.devices.gridOnMobile,
      language: lang?.tag ?? source.language,
      languages: offered.length
        ? [
            { tag: source.language, name: presentation.sourceLanguageName ?? source.language },
            ...offered.map((l) => ({ tag: l.tag, name: l.name })),
          ]
        : [],
      ui: {
        next: msg.next,
        back: msg.back,
        saving: msg.saving,
        language: msg.language,
        fixErrors: msg.fixErrors,
        rankUp: msg.rankUp,
        rankDown: msg.rankDown,
        sumRemaining: msg.sumRemaining,
        playToEnd: msg.playToEnd,
        readAloud: msg.readAloud,
        stopReading: msg.stopReading,
      },
      readAloud: presentation.readAloud,
    },
  };
}

export interface EntryMeta {
  userAgent?: string;
  /** Network address, used only as a keyed hash for same-network quality checks. */
  ip?: string;
  acceptLanguage?: string;
  client?: DeviceHints;
}

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

interface Timing {
  durationMs: number;
  lastPageId: string;
}

class QuotaFull extends Error {
  constructor(public readonly quotaId: string) {
    super(quotaId);
  }
}

@Injectable()
export class InterviewService {
  private readonly log = new Logger('Interview');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redirects: RedirectService,
    private readonly quality: QualityService,
    private readonly plans: PlanService,
  ) {}

  // ---- Entry --------------------------------------------------------------------------------

  async start(surveyId: string, rawQuery: Record<string, unknown>, meta: EntryMeta = {}): Promise<InterviewState & { token?: string }> {
    const survey = await this.prisma.survey.findFirst({ where: { id: surveyId, deletedAt: null } });
    if (!survey || !survey.liveVersionId) return { state: 'unavailable', message: 'This survey is not available.' };

    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawQuery).slice(0, MAX_PARAMS)) {
      if (typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(k)) params[k] = v.slice(0, MAX_PARAM_LENGTH);
    }

    const version = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: survey.liveVersionId } });
    const sourceDef = version.definition as unknown as SurveyDefinition;
    const sourcePresentation = parsePresentation(version.presentation);
    const offered = sourcePresentation.ok ? sourcePresentation.presentation.languages.filter((l) => l.enabled).map((l) => l.tag) : [];
    const language = chooseLanguage(sourceDef.language, offered, params.lang, meta.acceptLanguage);
    const ctx = interviewContext(version, language);

    const isTest = params.test === '1' && !!params.uid && validTestSignature(surveyId, params.uid, params.tsig);

    let vendor: Vendor | null = null;
    if (params.vid) {
      vendor = await this.prisma.vendor.findUnique({ where: { projectId_code: { projectId: survey.projectId, code: params.vid } } });
      if (vendor?.deletedAt) vendor = null;
      if (!vendor) return { state: 'unavailable', message: ctx.msg.outcomeSecurityReject };
    } else if (!isTest) {
      return { state: 'unavailable', message: ctx.msg.outcomeSecurityReject };
    }

    const uid = params.uid;
    if (!uid || !UID_PATTERN.test(uid)) {
      return this.rejectWithoutRecord(survey, vendor, uid ?? '', params, 'security_reject', 'missing_or_invalid_uid', ctx);
    }

    if (vendor?.requireSignedEntry && !isTest) {
      const check = verifySignedParams(params, vendor.secret);
      if (!check.ok) return this.rejectWithoutRecord(survey, vendor, uid, params, 'security_reject', check.reason, ctx);
    }

    if (survey.status !== 'LIVE' && !isTest) {
      return this.rejectWithoutRecord(survey, vendor, uid, params, 'quota_full', `survey_${survey.status.toLowerCase()}`, ctx);
    }

    // Dynamic return URL (only stored when it points at an allowed host).
    let returnUrl: string | null = null;
    if (vendor && vendor.integration === 'DIRECT' && vendor.redirectMode !== 'STATIC') {
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

    // The organization has used this month's completes on its plan: new interviews are turned away
    // like a closed survey. Respondents resuming an interview (above) can still finish.
    if (!isTest && (await this.plans.completesExhausted(survey.tenantId))) {
      return this.rejectWithoutRecord(survey, vendor, uid, params, 'quota_full', 'plan_completes_exhausted', ctx);
    }

    // Device rules apply to new interviews; a respondent resuming elsewhere is not cut off.
    const device: DeviceType = classifyDevice(meta.userAgent, meta.client);
    if (!ctx.presentation.devices.allowed.includes(device)) {
      const preferred = ctx.presentation.devices.allowed[0]!;
      const deviceWord = { desktop: ctx.msg.deviceDesktop, tablet: ctx.msg.deviceTablet, mobile: ctx.msg.deviceMobile }[preferred];
      return this.rejectWithoutRecord(
        survey,
        vendor,
        uid,
        params,
        'terminate',
        `device_not_allowed:${device}`,
        ctx,
        fillMessage(ctx.msg.deviceNotAllowed, { device: deviceWord }),
      );
    }

    const def = sourceDef;
    const token = randomBytes(32).toString('base64url');
    const firstPage = nextPageIndex(def, {}, -1);
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
          currentPage: firstPage,
          lastPageId: def.pages[firstPage]?.id ?? null,
          pageShownAt: new Date(),
          durationMs: 0,
          ipHash: this.quality.networkHash(survey.tenantId, meta.ip),
          entryParams: entryParams as Prisma.InputJsonValue,
          returnUrl,
          sessionTokenHash: hashToken(token),
          userAgent: meta.userAgent?.slice(0, 500),
          language: ctx.look.language,
          device,
        },
      });
      return { ...(await this.stateOf(response, ctx, vendor)), token };
    } catch (e) {
      // Two simultaneous entries with the same UID: the second one is a re-entry.
      const again = vendor
        ? await this.prisma.response.findUnique({ where: { surveyId_vendorId_uid: { surveyId, vendorId: vendor.id, uid } } })
        : null;
      if (again) return this.reenter(again, vendor);
      throw e;
    }
  }

  /**
   * Start or resume a telephone (CATI) interview for a call-list case (Milestone 9). The interviewer
   * reads the questions from the same runtime respondents use; the response records mode CATI and
   * the interviewer. Resuming an unfinished interview issues a new session token.
   */
  async startCati(input: { surveyId: string; uid: string; interviewerId: string; entryParams: Record<string, string> }) {
    const survey = await this.prisma.survey.findFirst({ where: { id: input.surveyId, deletedAt: null } });
    if (!survey?.liveVersionId || survey.status !== 'LIVE') throw new ConflictException('This survey is not live');
    const existing = await this.prisma.response.findFirst({ where: { surveyId: survey.id, vendorId: null, uid: input.uid } });
    const token = randomBytes(32).toString('base64url');
    if (existing) {
      if (existing.status !== 'IN_PROGRESS') throw new ConflictException('This person has already been interviewed');
      const updated = await this.prisma.response.update({
        where: { id: existing.id },
        data: { sessionTokenHash: hashToken(token), pageShownAt: new Date(), interviewerId: input.interviewerId },
      });
      return { token, responseId: updated.id, resumed: true };
    }
    if (await this.plans.completesExhausted(survey.tenantId)) {
      throw new ConflictException("Your organization has used this month's completes on its plan");
    }
    const version = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: survey.liveVersionId } });
    const def = version.definition as unknown as SurveyDefinition;
    const ctx = interviewContext(version, def.language);
    const firstPage = nextPageIndex(def, {}, -1);
    const response = await this.prisma.response.create({
      data: {
        tenantId: survey.tenantId,
        surveyId: survey.id,
        versionId: version.id,
        uid: input.uid,
        mode: 'CATI',
        interviewerId: input.interviewerId,
        currentPage: firstPage,
        lastPageId: def.pages[firstPage]?.id ?? null,
        pageShownAt: new Date(),
        durationMs: 0,
        entryParams: input.entryParams as Prisma.InputJsonValue,
        sessionTokenHash: hashToken(token),
        language: ctx.look.language,
        device: 'desktop',
      },
    });
    return { token, responseId: response.id, resumed: false };
  }

  /** Same UID again: resume an unfinished interview, otherwise it is a duplicate. */
  private async reenter(existing: Response, vendor: Vendor | null) {
    if (existing.status === 'IN_PROGRESS') {
      const token = randomBytes(32).toString('base64url');
      // Time away is not interview time: the clock restarts when the page is shown again.
      const updated = await this.prisma.response.update({
        where: { id: existing.id },
        data: { sessionTokenHash: hashToken(token), pageShownAt: new Date() },
      });
      return { ...(await this.stateOf(updated, await this.ctxOf(updated), vendor)), token };
    }
    return this.outcomeState(vendor, existing, 'duplicate', await this.ctxOf(existing), undefined, 'reentry');
  }

  private async rejectWithoutRecord(
    survey: Survey,
    vendor: Vendor | null,
    uid: string,
    params: Record<string, string>,
    status: OutcomeStatus,
    reason: string,
    ctx: Ctx,
    message?: string,
  ): Promise<InterviewState> {
    await this.audit.record({ tenantId: survey.tenantId }, `interview.${status}`, 'survey', survey.id, {
      reason,
      vid: vendor?.code ?? null,
      uid: uid.slice(0, 200),
    });
    const pseudo = {
      id: 'none',
      tenantId: survey.tenantId,
      surveyId: survey.id,
      uid,
      country: params.cc ?? null,
      returnUrl: null,
      entryParams: {},
      isTest: false,
    } as unknown as Response;
    return this.outcomeState(vendor, pseudo, status, ctx, message, reason);
  }

  // ---- Session ------------------------------------------------------------------------------

  private async byToken(token: string): Promise<Response> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new NotFoundException('Session not found');
    const r = await this.prisma.response.findUnique({ where: { sessionTokenHash: hashToken(token) } });
    if (!r) throw new NotFoundException('Session not found');
    return r;
  }

  private async ctxOf(r: Response): Promise<Ctx> {
    const v = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: r.versionId } });
    return interviewContext(v, r.language);
  }

  private vendorOf(r: Response) {
    return r.vendorId ? this.prisma.vendor.findUnique({ where: { id: r.vendorId } }) : Promise.resolve(null);
  }

  async state(token: string): Promise<InterviewState> {
    const r = await this.byToken(token);
    return this.stateOf(r, await this.ctxOf(r), await this.vendorOf(r));
  }

  /** Switch the respondent's language (only to a language the survey offers). */
  async setLanguage(token: string, language: string): Promise<InterviewState> {
    const r = await this.byToken(token);
    const ctx = await this.ctxOf(r);
    if (!ctx.look.languages.some((l) => l.tag === language)) throw new NotFoundException('Language not available');
    const updated = await this.prisma.response.update({ where: { id: r.id }, data: { language } });
    return this.stateOf(updated, await this.ctxOf(updated), await this.vendorOf(updated));
  }

  private async outcomeState(
    vendor: Vendor | null,
    r: Response,
    status: OutcomeStatus,
    ctx: Ctx,
    message?: string,
    reason?: string,
  ): Promise<InterviewState> {
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
          { tenantId: r.tenantId, surveyId: r.surveyId, isTest: r.isTest, reason: reason ?? r.outcomeReason },
        )
      : { url: null };
    let text = message ?? ctx.msg[OUTCOME_MESSAGE[status]];
    if (status === 'complete' && !message && ctx.def.thankYou) text = ctx.def.thankYou;
    return { state: 'finished', status, message: text, redirectUrl: r.isTest ? null : redirect.url, isTest: r.isTest, look: ctx.look };
  }

  private async stateOf(r: Response, ctx: Ctx, vendor: Vendor | null): Promise<InterviewState> {
    const def = ctx.def;
    if (r.status !== 'IN_PROGRESS' || r.currentPage < 0) {
      const status = fromEnum(r.status === 'IN_PROGRESS' ? 'COMPLETE' : r.status);
      return this.outcomeState(vendor, r, status, ctx);
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
      look: ctx.look,
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
    try {
      return await this.submitFor(r, pageId, submitted);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      return this.technicalError(r, e as Error);
    }
  }

  /**
   * An unexpected server error while answering: the interview ends as technical_error, the
   * respondent is sent back to the vendor (who can compensate them) and the vendor is told.
   * If even that fails (e.g. the database is down), the original error is rethrown.
   */
  private async technicalError(r: Response, error: Error): Promise<InterviewState> {
    const errorId = randomBytes(6).toString('hex');
    this.log.error(`Interview ${r.id} failed (error ${errorId}): ${error.message}`, error.stack);
    try {
      const n = await this.prisma.response.updateMany({
        where: { id: r.id, status: 'IN_PROGRESS' },
        data: { status: 'TECHNICAL_ERROR', outcomeReason: `error:${errorId}`, currentPage: -1, completedAt: new Date() },
      });
      if (n.count === 1) await this.redirects.outcomeRecorded(r, 'technical_error');
      const fresh = await this.prisma.response.findUniqueOrThrow({ where: { id: r.id } });
      return await this.stateOf(fresh, await this.ctxOf(fresh), await this.vendorOf(fresh));
    } catch {
      throw error;
    }
  }

  private async submitFor(r: Response, pageId: string, submitted: Record<string, unknown>): Promise<InterviewState> {
    const ctx = await this.ctxOf(r);
    const def = ctx.def;
    const vendor = await this.vendorOf(r);
    if (r.status !== 'IN_PROGRESS') return this.stateOf(r, ctx, vendor);
    const page = def.pages[r.currentPage];
    if (!page || page.id !== pageId) throw new ConflictException('This page is out of date. Reload to continue.');

    const prior = (r.answers ?? {}) as Answers;
    const result = validatePage(def, page, prior, submitted, ctx.msg);
    if (!result.ok) throw new InterviewValidationError(result.errors);
    const answers: Answers = { ...prior, ...result.answers };
    const now = new Date();
    const onPage = r.pageShownAt ? Math.min(MAX_PAGE_MS, Math.max(0, now.getTime() - r.pageShownAt.getTime())) : 0;
    const timing = { durationMs: (r.durationMs ?? 0) + onPage, lastPageId: page.id };

    const termination = firstMatchingTermination(def, answers);
    if (termination) return this.finish(r, ctx, vendor, answers, termination.status, termination.id, timing);

    if (!r.isTest) {
      const full = await this.firstFullQuota(r.surveyId, def, answers);
      if (full) return this.finish(r, ctx, vendor, answers, 'quota_full', full, timing);
    }

    const next = nextPageIndex(def, answers, r.currentPage);
    if (next === -1) return this.complete(r, ctx, vendor, answers, timing);

    const moved = await this.prisma.response.updateMany({
      where: { id: r.id, status: 'IN_PROGRESS', currentPage: r.currentPage },
      data: {
        answers: answers as Prisma.InputJsonValue,
        currentPage: next,
        pageShownAt: now,
        durationMs: timing.durationMs,
        lastPageId: def.pages[next]!.id,
      },
    });
    if (moved.count === 0) throw new ConflictException('This page was already submitted. Reload to continue.');
    return this.stateOf({ ...r, answers: answers as Prisma.JsonValue, currentPage: next }, ctx, vendor);
  }

  async back(token: string): Promise<InterviewState> {
    const r = await this.byToken(token);
    const ctx = await this.ctxOf(r);
    const def = ctx.def;
    const vendor = await this.vendorOf(r);
    if (r.status !== 'IN_PROGRESS' || !def.settings.allowBack) return this.stateOf(r, ctx, vendor);
    const answers = (r.answers ?? {}) as Answers;
    let prev = -1;
    for (let i = r.currentPage - 1; i >= 0; i--) {
      if (pageIsVisible(def.pages[i]!, def, answers)) {
        prev = i;
        break;
      }
    }
    if (prev === -1) return this.stateOf(r, ctx, vendor);
    await this.prisma.response.update({
      where: { id: r.id },
      data: { currentPage: prev, pageShownAt: new Date(), lastPageId: def.pages[prev]!.id },
    });
    return this.stateOf({ ...r, currentPage: prev }, ctx, vendor);
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
  private async complete(r: Response, ctx: Ctx, vendor: Vendor | null, answers: Answers, timing: Timing): Promise<InterviewState> {
    const def = ctx.def;
    // Quality is decided before the quota place is taken: an in-survey quality reject never counts.
    const assessment = await this.quality.assess(r, def, answers, timing.durationMs);
    const scored = { ...timing, ...this.quality.fields(def, assessment, r.isTest) };
    if (assessment.decision === 'reject') {
      const codes = [...new Set(assessment.flags.map((f) => f.code))].join(',');
      return this.finish(r, ctx, vendor, answers, 'quality_fail', `quality:${codes}`.slice(0, 200), scored);
    }
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
          data: { status: 'COMPLETE', answers: answers as Prisma.InputJsonValue, currentPage: -1, completedAt: new Date(), ...scored },
        });
        if (done.count === 0) throw new ConflictException('This interview has already finished.');
      });
    } catch (e) {
      if (e instanceof QuotaFull) return this.finish(r, ctx, vendor, answers, 'quota_full', e.quotaId, timing);
      throw e;
    }
    await this.quality.rememberOpenEnds(r, def, answers);
    await this.redirects.outcomeRecorded(r, 'complete');
    return this.outcomeState(vendor, r, 'complete', ctx);
  }

  private async finish(
    r: Response,
    ctx: Ctx,
    vendor: Vendor | null,
    answers: Answers,
    status: OutcomeStatus,
    reason: string,
    extra: Partial<Prisma.ResponseUpdateManyMutationInput> = {},
  ): Promise<InterviewState> {
    const changed = await this.prisma.response.updateMany({
      where: { id: r.id, status: 'IN_PROGRESS' },
      data: {
        ...extra,
        status: toEnum(status),
        outcomeReason: reason,
        answers: answers as Prisma.InputJsonValue,
        currentPage: -1,
        completedAt: new Date(),
      },
    });
    if (changed.count === 1) await this.redirects.outcomeRecorded(r, status);
    const fresh = await this.prisma.response.findUniqueOrThrow({ where: { id: r.id } });
    return this.stateOf(fresh, ctx, vendor);
  }
}
