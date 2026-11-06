/**
 * SAMPLEON integration (SAMPLEON docs/ECOSYSTEM_ARCHITECTURE.md).
 *
 * Ownership: SAMPLEON decides who is invited, when, and where a respondent is routed next;
 * SUPPLY360 owns the respondents; ZAPX hosts the survey and reports verified outcomes. ZAPX
 * therefore keeps no respondent list, no invitation engine and no second quota service here, only
 * a record of each audience request so the studio can show where it stands.
 *
 *   Independent ZAPX survey:  studio → POST SAMPLEON /api/v1/audience-requests (source ZAPX)
 *                             → a person approves in SAMPLEON → SAMPLEON invites via SUPPLY360
 *                             → respondent enters /s/{survey}?vid=SAMPLEON&uid={token}
 *                             → outcome redirect + signed S2S to SAMPLEON (SAMPLEON vendor adapter)
 *                             → SAMPLEON events back to ZAPX (POST /api/v1/sampleon/events).
 *   PROJEXA-linked survey:    PROJEXA creates the request with the launch URL shown by
 *                             GET /api/surveys/{id}/sampleon; outcomes reach SAMPLEON the same way,
 *                             and progress goes to PROJEXA.
 */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@zapx/db';
import { sampledgeServiceHeaders, verifySampledgeRequest } from '@zapx/redirect-core';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { parseBody } from '../common/validation';
import { config } from '../config';
import { SecretBox } from '../platform/secret-box';
import { SurveysService } from '../surveys/surveys.service';

/** The vendor code SAMPLEON respondents enter with. Reserved per project. */
export const SAMPLEON_VENDOR_CODE = 'SAMPLEON';

const Country = z.string().regex(/^[A-Z]{2}$/, 'Use ISO 3166-1 alpha-2, e.g. US');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * What the studio sends. Criteria and quota conditions use SUPPLY360's attribute catalogue and are
 * validated by SAMPLEON; ZAPX passes them through unchanged.
 */
const submitSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    countries: z.array(Country).min(1).max(60),
    requiredCompletes: z.number().int().min(1).max(1_000_000),
    completesByCountry: z.record(z.string(), z.number().int().min(0)).optional(),
    targeting: z
      .object({
        criteria: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
        naturalLanguage: z.string().max(2000).optional(),
      })
      .default({ criteria: [] }),
    quotas: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
    expectedIncidence: z.number().gt(0).max(1),
    loiMinutes: z.number().int().min(1).max(180),
    reward: z.object({
      points: z.number().int().min(0).max(1_000_000),
      currency: z.string().length(3).optional(),
      value: z.number().min(0).optional(),
    }),
    fieldwork: z.object({ start: IsoDate, end: IsoDate }),
    language: z.string().min(2).max(20).default('en'),
    allowRouting: z.boolean().default(true),
    exclusions: z
      .object({ surveyIds: z.array(z.string()).max(200).default([]), audienceRequestIds: z.array(z.string()).max(200).default([]) })
      .optional(),
  })
  .refine((v) => v.targeting.criteria.length > 0 || !!v.targeting.naturalLanguage, {
    message: 'Describe the audience, or give targeting criteria',
    path: ['targeting'],
  });

/** The part of SAMPLEON's event envelope ZAPX reads (full schema: @sampledge/contracts events.ts). */
const envelopeSchema = z.object({
  specVersion: z.literal('1.0'),
  eventId: z.string().uuid(),
  type: z.string().min(1).max(80),
  source: z.literal('SAMPLEON'),
  occurredAt: z.string(),
  correlationId: z.string().regex(/^AR-[0-9A-HJKMNP-TV-Z]{26}$/),
  subject: z.object({ sourcePlatform: z.string(), sourceProjectId: z.string(), surveyId: z.string() }).passthrough(),
  payload: z.record(z.string(), z.unknown()),
});

const counts = z.object({ required: z.number().int(), completes: z.number().int(), remaining: z.number().int() }).passthrough();

export interface InboundRequest {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  body: unknown;
}

@Injectable()
export class SampleonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly audit: AuditService,
    private readonly box: SecretBox,
  ) {}

  static configured() {
    const c = config();
    return !!(c.SAMPLEON_URL && c.SAMPLEON_CLIENT_SECRET);
  }

  /** Where SAMPLEON sends respondents. SAMPLEON replaces {token} with its session token. */
  static launchUrl(surveyId: string) {
    return `${config().RUNTIME_BASE_URL.replace(/\/$/, '')}/s/${surveyId}?vid=${SAMPLEON_VENDOR_CODE}&uid={token}`;
  }

  async overview(user: AuthUser, surveyId: string) {
    const survey = await this.surveys.getSurvey(user, surveyId);
    const requests = await this.prisma.sampleonAudienceRequest.findMany({
      where: { tenantId: user.tenantId, surveyId: survey.id },
      orderBy: { createdAt: 'desc' },
    });
    return { configured: SampleonService.configured(), launchUrl: SampleonService.launchUrl(survey.id), requests };
  }

  /**
   * The project's SAMPLEON vendor: outcomes for respondents who entered with vid=SAMPLEON go back to
   * SAMPLEON as a redirect plus a signed S2S confirmation (redirect-core sampleonAdapter).
   */
  async ensureVendor(user: AuthUser, projectId: string) {
    const c = config();
    const existing = await this.prisma.vendor.findFirst({ where: { projectId, code: SAMPLEON_VENDOR_CODE, tenantId: user.tenantId } });
    if (existing) {
      if (existing.deletedAt)
        throw new ConflictException('The SampAudience vendor (code SAMPLEON) of this project was deleted; restore it first');
      if (existing.integration !== 'SAMPLEON')
        throw new ConflictException(`Vendor code ${SAMPLEON_VENDOR_CODE} is already used by another vendor in this project`);
      return existing;
    }
    if (!c.SAMPLEON_OUTCOME_SECRET) throw new ServiceUnavailableException('SAMPLEON_OUTCOME_SECRET is not set');
    const vendor = await this.prisma.vendor.create({
      data: {
        tenantId: user.tenantId,
        projectId,
        name: 'SampAudience',
        code: SAMPLEON_VENDOR_CODE,
        integration: 'SAMPLEON',
        partnerBaseUrl: c.SAMPLEON_URL!.replace(/\/+$/, ''),
        partnerSecretEnc: this.box.seal(c.SAMPLEON_OUTCOME_SECRET),
        partnerS2s: true,
        secret: randomBytes(32).toString('hex'),
      },
    });
    await this.audit.record(user, 'vendor.create', 'vendor', vendor.id, { code: vendor.code, integration: 'SAMPLEON' });
    return vendor;
  }

  async connect(user: AuthUser, surveyId: string) {
    if (!SampleonService.configured()) throw new ServiceUnavailableException('The SampAudience integration is not configured');
    const survey = await this.surveys.getSurvey(user, surveyId);
    const vendor = await this.ensureVendor(user, survey.projectId);
    return { launchUrl: SampleonService.launchUrl(survey.id), vendorId: vendor.id, vendorCode: vendor.code };
  }

  /** Independent ZAPX workflow: ask SAMPLEON for an audience. Invitations wait for approval in SAMPLEON. */
  async submit(user: AuthUser, surveyId: string, body: unknown) {
    if (!SampleonService.configured()) throw new ServiceUnavailableException('The SampAudience integration is not configured');
    const survey = await this.surveys.getSurvey(user, surveyId);
    const input = parseBody(submitSchema, body);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true } });
    await this.ensureVendor(user, survey.projectId);
    const request = {
      source: { platform: 'ZAPX', projectId: survey.projectId, surveyId: survey.id },
      organization: { id: user.tenantId, name: tenant.name },
      title: input.title ?? survey.name,
      countries: input.countries,
      targeting: input.targeting,
      requiredCompletes: input.requiredCompletes,
      ...(input.completesByCountry ? { completesByCountry: input.completesByCountry } : {}),
      quotas: input.quotas,
      expectedIncidence: input.expectedIncidence,
      loiMinutes: input.loiMinutes,
      reward: input.reward,
      fieldwork: input.fieldwork,
      survey: { launchUrl: SampleonService.launchUrl(survey.id), language: input.language, hostId: config().SAMPLEON_CLIENT_ID },
      redirects: { allowRouting: input.allowRouting },
      ...(input.exclusions ? { exclusions: input.exclusions } : {}),
    };
    const res = await this.call('POST', '/api/v1/audience-requests', request, `zapx:${survey.id}:${randomBytes(8).toString('hex')}`);
    const ar = res as { audienceRequestId?: unknown; status?: unknown };
    if (typeof ar.audienceRequestId !== 'string' || !/^AR-[0-9A-HJKMNP-TV-Z]{26}$/.test(ar.audienceRequestId))
      throw new BadGatewayException('SampAudience did not return an Audience Request ID');
    const row = await this.prisma.sampleonAudienceRequest.create({
      data: {
        tenantId: user.tenantId,
        surveyId: survey.id,
        audienceRequestId: ar.audienceRequestId,
        sourcePlatform: 'ZAPX',
        status: typeof ar.status === 'string' ? ar.status : 'submitted',
        title: request.title,
        countries: input.countries,
        requiredCompletes: input.requiredCompletes,
        remaining: input.requiredCompletes,
        createdById: user.id,
      },
    });
    await this.audit.record(user, 'sampleon.audience_request.submitted', 'survey', survey.id, { audienceRequestId: ar.audienceRequestId });
    return { audienceRequest: res, record: row };
  }

  /** Signed call to SAMPLEON. SAMPLEON's 4xx answers are passed on; anything else is a 502. */
  private async call(method: 'GET' | 'POST', path: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
    const c = config();
    const text = body === undefined ? '' : JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(`${c.SAMPLEON_URL!.replace(/\/+$/, '')}${path}`, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: {
          ...(text ? { 'content-type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          ...sampledgeServiceHeaders({ clientId: c.SAMPLEON_CLIENT_ID, secret: c.SAMPLEON_CLIENT_SECRET!, method, path, body: text }),
        },
        body: text || undefined,
      });
    } catch (e) {
      throw new BadGatewayException(`SampAudience could not be reached: ${(e as Error).message}`.slice(0, 300));
    }
    const raw = await res.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = { message: raw.slice(0, 300) };
    }
    if (res.ok) return parsed;
    if (res.status >= 400 && res.status < 500)
      throw new HttpException({ message: 'SampAudience refused the request', sampleon: parsed }, res.status);
    throw new BadGatewayException({ message: `SampAudience answered ${res.status}`, sampleon: parsed });
  }

  /** Signed SAMPLEON event webhook. Each event is applied once; unknown requests are acknowledged. */
  async receive(req: InboundRequest) {
    const c = config();
    if (!SampleonService.configured()) throw new ServiceUnavailableException('The SampAudience integration is not configured');
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? null));
    const reason = verifySampledgeRequest({
      headers: req.headers,
      method: req.method,
      path: req.originalUrl,
      body: raw,
      expectedClient: 'sampleon',
      secret: c.SAMPLEON_CLIENT_SECRET!,
    });
    if (reason) throw new UnauthorizedException(reason);
    const parsed = envelopeSchema.safeParse(req.body);
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Invalid event',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    const e = parsed.data;
    try {
      await this.prisma.sampleonInboundEvent.create({ data: { eventId: e.eventId, type: e.type, audienceRequestId: e.correlationId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { status: 'duplicate' };
      throw err;
    }
    const row = await this.prisma.sampleonAudienceRequest.findUnique({ where: { audienceRequestId: e.correlationId } });
    if (!row || row.surveyId !== e.subject.surveyId) return { status: 'ignored' };
    const data: Prisma.SampleonAudienceRequestUpdateInput = { lastEventType: e.type, lastEventAt: new Date(e.occurredAt) };
    const p = e.payload;
    switch (e.type) {
      case 'feasibility.calculated':
        if (row.status === 'submitted') data.status = 'feasibility_ready';
        break;
      case 'audience.approved':
        data.status = 'approved';
        break;
      case 'batch.scheduled':
        if (['approved', 'soft_launch', 'paused'].includes(row.status)) data.status = p.mode === 'soft' ? 'soft_launch' : 'live';
        break;
      case 'survey.completed': {
        const progress = counts.safeParse(p.progress);
        if (progress.success) Object.assign(data, { completes: progress.data.completes, remaining: progress.data.remaining });
        break;
      }
      case 'project.quota_updated': {
        const seq = Number(p.sequence);
        const progress = counts.safeParse(p.progress);
        if (Number.isInteger(seq) && seq > row.progressSequence && progress.success) {
          Object.assign(data, {
            progressSequence: seq,
            progress: { progress: progress.data, byCountry: p.byCountry ?? {}, quotas: p.quotas ?? [] } as Prisma.InputJsonValue,
            completes: progress.data.completes,
            remaining: progress.data.remaining,
          });
        }
        break;
      }
      case 'project.closed':
        data.status = 'closed';
        break;
      default:
        break;
    }
    await this.prisma.sampleonAudienceRequest.update({ where: { id: row.id }, data });
    return { status: 'processed' };
  }
}
