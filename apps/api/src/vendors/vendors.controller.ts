import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { OUTCOME_STATUSES } from '@zapx/survey-schema';
import { z } from 'zod';
import type { Prisma, Vendor } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { REDIRECT_PRESETS, isAllowedReturnUrl, resolveRedirect } from './redirects';
import { toRedirectConfig } from './redirect.service';

const statusMap = (value: z.ZodTypeAny) =>
  z.object(Object.fromEntries(OUTCOME_STATUSES.map((s) => [s, value.optional()])) as Record<string, z.ZodTypeAny>).strict();

const urlTemplate = z
  .string()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), 'Must start with http:// or https://');

const vendorSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Letters, digits, _ or - only'),
  redirectMode: z.enum(['STATIC', 'DYNAMIC', 'HYBRID']).default('STATIC'),
  staticUrls: statusMap(urlTemplate).default({}),
  statusWords: statusMap(z.string().min(1).max(60)).default({}),
  dynamicAllowedHosts: z
    .array(z.string().regex(/^[A-Za-z0-9.-]{1,253}$/, 'Host names only, e.g. example.com'))
    .max(20)
    .default([]),
  dynamicParam: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,40}$/)
    .default('rurl'),
  requireSignedEntry: z.boolean().default(false),
  signRedirects: z.boolean().default(false),
  presetId: z.string().optional(),
});

const previewSchema = z.object({
  status: z.enum(OUTCOME_STATUSES),
  uid: z.string().max(200).default('TEST123'),
  country: z.string().max(10).optional(),
  returnUrl: z.string().max(2000).optional(),
});

const RESERVED_PARAMS = ['vid', 'uid', 'cc', 'sig', 'exp', 'test', 'tsig'];

/** Sample vendors, their redirect configuration and redirect QA (preview). */
@Controller()
export class VendorsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async own(user: AuthUser, id: string): Promise<Vendor> {
    const v = await this.prisma.vendor.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  private withPreset(input: z.infer<typeof vendorSchema>) {
    const preset = REDIRECT_PRESETS.find((p) => p.id === input.presetId);
    const { presetId: _presetId, ...rest } = input;
    if (!preset) return rest;
    return {
      ...rest,
      redirectMode: input.redirectMode ?? preset.redirectMode,
      staticUrls: { ...preset.staticUrls, ...input.staticUrls },
      statusWords: { ...preset.statusWords, ...input.statusWords },
    };
  }

  @Get('vendor-presets')
  presets() {
    return REDIRECT_PRESETS;
  }

  @Get('projects/:projectId/vendors')
  async list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.prisma.vendor.findMany({ where: { projectId, tenantId: user.tenantId }, orderBy: { createdAt: 'asc' } });
  }

  @Post('projects/:projectId/vendors')
  @Roles(...CAN_EDIT)
  async create(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string, @Body() body: unknown) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, tenantId: user.tenantId } });
    if (!project) throw new NotFoundException('Project not found');
    const input = this.withPreset(parseBody(vendorSchema, body));
    if (RESERVED_PARAMS.includes(input.dynamicParam)) input.dynamicParam = 'rurl';
    const vendor = await this.prisma.vendor.create({
      data: {
        ...input,
        staticUrls: input.staticUrls as Prisma.InputJsonValue,
        statusWords: input.statusWords as Prisma.InputJsonValue,
        tenantId: user.tenantId,
        projectId,
        secret: randomBytes(32).toString('hex'),
      },
    });
    await this.audit.record(user, 'vendor.create', 'vendor', vendor.id, { code: vendor.code, mode: vendor.redirectMode });
    return vendor;
  }

  @Get('vendors/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.own(user, id);
  }

  @Put('vendors/:id')
  @Roles(...CAN_EDIT)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const before = await this.own(user, id);
    const input = this.withPreset(parseBody(vendorSchema, body));
    if (RESERVED_PARAMS.includes(input.dynamicParam)) input.dynamicParam = 'rurl';
    const vendor = await this.prisma.vendor.update({
      where: { id },
      data: {
        ...input,
        staticUrls: input.staticUrls as Prisma.InputJsonValue,
        statusWords: input.statusWords as Prisma.InputJsonValue,
      },
    });
    await this.audit.record(user, 'vendor.update', 'vendor', id, {
      before: { mode: before.redirectMode, staticUrls: before.staticUrls, statusWords: before.statusWords },
      after: { mode: vendor.redirectMode, staticUrls: vendor.staticUrls, statusWords: vendor.statusWords },
    });
    return vendor;
  }

  @Delete('vendors/:id')
  @Roles(...CAN_EDIT)
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.own(user, id);
    const used = await this.prisma.response.count({ where: { vendorId: id } });
    if (used > 0) throw new ConflictException('This vendor already has respondents and cannot be deleted');
    await this.prisma.vendor.delete({ where: { id } });
    await this.audit.record(user, 'vendor.delete', 'vendor', id);
  }

  @Post('vendors/:id/rotate-secret')
  @Roles(...CAN_EDIT)
  async rotate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.own(user, id);
    const vendor = await this.prisma.vendor.update({ where: { id }, data: { secret: randomBytes(32).toString('hex') } });
    await this.audit.record(user, 'vendor.rotate_secret', 'vendor', id);
    return vendor;
  }

  /** Redirect QA: show exactly where a respondent would be sent for each status. */
  @Post('vendors/:id/redirect-preview')
  async preview(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const vendor = await this.own(user, id);
    const input = parseBody(previewSchema, body);
    const returnUrl = input.returnUrl ?? null;
    const resolved = resolveRedirect(
      toRedirectConfig(vendor),
      { responseId: 'PREVIEW', uid: input.uid, country: input.country ?? null, returnUrl, entryParams: {} },
      input.status,
    );
    return {
      ...resolved,
      returnUrlAccepted: returnUrl ? isAllowedReturnUrl(returnUrl, vendor.dynamicAllowedHosts) : null,
    };
  }
}
