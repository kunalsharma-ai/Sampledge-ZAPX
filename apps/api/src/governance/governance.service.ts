/**
 * Blueprint phase 5: data residency and retention for an organization.
 *
 * Residency: ZAPX runs where it is deployed; it cannot move data between regions by itself. The
 * deployment declares its region (DATA_REGION) and the organization says where its data must stay.
 * ZAPX shows whether the two match, lists which configured services send data outside the
 * deployment, and can refuse those (AI, transcription, network reputation lookups) for the
 * organization. That is a control on what ZAPX sends, not a certification.
 *
 * Retention: after the chosen number of days, interviews are erased (answers, link parameters,
 * device and network identifiers, location, evidence, photos and recordings; the row keeps its
 * status and timings so fieldwork counts stay true, and analyses leave it out), captures are
 * deleted, and contacts lose their email, phone, name and columns. Contacts who unsubscribed keep
 * their address so they are never invited again. The worker applies the policy once an hour.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { integration } from '../platform/integrations';
import type { AuthUser } from '../auth/auth.types';
import { config } from '../config';
import { CaptureService } from '../captures/capture.service';

const days = z.number().int().min(1).max(3650).nullable().optional();
export const retentionSchema = z.object({ responsesDays: days, capturesDays: days, contactsDays: days }).strict();
export type Retention = z.infer<typeof retentionSchema>;

export const governanceSchema = z
  .object({
    dataRegion: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,20}$/, 'Use a short region code such as eu, us or in')
      .nullable()
      .optional(),
    blockExternalProcessors: z.boolean().optional(),
    retention: retentionSchema.optional(),
  })
  .strict();

const DAY_MS = 86_400_000;
const BATCH = 500;

export function readRetention(raw: unknown): Retention {
  const p = retentionSchema.safeParse(raw ?? {});
  return p.success ? p.data : {};
}

/** Services configured on this deployment that send organization data outside it. */
export function externalProcessors() {
  const c = config();
  return [
    { id: 'ai', name: 'AI (Anthropic Claude)', on: integration('anthropic').enabled, blockable: true },
    { id: 'transcription', name: 'Transcription (Deepgram)', on: integration('deepgram').enabled, blockable: true },
    { id: 'network_reputation', name: 'Network reputation (IPinfo)', on: integration('ipinfo').enabled, blockable: true },
    { id: 'email', name: 'Email (SendGrid)', on: c.EMAIL_PROVIDER === 'sendgrid', blockable: false },
    { id: 'sms', name: 'SMS (Twilio)', on: c.SMS_PROVIDER === 'twilio', blockable: false },
    { id: 'telephony', name: 'Phone dialer (Twilio)', on: integration('twilio').enabled, blockable: false },
    {
      id: 'file_store',
      name: `File storage (S3, ${integration('s3').values.region ?? c.S3_REGION})`,
      on: integration('s3').enabled,
      blockable: false,
    },
  ];
}

@Injectable()
export class GovernanceService {
  private readonly log = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly captures: CaptureService,
  ) {}

  async get(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { dataRegion: true, blockExternalProcessors: true, retention: true },
    });
    const deploymentRegion = config().DATA_REGION || null;
    return {
      deploymentRegion,
      dataRegion: t.dataRegion,
      regionMatches: !t.dataRegion || !deploymentRegion ? null : t.dataRegion === deploymentRegion,
      blockExternalProcessors: t.blockExternalProcessors,
      processors: externalProcessors(),
      retention: readRetention(t.retention),
      captureRetentionDays: config().CAPTURE_RETENTION_DAYS || null,
    };
  }

  async update(user: AuthUser, body: unknown) {
    const p = governanceSchema.safeParse(body);
    if (!p.success) throw new BadRequestException(p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const before = await this.get(user.tenantId);
    const retention = p.data.retention
      ? Object.fromEntries(Object.entries({ ...before.retention, ...p.data.retention }).filter(([, v]) => v !== null && v !== undefined))
      : undefined;
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: {
        ...(p.data.dataRegion !== undefined ? { dataRegion: p.data.dataRegion } : {}),
        ...(p.data.blockExternalProcessors !== undefined ? { blockExternalProcessors: p.data.blockExternalProcessors } : {}),
        ...(retention ? { retention: retention as Prisma.InputJsonValue } : {}),
      },
    });
    const after = await this.get(user.tenantId);
    await this.audit.record(user, 'governance.update', 'tenant', user.tenantId, {
      before: { dataRegion: before.dataRegion, blockExternalProcessors: before.blockExternalProcessors, retention: before.retention },
      after: { dataRegion: after.dataRegion, blockExternalProcessors: after.blockExternalProcessors, retention: after.retention },
    });
    return after;
  }

  /** True when the organization refuses processors outside the deployment. */
  async blocksExternal(tenantId: string): Promise<boolean> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { blockExternalProcessors: true } });
    return !!t?.blockExternalProcessors;
  }

  /** Apply every organization's retention policy (worker housekeeping). */
  async applyRetention(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({
      where: { NOT: { retention: { equals: {} } } },
      select: { id: true, retention: true },
    });
    const total = { responses: 0, captures: 0, contacts: 0 };
    for (const t of tenants) {
      const r = readRetention(t.retention);
      const done = { responses: 0, captures: 0, contacts: 0 };
      if (r.responsesDays) done.responses = await this.eraseResponses(t.id, new Date(now.getTime() - r.responsesDays * DAY_MS));
      if (r.capturesDays)
        done.captures += await this.captures.dropWhere({ tenantId: t.id, before: new Date(now.getTime() - r.capturesDays * DAY_MS) });
      if (r.contactsDays) done.contacts = await this.eraseContacts(t.id, new Date(now.getTime() - r.contactsDays * DAY_MS));
      if (done.responses || done.captures || done.contacts) {
        await this.audit.record({ tenantId: t.id, id: null }, 'retention.apply', 'tenant', t.id, { ...done, policy: r });
        total.responses += done.responses;
        total.captures += done.captures;
        total.contacts += done.contacts;
      }
    }
    if (total.responses || total.captures || total.contacts) this.log.log(`Retention erased ${JSON.stringify(total)}`);
    return total;
  }

  /** Erase interviews started before the cutoff (in batches; the next pass continues). */
  private async eraseResponses(tenantId: string, before: Date): Promise<number> {
    let erased = 0;
    for (let round = 0; round < 10; round++) {
      const rows = await this.prisma.response.findMany({
        where: { tenantId, erasedAt: null, startedAt: { lt: before } },
        select: { id: true },
        take: BATCH,
      });
      if (!rows.length) break;
      const ids = rows.map((r) => r.id);
      await this.captures.dropWhere({ tenantId, responseIds: ids });
      await this.prisma.openEndFingerprint.deleteMany({ where: { responseId: { in: ids } } });
      await this.prisma.$executeRaw`
        UPDATE "Response" SET
          "answers" = '{}', "entryParams" = '{}', "returnUrl" = NULL, "userAgent" = NULL, "ipHash" = NULL,
          "deviceHash" = NULL, "signals" = '{}', "location" = NULL, "evidence" = NULL, "geoCountry" = NULL,
          "uid" = 'erased-' || "id", "erasedAt" = now()
        WHERE "id" = ANY(${ids}) AND "erasedAt" IS NULL`;
      erased += ids.length;
    }
    return erased;
  }

  private async eraseContacts(tenantId: string, before: Date): Promise<number> {
    const n = await this.prisma.contact.updateMany({
      where: {
        tenantId,
        createdAt: { lt: before },
        unsubscribedAt: null,
        OR: [{ email: { not: null } }, { phone: { not: null } }, { name: { not: null } }],
      },
      data: { email: null, phone: null, name: null, fields: {} },
    });
    return n.count;
  }
}
