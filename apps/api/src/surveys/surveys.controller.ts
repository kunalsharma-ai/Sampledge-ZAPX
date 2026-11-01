import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { SurveysService } from './surveys.service';
import { ExportService } from '../exports/export.service';
import { signParams } from '../vendors/redirects';
import { testSignature } from '../interview/interview.service';

const createSchema = z.object({ name: z.string().min(1).max(200) });
const draftSchema = z.object({ definition: z.unknown(), presentation: z.unknown().optional(), expectedUpdatedAt: z.string().optional() });
const presentationBody = z.object({ presentation: z.unknown(), expectedUpdatedAt: z.string().optional() });
const statusSchema = z.object({ status: z.enum(['LIVE', 'PAUSED', 'CLOSED']) });
const linkSchema = z.object({
  vendorId: z.string().optional(),
  uid: z
    .string()
    .regex(/^[\x21-\x7e]{1,200}$/)
    .optional(),
  country: z.string().max(10).optional(),
  test: z.boolean().default(false),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .optional(),
});

@Controller()
export class SurveysController {
  constructor(
    private readonly surveys: SurveysService,
    private readonly prisma: PrismaService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get('projects/:projectId/surveys')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.prisma.survey.findMany({ where: { projectId, tenantId: user.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  @Post('projects/:projectId/surveys')
  @Roles(...CAN_EDIT)
  create(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string, @Body() body: unknown) {
    return this.surveys.create(user, projectId, parseBody(createSchema, body).name);
  }

  @Get('surveys/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.detail(user, id);
  }

  @Get('surveys/:id/draft')
  async draft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const draft = user.role === 'VIEWER' ? await this.latest(user, id) : await this.surveys.draft(user, id);
    return { version: draft, check: this.surveys.check(draft.definition, draft.presentation) };
  }

  private async latest(user: AuthUser, id: string) {
    await this.surveys.getSurvey(user, id);
    return this.prisma.surveyVersion.findFirstOrThrow({ where: { surveyId: id }, orderBy: { version: 'desc' } });
  }

  @Put('surveys/:id/draft')
  @Roles(...CAN_EDIT)
  saveDraft(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(draftSchema, body);
    return this.surveys.saveDraft(user, id, input.definition, input.expectedUpdatedAt);
  }

  @Put('surveys/:id/draft/presentation')
  @Roles(...CAN_EDIT)
  savePresentation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(presentationBody, body);
    return this.surveys.savePresentation(user, id, input.presentation, input.expectedUpdatedAt);
  }

  /** Check any definition (e.g. unsaved edits) without saving it. */
  @Post('surveys/:id/check')
  async check(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    await this.surveys.getSurvey(user, id);
    const input = parseBody(draftSchema, body);
    return this.surveys.check(input.definition, input.presentation);
  }

  @Post('surveys/:id/publish')
  @Roles(...CAN_EDIT)
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.publish(user, id);
  }

  @Post('surveys/:id/status')
  @Roles(...CAN_EDIT)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.surveys.setStatus(user, id, parseBody(statusSchema, body).status);
  }

  @Get('surveys/:id/versions/:version')
  version(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('version', ParseIntPipe) version: number) {
    return this.surveys.version(user, id, version);
  }

  @Get('surveys/:id/quotas')
  quotas(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.quotas(user, id);
  }

  @Get('surveys/:id/responses')
  responses(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('includeTest') includeTest?: string,
    @Query('take') take?: string,
  ) {
    return this.surveys.responses(user, id, { includeTest: includeTest === 'true', take: Math.min(500, Math.max(1, Number(take) || 100)) });
  }

  /**
   * Build a survey link. Vendor links carry vid/uid/cc and, if the vendor requires it, an HMAC
   * signature. Test links are signed by ZAPX, are flagged in the data and never count toward quotas.
   */
  @Post('surveys/:id/links')
  @Roles(...CAN_EDIT)
  async link(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const survey = await this.surveys.getSurvey(user, id);
    const input = parseBody(linkSchema, body);
    const params: Record<string, string> = {};
    let template: string | null = null;
    const base = `${config().RUNTIME_BASE_URL.replace(/\/$/, '')}/s/${id}`;
    if (input.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: input.vendorId, projectId: survey.projectId, tenantId: user.tenantId },
      });
      if (!vendor) throw new NotFoundException('Vendor not found');
      params.vid = vendor.code;
      template = `${base}?vid=${encodeURIComponent(vendor.code)}&uid=[UID]`;
      if (vendor.redirectMode !== 'STATIC') template += `&${vendor.dynamicParam}=[RETURN_URL]`;
      if (vendor.requireSignedEntry) template += '&exp=[UNIX_SECONDS]&sig=[HMAC_SHA256]';
      params.uid = input.uid ?? (input.test ? `TEST-${randomBytes(4).toString('hex')}` : '');
      if (!params.uid) throw new NotFoundException('Provide a uid for a live vendor link');
      if (input.country) params.cc = input.country;
      if (input.test) {
        params.test = '1';
        params.tsig = testSignature(id, params.uid);
      }
      if (vendor.requireSignedEntry) {
        if (input.expiresInHours) params.exp = String(Math.floor(Date.now() / 1000) + input.expiresInHours * 3600);
        params.sig = signParams(params, vendor.secret);
      }
    } else {
      if (!input.test) throw new NotFoundException('Choose a vendor, or create a test link');
      params.uid = input.uid ?? `TEST-${randomBytes(4).toString('hex')}`;
      if (input.country) params.cc = input.country;
      params.test = '1';
      params.tsig = testSignature(id, params.uid);
    }
    const url = `${base}?${new URLSearchParams(params).toString()}`;
    await this.audit.record(user, input.test ? 'survey.link.test' : 'survey.link.vendor', 'survey', id, {
      vid: params.vid ?? null,
      uid: params.uid,
    });
    return { url, template };
  }

  @Get('surveys/:id/export')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: ExpressResponse,
    @Query('format') format = 'csv',
    @Query('includeTest') includeTest?: string,
    @Query('status') status?: string,
  ) {
    const survey = await this.surveys.getSurvey(user, id);
    const versions = await this.prisma.surveyVersion.findMany({
      where: { surveyId: id, status: { not: 'DRAFT' } },
      orderBy: { version: 'asc' },
    });
    const statusFilter = status ? (status.toUpperCase().split(',') as never[]) : undefined;
    const rows = await this.prisma.response.findMany({
      where: {
        surveyId: id,
        ...(includeTest === 'true' ? {} : { isTest: false }),
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
      },
      orderBy: { startedAt: 'asc' },
      include: { vendor: { select: { code: true } }, version: { select: { version: true } } },
    });
    const columns = this.exporter.columns(versions);
    const name = survey.name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'survey';
    await this.audit.record(user, 'survey.export', 'survey', id, { format, rows: rows.length });
    if (format === 'xlsx') {
      if (versions.length === 0) throw new NotFoundException('Publish the survey before exporting');
      const buf = await this.exporter.toXlsx(columns, rows, versions);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
      res.send(buf);
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.send(this.exporter.toCsv(columns, rows));
  }
}
