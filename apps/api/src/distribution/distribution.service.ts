/**
 * Blueprint phase 3: distribution by email. Contacts are kept per survey; an invitation wave sends
 * each contact a personal link at a scheduled time, then reminds people who have not finished.
 *
 * Personal links are ordinary open links with a random respondent id (`/s/:survey?uid=...`), so
 * the interview, quotas and quality checks are the same as for any respondent. Contact columns
 * become link parameters (URL variables). Everyone can unsubscribe with one click; unsubscribed
 * contacts are never emailed again for this survey.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Contact, Distribution, Invitation, Prisma } from '@zapx/db';
import { RESERVED_LINK_PARAMS } from '@zapx/survey-schema';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import type { AuthUser } from '../auth/auth.types';
import { parseCsv } from '../imports/template-import';
import { emailProvider, type EmailProvider } from './mailer';
import { MAX_SMS_BODY, normalizePhone, smsProvider, type SmsProvider } from './sms';

export const MAX_CONTACTS = 100_000;
/** Code of the project source that invitation links enter through. */
export const EMAIL_SOURCE = 'ZAPX_EMAIL';
const MAX_IMPORT_ROWS = 20_000;
const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const DAY_MS = 24 * 3600 * 1000;
/** Emails sent per worker pass, so one big wave does not hold the worker. */
const SEND_BATCH = 50;

export interface WaveInput {
  name: string;
  /** Blueprint phase 5: EMAIL (default) or SMS. An SMS has no subject. */
  channel?: 'EMAIL' | 'SMS';
  subject: string;
  body: string;
  sendAt: Date;
  reminderDays: number;
  maxReminders: number;
  reminderSubject?: string;
}

/** Statuses after which a respondent is not reminded. */
const FINISHED = ['COMPLETE', 'TERMINATE', 'QUOTA_FULL', 'QUALITY_FAIL', 'SECURITY_REJECT', 'DUPLICATE', 'TECHNICAL_ERROR'] as const;

@Injectable()
export class DistributionService {
  private readonly log = new Logger('Distribution');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  private async survey(user: AuthUser, surveyId: string) {
    const s = await this.prisma.survey.findFirst({ where: { id: surveyId, ...this.access.surveys(user) } });
    if (!s) throw new NotFoundException('Survey not found');
    return s;
  }

  // ---- Contacts ---------------------------------------------------------------------------------

  async contacts(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const [rows, total, unsubscribed] = await Promise.all([
      this.prisma.contact.findMany({ where: { surveyId, tenantId: user.tenantId }, orderBy: { createdAt: 'asc' }, take: 200 }),
      this.prisma.contact.count({ where: { surveyId, tenantId: user.tenantId } }),
      this.prisma.contact.count({ where: { surveyId, tenantId: user.tenantId, unsubscribedAt: { not: null } } }),
    ]);
    return {
      total,
      unsubscribed,
      emailEnabled: !!emailProvider(),
      smsEnabled: !!smsProvider(),
      items: rows.map((c) => ({
        id: c.id,
        email: c.email,
        phone: c.phone,
        name: c.name,
        language: c.language,
        fields: c.fields,
        unsubscribed: !!c.unsubscribedAt,
      })),
    };
  }

  /**
   * Add or update contacts from CSV text with a header row: email and/or phone (at least one per
   * row), name, language, and any other columns (kept as link parameters). Rows with a bad email or
   * phone number are reported, not imported. A row matches an existing contact by email, else by phone.
   */
  async importContacts(user: AuthUser, surveyId: string, csv: string) {
    await this.survey(user, surveyId);
    const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
    if (rows.length < 2) throw new BadRequestException('Paste a header row and at least one contact');
    if (rows.length - 1 > MAX_IMPORT_ROWS) throw new BadRequestException(`Import at most ${MAX_IMPORT_ROWS} contacts at a time`);
    const header = rows[0]!.map((h) => h.trim());
    const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name);
    const iEmail = col('email');
    const iPhone = col('phone');
    if (iEmail < 0 && iPhone < 0) throw new BadRequestException('The header row needs an "email" or a "phone" column');
    const iName = col('name');
    const iLang = col('language');
    const known = new Set([iEmail, iPhone, iName, iLang]);
    const extra = header
      .map((h, i) => ({ h, i }))
      .filter(({ i }) => !known.has(i))
      .filter(({ h }) => FIELD_KEY.test(h) && !RESERVED_LINK_PARAMS.includes(h.toLowerCase()));
    const ignored = header.filter((h, i) => !known.has(i) && !extra.some((e) => e.i === i));
    const errors: Array<{ row: number; message: string }> = [];
    const seen = new Set<string>();
    type Row = { email: string | null; phone: string | null; name: string | null; language: string | null; fields: Record<string, string> };
    const good: Row[] = [];
    rows.slice(1).forEach((r, k) => {
      const rawEmail = iEmail >= 0 ? (r[iEmail] ?? '').trim().toLowerCase() : '';
      const rawPhone = iPhone >= 0 ? (r[iPhone] ?? '').trim() : '';
      if (!rawEmail && !rawPhone) return void errors.push({ row: k + 2, message: 'No email or phone number' });
      if (rawEmail && (!EMAIL.test(rawEmail) || rawEmail.length > 254))
        return void errors.push({ row: k + 2, message: `"${rawEmail.slice(0, 80)}" is not an email address` });
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      if (rawPhone && !phone)
        return void errors.push({ row: k + 2, message: `"${rawPhone.slice(0, 40)}" is not a phone number with a country code (+44...)` });
      const key = rawEmail || phone!;
      if (seen.has(key) || (rawEmail && phone && seen.has(phone))) return void errors.push({ row: k + 2, message: `${key} appears twice` });
      seen.add(key);
      if (phone) seen.add(phone);
      const fields = Object.fromEntries(extra.map(({ h, i }) => [h, (r[i] ?? '').trim().slice(0, 200)]).filter(([, v]) => v));
      const lang = iLang >= 0 ? (r[iLang] ?? '').trim() : '';
      good.push({
        email: rawEmail || null,
        phone,
        name: iName >= 0 ? (r[iName] ?? '').trim().slice(0, 200) || null : null,
        language: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang) ? lang : null,
        fields,
      });
    });
    const existing = await this.prisma.contact.count({ where: { surveyId } });
    if (existing + good.length > MAX_CONTACTS) throw new BadRequestException(`A survey can have at most ${MAX_CONTACTS} contacts`);
    let added = 0;
    let updated = 0;
    for (let i = 0; i < good.length; i += 500) {
      const chunk = good.slice(i, i + 500);
      const emails = chunk.flatMap((c) => (c.email ? [c.email] : []));
      const phones = chunk.flatMap((c) => (c.phone ? [c.phone] : []));
      const matches = await this.prisma.contact.findMany({
        where: { surveyId, OR: [{ email: { in: emails } }, { phone: { in: phones } }] },
        select: { id: true, email: true, phone: true },
      });
      const find = (c: Row) =>
        (c.email ? matches.find((m) => m.email === c.email) : undefined) ??
        (c.phone ? matches.find((m) => m.phone === c.phone) : undefined);
      const fresh = chunk.filter((c) => !find(c));
      if (fresh.length) {
        const n = await this.prisma.contact.createMany({
          data: fresh.map((c) => ({ ...c, fields: c.fields as Prisma.InputJsonValue, tenantId: user.tenantId, surveyId })),
          skipDuplicates: true,
        });
        added += n.count;
      }
      // Re-importing updates names, numbers and columns, but never resubscribes someone who opted out.
      for (const c of chunk) {
        const m = find(c);
        if (!m) continue;
        const clash = c.phone && c.phone !== m.phone ? await this.prisma.contact.findFirst({ where: { surveyId, phone: c.phone } }) : null;
        await this.prisma.contact.update({
          where: { id: m.id },
          data: {
            name: c.name,
            language: c.language,
            fields: c.fields as Prisma.InputJsonValue,
            ...(c.email && !m.email ? { email: c.email } : {}),
            ...(c.phone && !clash ? { phone: c.phone } : {}),
          },
        });
        updated++;
      }
    }
    await this.audit.record(user, 'contacts.import', 'survey', surveyId, { added, updated, errors: errors.length });
    return { added, updated, errors: errors.slice(0, 50), ignoredColumns: ignored };
  }

  async deleteContacts(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const sent = await this.prisma.invitation.count({ where: { distribution: { surveyId } } });
    // Keep contacts that were invited, so the wave history and opt-outs stay true; remove the rest.
    const invited = sent
      ? (await this.prisma.invitation.findMany({ where: { distribution: { surveyId } }, select: { contactId: true } })).map(
          (i) => i.contactId,
        )
      : [];
    const n = await this.prisma.contact.deleteMany({ where: { surveyId, tenantId: user.tenantId, id: { notIn: invited } } });
    await this.audit.record(user, 'contacts.delete', 'survey', surveyId, { deleted: n.count, kept: invited.length });
    return { deleted: n.count, kept: new Set(invited).size };
  }

  // ---- Waves --------------------------------------------------------------------------------------

  async waves(user: AuthUser, surveyId: string) {
    await this.survey(user, surveyId);
    const rows = await this.prisma.distribution.findMany({
      where: { surveyId, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const stats = await this.prisma.invitation.groupBy({
      by: ['distributionId', 'state'],
      where: { distributionId: { in: rows.map((r) => r.id) } },
      _count: true,
    });
    const reminded = await this.prisma.invitation.groupBy({
      by: ['distributionId'],
      where: { distributionId: { in: rows.map((r) => r.id) }, sends: { gt: 1 } },
      _count: true,
    });
    const responded = await this.respondedByWave(rows.map((r) => r.id));
    return {
      emailEnabled: !!emailProvider(),
      smsEnabled: !!smsProvider(),
      items: rows.map((d) => {
        const n = (s: string) => stats.find((x) => x.distributionId === d.id && x.state === s)?._count ?? 0;
        return {
          id: d.id,
          name: d.name,
          channel: d.channel.toLowerCase(),
          subject: d.subject,
          body: d.body,
          sendAt: d.sendAt,
          sentAt: d.sentAt,
          reminderDays: d.reminderDays,
          maxReminders: d.maxReminders,
          reminderSubject: d.reminderSubject,
          state: d.state.toLowerCase(),
          invited: n('QUEUED') + n('SENT') + n('FAILED') + n('SKIPPED'),
          sent: n('SENT'),
          queued: n('QUEUED'),
          failed: n('FAILED'),
          reminded: reminded.find((x) => x.distributionId === d.id)?._count ?? 0,
          started: responded.get(d.id)?.started ?? 0,
          completed: responded.get(d.id)?.completed ?? 0,
        };
      }),
    };
  }

  private async respondedByWave(ids: string[]) {
    const out = new Map<string, { started: number; completed: number }>();
    if (!ids.length) return out;
    const rows = await this.prisma.$queryRaw<Array<{ distributionId: string; started: bigint; completed: bigint }>>`
      SELECT i."distributionId", COUNT(r.id) AS started, COUNT(r.id) FILTER (WHERE r.status = 'COMPLETE') AS completed
      FROM "Invitation" i JOIN "Distribution" d ON d.id = i."distributionId"
      JOIN "Response" r ON r."surveyId" = d."surveyId" AND r.uid = i.uid
      WHERE i."distributionId" = ANY(${ids}) GROUP BY i."distributionId"`;
    for (const r of rows) out.set(r.distributionId, { started: Number(r.started), completed: Number(r.completed) });
    return out;
  }

  async createWave(user: AuthUser, surveyId: string, input: WaveInput) {
    const s = await this.survey(user, surveyId);
    if (!input.body.includes('[link]')) throw new BadRequestException('Put [link] in the message where the personal survey link goes');
    if (input.channel === 'SMS' && input.body.length > MAX_SMS_BODY)
      throw new BadRequestException(`Keep a text message under ${MAX_SMS_BODY} characters (the link is added to that)`);
    if (input.maxReminders > 0 && input.reminderDays < 1) throw new BadRequestException('Reminders need a number of days between emails');
    if (s.status === 'CLOSED' || s.deletedAt) throw new BadRequestException('This survey is closed');
    // Invitation links enter through a built-in source of the project, like any panel source.
    await this.prisma.vendor.upsert({
      where: { projectId_code: { projectId: s.projectId, code: EMAIL_SOURCE } },
      create: {
        tenantId: user.tenantId,
        projectId: s.projectId,
        code: EMAIL_SOURCE,
        name: 'Invitations',
        secret: randomBytes(32).toString('hex'),
      },
      update: { deletedAt: null },
    });
    const d = await this.prisma.distribution.create({
      data: { ...input, tenantId: user.tenantId, surveyId, createdById: user.id },
    });
    await this.audit.record(user, 'distribution.create', 'survey', surveyId, { distributionId: d.id, sendAt: d.sendAt.toISOString() });
    return { id: d.id };
  }

  async cancelWave(user: AuthUser, surveyId: string, id: string) {
    await this.survey(user, surveyId);
    const n = await this.prisma.distribution.updateMany({
      where: { id, surveyId, tenantId: user.tenantId, state: { in: ['SCHEDULED', 'SENDING', 'SENT'] } },
      data: { state: 'CANCELLED' },
    });
    if (!n.count) throw new NotFoundException('Wave not found');
    // Nothing more goes out: queued emails are skipped and reminders stop.
    await this.prisma.invitation.updateMany({ where: { distributionId: id, state: 'QUEUED' }, data: { state: 'SKIPPED' } });
    await this.prisma.invitation.updateMany({ where: { distributionId: id }, data: { nextReminderAt: null } });
    await this.audit.record(user, 'distribution.cancel', 'survey', surveyId, { distributionId: id });
  }

  /** Personal links of a wave as CSV, for sending with another tool. */
  async linksCsv(user: AuthUser, surveyId: string, id: string): Promise<string> {
    await this.survey(user, surveyId);
    const d = await this.prisma.distribution.findFirst({ where: { id, surveyId, tenantId: user.tenantId } });
    if (!d) throw new NotFoundException('Wave not found');
    await this.invite(d);
    const inv = await this.prisma.invitation.findMany({ where: { distributionId: id }, orderBy: { createdAt: 'asc' } });
    const contacts = await this.prisma.contact.findMany({ where: { id: { in: inv.map((i) => i.contactId) } } });
    const esc = (v: string) =>
      /[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v;
    const lines = ['email,phone,name,link,unsubscribed'];
    for (const i of inv) {
      const c = contacts.find((x) => x.id === i.contactId);
      if (c)
        lines.push(
          [c.email ?? '', c.phone ?? '', c.name ?? '', personalLink(surveyId, i.uid, c), c.unsubscribedAt ? 'yes' : 'no']
            .map(esc)
            .join(','),
        );
    }
    await this.audit.record(user, 'distribution.links', 'survey', surveyId, { distributionId: id, rows: inv.length });
    return lines.join('\r\n') + '\r\n';
  }

  // ---- Unsubscribe (public) -----------------------------------------------------------------------

  async unsubscribe(uid: string): Promise<boolean> {
    const inv = await this.prisma.invitation.findUnique({ where: { uid } });
    if (!inv) return false;
    await this.prisma.contact.updateMany({ where: { id: inv.contactId, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
    await this.prisma.invitation.updateMany({ where: { contactId: inv.contactId }, data: { nextReminderAt: null } });
    return true;
  }

  // ---- Sending (worker) ---------------------------------------------------------------------------

  /** Create the invitations of a wave (idempotent): one per reachable contact who has not opted out. */
  private async invite(d: Distribution) {
    const contacts = await this.prisma.contact.findMany({
      where: { surveyId: d.surveyId, unsubscribedAt: null, ...(d.channel === 'SMS' ? { phone: { not: null } } : { email: { not: null } }) },
      select: { id: true },
    });
    for (let i = 0; i < contacts.length; i += 1000)
      await this.prisma.invitation.createMany({
        data: contacts.slice(i, i + 1000).map((c) => ({
          tenantId: d.tenantId,
          distributionId: d.id,
          contactId: c.id,
          uid: `inv-${randomBytes(15).toString('base64url')}`,
        })),
        skipDuplicates: true,
      });
  }

  /** One pass of the sender: start due waves, send queued invitations, send due reminders. */
  async pass(
    provider: EmailProvider | null = emailProvider(),
    now = new Date(),
    sms: SmsProvider | null = smsProvider(),
  ): Promise<{ sent: number; failed: number; reminded: number }> {
    const out = { sent: 0, failed: 0, reminded: 0 };
    // A channel whose sending is off waits (a wave can still be used for its personal links).
    const channels = [...(provider ? (['EMAIL'] as const) : []), ...(sms ? (['SMS'] as const) : [])];
    if (!channels.length) return out;
    const senders = { email: provider, sms };
    const channel = { in: channels };
    for (const d of await this.prisma.distribution.findMany({ where: { state: 'SCHEDULED', sendAt: { lte: now }, channel }, take: 20 })) {
      const claimed = await this.prisma.distribution.updateMany({ where: { id: d.id, state: 'SCHEDULED' }, data: { state: 'SENDING' } });
      if (claimed.count) await this.invite(d);
    }
    const sending = await this.prisma.distribution.findMany({ where: { state: 'SENDING', channel }, take: 20 });
    for (const d of sending) {
      const batch = await this.prisma.invitation.findMany({ where: { distributionId: d.id, state: 'QUEUED' }, take: SEND_BATCH });
      for (const inv of batch) {
        const r = await this.deliver(senders, d, inv, false, now);
        if (r === 'sent') out.sent++;
        else if (r === 'failed') out.failed++;
      }
      if (!(await this.prisma.invitation.count({ where: { distributionId: d.id, state: 'QUEUED' } })))
        await this.prisma.distribution.updateMany({ where: { id: d.id, state: 'SENDING' }, data: { state: 'SENT', sentAt: now } });
    }
    const due = await this.prisma.invitation.findMany({
      where: { nextReminderAt: { lte: now }, state: 'SENT', distribution: { state: { in: ['SENDING', 'SENT'] }, channel } },
      include: { distribution: true },
      take: SEND_BATCH,
    });
    for (const inv of due) {
      if (
        await this.prisma.response.findFirst({
          where: { surveyId: inv.distribution.surveyId, uid: inv.uid, status: { in: [...FINISHED] } },
        })
      ) {
        await this.prisma.invitation.update({ where: { id: inv.id }, data: { nextReminderAt: null } });
        continue;
      }
      if ((await this.deliver(senders, inv.distribution, inv, true, now)) === 'sent') out.reminded++;
    }
    return out;
  }

  private async deliver(
    senders: { email: EmailProvider | null; sms: SmsProvider | null },
    d: Distribution,
    inv: Invitation,
    reminder: boolean,
    now: Date,
  ): Promise<'sent' | 'failed' | 'skipped'> {
    // Claim first, so two workers never send the same email.
    const claim = reminder
      ? await this.prisma.invitation.updateMany({
          where: { id: inv.id, nextReminderAt: inv.nextReminderAt },
          data: { nextReminderAt: null },
        })
      : await this.prisma.invitation.updateMany({ where: { id: inv.id, state: 'QUEUED' }, data: { state: 'SENT' } });
    if (!claim.count) return 'skipped';
    const contact = await this.prisma.contact.findUnique({ where: { id: inv.contactId } });
    if (!contact || contact.unsubscribedAt || (d.channel === 'SMS' ? !contact.phone : !contact.email)) {
      await this.prisma.invitation.update({ where: { id: inv.id }, data: { state: reminder ? 'SENT' : 'SKIPPED', nextReminderAt: null } });
      return 'skipped';
    }
    const sends = inv.sends + 1;
    try {
      if (d.channel === 'SMS') await senders.sms!.send(composeSms(d, inv, contact, reminder), AbortSignal.timeout(20_000));
      else await senders.email!.send(composeEmail(d, inv, contact, reminder), AbortSignal.timeout(20_000));
      const more = d.maxReminders > 0 && sends - 1 < d.maxReminders && d.reminderDays > 0;
      await this.prisma.invitation.update({
        where: { id: inv.id },
        data: { sends, lastSentAt: now, error: null, nextReminderAt: more ? new Date(now.getTime() + d.reminderDays * DAY_MS) : null },
      });
      return 'sent';
    } catch (e) {
      this.log.warn(`${d.channel === 'SMS' ? 'SMS' : 'Email'} to invitation ${inv.id} failed: ${(e as Error).message}`);
      await this.prisma.invitation.update({
        where: { id: inv.id },
        data: reminder ? { error: (e as Error).message.slice(0, 300) } : { state: 'FAILED', error: (e as Error).message.slice(0, 300) },
      });
      return 'failed';
    }
  }
}

export function personalLink(surveyId: string, uid: string, contact: Pick<Contact, 'fields' | 'language'>): string {
  const q = new URLSearchParams({ vid: EMAIL_SOURCE, uid });
  if (contact.language) q.set('lang', contact.language);
  const fields = (contact.fields && typeof contact.fields === 'object' ? contact.fields : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(fields)) if (typeof v === 'string' && !RESERVED_LINK_PARAMS.includes(k.toLowerCase())) q.set(k, v);
  return `${config().RUNTIME_BASE_URL.replace(/\/$/, '')}/s/${encodeURIComponent(surveyId)}?${q}`;
}

export function unsubscribeLink(uid: string): string {
  return `${config().RUNTIME_BASE_URL.replace(/\/$/, '')}/api/public/unsubscribe/${encodeURIComponent(uid)}`;
}

export function composeEmail(
  d: Pick<Distribution, 'subject' | 'body' | 'reminderSubject' | 'surveyId'>,
  inv: Pick<Invitation, 'uid'>,
  c: Contact,
  reminder: boolean,
) {
  const link = personalLink(d.surveyId, inv.uid, c);
  const unsubscribeUrl = unsubscribeLink(inv.uid);
  let text = d.body
    .replaceAll('[link]', link)
    .replaceAll('[name]', c.name ?? '')
    .replaceAll('[unsubscribe]', unsubscribeUrl);
  if (!d.body.includes('[unsubscribe]')) text += `\n\n--\nTo stop receiving these emails: ${unsubscribeUrl}`;
  const subject = reminder ? d.reminderSubject?.trim() || `Reminder: ${d.subject}` : d.subject;
  return { to: { email: c.email ?? '', name: c.name }, subject: subject.replaceAll('[name]', c.name ?? '').trim(), text, unsubscribeUrl };
}

/** Blueprint phase 5: the text message of an SMS wave. The opt-out link is added unless the body has [unsubscribe]. */
export function composeSms(d: Pick<Distribution, 'body' | 'surveyId'>, inv: Pick<Invitation, 'uid'>, c: Contact, reminder: boolean) {
  const unsubscribeUrl = unsubscribeLink(inv.uid);
  let text = d.body
    .replaceAll('[link]', personalLink(d.surveyId, inv.uid, c))
    .replaceAll('[name]', c.name ?? '')
    .replaceAll('[unsubscribe]', unsubscribeUrl);
  if (!d.body.includes('[unsubscribe]')) text += `\nStop: ${unsubscribeUrl}`;
  return { to: c.phone ?? '', text: reminder ? `Reminder: ${text}` : text };
}
