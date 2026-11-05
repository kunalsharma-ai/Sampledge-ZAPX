import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { REDIRECT_PRESETS, REDIRECT_STATUSES, isAllowedReturnUrl } from '@zapx/redirect-core';
import { z } from 'zod';
import type { Prisma, Vendor } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parseBody } from '../common/validation';
import type { AuthUser, RoleName } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { RedirectService } from '../integrations/redirect.service';
import { SecretBox } from '../platform/secret-box';
import { URL_TEMPLATE, countryRulesSchema, statusMap } from '../integrations/integration-config';

const httpsBase = z
  .string()
  .max(500)
  .url()
  .refine((v) => /^https:\/\//i.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(v), 'Use an https:// URL')
  .transform((v) => v.replace(/\/+$/, ''));

const vendorSchema = z
  .object({
    name: z.string().min(1).max(120),
    code: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Letters, digits, _ or - only'),
    integration: z.enum(['DIRECT', 'PROJEXA']).default('DIRECT'),
    redirectMode: z.enum(['STATIC', 'DYNAMIC', 'HYBRID']).default('STATIC'),
    staticUrls: statusMap(URL_TEMPLATE).prefault({}),
    statusWords: statusMap(z.string().min(1).max(60)).prefault({}),
    countryRedirects: countryRulesSchema.prefault({}),
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
    callbackUrl: URL_TEMPLATE.nullable().default(null),
    callbackStatuses: z.array(z.enum(REDIRECT_STATUSES)).max(8).default([]),
    callbackMaxAttempts: z.number().int().min(1).max(10).default(6),
    partnerBaseUrl: httpsBase.nullable().default(null),
    /** Write-only. Omit to keep the stored secret, null to remove it. */
    partnerSecret: z.string().min(8).max(500).nullable().optional(),
    partnerS2s: z.boolean().default(true),
    presetId: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.integration === 'PROJEXA' && !v.partnerBaseUrl)
      ctx.addIssue({ code: 'custom', path: ['partnerBaseUrl'], message: 'PROJEXA needs its base URL' });
  });

const previewSchema = z.object({
  status: z.enum(REDIRECT_STATUSES),
  uid: z.string().max(200).default('TEST123'),
  country: z.string().max(10).optional(),
  returnUrl: z.string().max(2000).optional(),
});

const RESERVED_PARAMS = ['vid', 'uid', 'cc', 'sig', 'exp', 'test', 'tsig', 'lang'];

/** Roles that receive the vendor's shared secret. A super admin also receives it (see seesVendorSecret). */
export const SEES_VENDOR_SECRET: RoleName[] = ['ADMIN'];

/**
 * Administrators and the super admin see the vendor's shared secret (Kunal's decisions, 2026-11-05):
 * a super admin sees it whatever their role in the organization. API keys never act as super admin.
 */
export function seesVendorSecret(user: Pick<AuthUser, 'role' | 'superAdmin' | 'apiKeyId'>): boolean {
  return SEES_VENDOR_SECRET.includes(user.role) || (!!user.superAdmin && !user.apiKeyId);
}

/**
 * What the studio sees: never the encrypted partner secret, only whether one is set. The shared
 * secret signs entry links, redirects and callbacks and authenticates the vendor API, so only
 * administrators and the super admin receive it; programmers and viewers get the rest of the vendor
 * without it.
 */
export function presentVendor(v: Vendor, user: Pick<AuthUser, 'role' | 'superAdmin' | 'apiKeyId'>) {
  const { partnerSecretEnc, secret, ...rest } = v;
  return { ...rest, ...(seesVendorSecret(user) ? { secret } : {}), partnerSecretSet: !!partnerSecretEnc };
}

/** Sample vendors, their redirect and callback configuration and redirect QA (preview). */
@Controller()
export class VendorsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redirects: RedirectService,
    private readonly box: SecretBox,
    private readonly access: AccessService,
  ) {}

  private async own(user: AuthUser, id: string): Promise<Vendor> {
    const v = await this.prisma.vendor.findFirst({ where: { id, ...this.access.vendors(user) } });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  private toData(input: z.infer<typeof vendorSchema>) {
    const preset = REDIRECT_PRESETS.find((p) => p.id === input.presetId);
    const { presetId: _presetId, partnerSecret, ...rest } = input;
    const merged = preset
      ? { ...rest, staticUrls: { ...preset.staticUrls, ...input.staticUrls }, statusWords: { ...preset.statusWords, ...input.statusWords } }
      : rest;
    if (RESERVED_PARAMS.includes(merged.dynamicParam)) merged.dynamicParam = 'rurl';
    return {
      ...merged,
      staticUrls: merged.staticUrls as Prisma.InputJsonValue,
      statusWords: merged.statusWords as Prisma.InputJsonValue,
      countryRedirects: merged.countryRedirects as Prisma.InputJsonValue,
      ...(partnerSecret === undefined ? {} : { partnerSecretEnc: partnerSecret === null ? null : this.box.seal(partnerSecret) }),
    };
  }

  private static summary(v: Vendor) {
    return {
      integration: v.integration,
      mode: v.redirectMode,
      staticUrls: v.staticUrls,
      statusWords: v.statusWords,
      countryRedirects: v.countryRedirects,
      callbackUrl: v.callbackUrl,
      callbackStatuses: v.callbackStatuses,
      partnerBaseUrl: v.partnerBaseUrl,
      partnerSecretSet: !!v.partnerSecretEnc,
    };
  }

  @Get('vendor-presets')
  presets() {
    return REDIRECT_PRESETS;
  }

  @Get('projects/:projectId/vendors')
  async list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    const rows = await this.prisma.vendor.findMany({
      where: { projectId, ...this.access.vendors(user) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((v) => presentVendor(v, user));
  }

  @Post('projects/:projectId/vendors')
  @Roles(...CAN_EDIT)
  async create(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string, @Body() body: unknown) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...this.access.projects(user) } });
    if (!project) throw new NotFoundException('Project not found');
    const data = this.toData(parseBody(vendorSchema, body));
    const taken = await this.prisma.vendor.findUnique({ where: { projectId_code: { projectId, code: data.code } } });
    if (taken) {
      throw new ConflictException(
        taken.deletedAt
          ? 'That vendor ID belonged to a deleted vendor and cannot be reused'
          : 'That vendor ID is already used in this project',
      );
    }
    const vendor = await this.prisma.vendor.create({
      data: { ...data, tenantId: user.tenantId, projectId, secret: randomBytes(32).toString('hex') },
    });
    await this.audit.record(user, 'vendor.create', 'vendor', vendor.id, { code: vendor.code, ...VendorsController.summary(vendor) });
    return presentVendor(vendor, user);
  }

  @Get('vendors/:id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return presentVendor(await this.own(user, id), user);
  }

  @Put('vendors/:id')
  @Roles(...CAN_EDIT)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const before = await this.own(user, id);
    const data = this.toData(parseBody(vendorSchema, body));
    if (data.code !== before.code) {
      const taken = await this.prisma.vendor.findUnique({ where: { projectId_code: { projectId: before.projectId, code: data.code } } });
      if (taken) throw new ConflictException('That vendor ID is already used in this project');
    }
    const vendor = await this.prisma.vendor.update({ where: { id }, data });
    await this.audit.record(user, 'vendor.update', 'vendor', id, {
      before: VendorsController.summary(before),
      after: VendorsController.summary(vendor),
    });
    return presentVendor(vendor, user);
  }

  /** Soft delete: links stop working, history (responses, redirects, callbacks) is kept. */
  @Delete('vendors/:id')
  @Roles(...CAN_EDIT)
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.own(user, id);
    await this.prisma.vendor.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record(user, 'vendor.delete', 'vendor', id);
  }

  @Post('vendors/:id/rotate-secret')
  @Roles(...CAN_EDIT)
  async rotate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.own(user, id);
    const vendor = await this.prisma.vendor.update({ where: { id }, data: { secret: randomBytes(32).toString('hex') } });
    await this.audit.record(user, 'vendor.rotate_secret', 'vendor', id);
    return presentVendor(vendor, user);
  }

  /** Redirect QA: show exactly where a respondent would be sent for each status. */
  @Post('vendors/:id/redirect-preview')
  async preview(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const vendor = await this.own(user, id);
    const input = parseBody(previewSchema, body);
    const returnUrl = input.returnUrl ?? null;
    const resolved = await this.redirects.preview(
      vendor,
      { responseId: 'PREVIEW', uid: input.uid, country: input.country ?? null, returnUrl, entryParams: {} },
      input.status,
    );
    return { ...resolved, returnUrlAccepted: returnUrl ? isAllowedReturnUrl(returnUrl, vendor.dynamicAllowedHosts) : null };
  }
}
