/**
 * Phone dialer for CATI (Milestone 19).
 *
 * The interviewer presses Call. SampCode asks the telephony provider to ring the interviewer's own phone;
 * when they answer, the provider asks SampCode what to do and is told to dial the respondent from the
 * organization's caller id and bridge the two. The respondent's number goes from SampCode to the provider
 * only: on surveys that use the dialer, interviewers never see it.
 *
 * - Off by default (TELEPHONY=off), and off per survey until a programmer turns it on.
 * - Recording is a separate per-survey choice. The respondent hears a notice before the call is
 *   connected. The recording is copied into SampCode as a private capture of the interview (same access,
 *   retention and erasure as CAPI recordings) and then deleted at the provider. A call without an
 *   interview keeps no recording.
 * - Provider: Twilio Programmable Voice (REST API + TwiML webhooks signed with X-Twilio-Signature).
 *   Another provider is one class plus its webhook routes.
 *
 * Tested against a local stand-in of the Twilio API only.
 */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CatiDial } from '@zapx/db';
import { config } from '../config';
import { integration } from '../platform/integrations';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SecretBox } from '../platform/secret-box';
import { CaptureService, checkCapture } from '../captures/capture.service';
import type { AuthUser } from '../auth/auth.types';
import { CatiService, normalizePhone } from './cati.service';
import { phoneHash } from './calling-rules';

export class TelephonyError extends Error {}

export interface PlaceCall {
  to: string;
  from: string;
  /** Asked for instructions when the interviewer answers. */
  answerUrl: string;
  /** Told about the interviewer's call status. */
  statusUrl: string;
  ringSeconds: number;
}

export interface TelephonyProvider {
  readonly name: string;
  placeCall(c: PlaceCall): Promise<{ callId: string; status: string }>;
  hangUp(callId: string): Promise<void>;
  fetchRecording(recordingId: string): Promise<Buffer>;
  deleteRecording(recordingId: string): Promise<void>;
}

/** Calls the provider reports as over. */
const ENDED = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);
const ACTIVE = ['queued', 'initiated', 'ringing', 'in-progress'];
const TWILIO_SID = /^[A-Z]{2}[0-9a-f]{32}$/;

export const DEFAULT_NOTICE = 'This call is recorded for quality and research purposes.';

/** Twilio Programmable Voice: https://www.twilio.com/docs/voice/api */
export class TwilioProvider implements TelephonyProvider {
  readonly name = 'twilio';
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly base: string,
  ) {}

  private url(path: string) {
    return `${this.base.replace(/\/$/, '')}/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}${path}`;
  }

  private async send(method: string, path: string, form?: URLSearchParams): Promise<Response> {
    const res = await fetch(this.url(path), {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    }).catch((e: Error) => {
      throw new TelephonyError(`Could not reach Twilio (${e.message})`);
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
      throw new TelephonyError(`Twilio refused: ${body.message ?? `HTTP ${res.status}`}${body.code ? ` (error ${body.code})` : ''}`);
    }
    return res;
  }

  async placeCall(c: PlaceCall) {
    const form = new URLSearchParams({
      To: c.to,
      From: c.from,
      Url: c.answerUrl,
      Method: 'POST',
      StatusCallback: c.statusUrl,
      StatusCallbackMethod: 'POST',
      Timeout: String(c.ringSeconds),
    });
    for (const e of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', e);
    const body = (await (await this.send('POST', '/Calls.json', form)).json()) as { sid?: string; status?: string };
    if (!body.sid) throw new TelephonyError('Twilio answered without a call id');
    return { callId: body.sid, status: body.status ?? 'queued' };
  }

  async hangUp(callId: string) {
    await this.send('POST', `/Calls/${encodeURIComponent(callId)}.json`, new URLSearchParams({ Status: 'completed' }));
  }

  async fetchRecording(recordingId: string) {
    if (!TWILIO_SID.test(recordingId)) throw new TelephonyError('Not a Twilio recording id');
    return Buffer.from(await (await this.send('GET', `/Recordings/${recordingId}.mp3`)).arrayBuffer());
  }

  async deleteRecording(recordingId: string) {
    if (!TWILIO_SID.test(recordingId)) throw new TelephonyError('Not a Twilio recording id');
    await this.send('DELETE', `/Recordings/${recordingId}.json`);
  }
}

/**
 * X-Twilio-Signature: base64 HMAC-SHA1, keyed with the auth token, of the full URL Twilio called
 * followed by every POST parameter name and value, sorted by name.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, unknown>): string {
  let data = url;
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    for (const one of Array.isArray(v) ? v : [v]) data += k + String(one ?? '');
  }
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
const twiml = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const sayAndHangUp = (text: string) => twiml(`<Say>${xml(text)}</Say><Hangup/>`);

@Injectable()
export class TelephonyService {
  private readonly log = new Logger('Telephony');
  private provider: TelephonyProvider | null | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly secrets: SecretBox,
    private readonly cati: CatiService,
    private readonly captures: CaptureService,
  ) {}

  /** For tests: use this provider instead of the configured one. */
  useProvider(p: TelephonyProvider | null) {
    this.provider = p;
  }

  /** Built from Settings > Integrations (or TELEPHONY and TWILIO_*), rebuilt when they change. */
  private built?: { fingerprint: string; provider: TelephonyProvider | null };

  current(): TelephonyProvider | null {
    if (this.provider !== undefined) return this.provider;
    const s = integration('twilio');
    if (this.built?.fingerprint !== s.fingerprint)
      this.built = {
        fingerprint: s.fingerprint,
        provider: s.enabled ? new TwilioProvider(s.values.accountSid!, s.values.authToken!, config().TWILIO_API_BASE) : null,
      };
    return this.built.provider;
  }

  private hook(name: string, dialId: string) {
    return `${integration('twilio').values.webhookBase!.replace(/\/$/, '')}/telephony/twilio/${name}?d=${encodeURIComponent(dialId)}`;
  }

  // ---- Settings ----------------------------------------------------------------------------------

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phoneHint: true } });
    return { dialerAvailable: !!this.current(), phoneHint: u.phoneHint ? `…${u.phoneHint}` : null };
  }

  /** The interviewer's own phone, which the dialer rings. Stored sealed, like respondents' numbers. */
  async setMyPhone(user: AuthUser, raw: string | null) {
    if (raw === null) {
      await this.prisma.user.update({ where: { id: user.id }, data: { phoneSealed: null, phoneHint: null } });
    } else {
      const phone = normalizePhone(raw);
      if (!phone?.startsWith('+'))
        throw new BadRequestException('Enter the number in international form, starting with + and the country code');
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneSealed: this.secrets.seal(phone), phoneHint: phone.slice(-3) },
      });
    }
    await this.audit.record(user, raw === null ? 'cati.my_phone_clear' : 'cati.my_phone_set', 'user', user.id, {});
    return this.me(user);
  }

  async dialer(user: AuthUser, surveyId: string) {
    await this.cati.surveyFor(user, surveyId);
    const d = await this.prisma.catiDialer.findUnique({ where: { surveyId } });
    return {
      available: !!this.current(),
      enabled: !!d?.enabled && !!this.current(),
      recordCalls: !!d?.recordCalls,
      recordingNotice: d?.recordingNotice ?? DEFAULT_NOTICE,
    };
  }

  async setDialer(user: AuthUser, surveyId: string, input: { enabled: boolean; recordCalls: boolean; recordingNotice?: string }) {
    const survey = await this.cati.surveyFor(user, surveyId);
    if (input.enabled && !this.current())
      throw new ConflictException('The phone dialer is not set up for this installation (Twilio is off in Settings > Integrations).');
    const notice = input.recordingNotice?.trim().slice(0, 300) || null;
    const data = { enabled: input.enabled, recordCalls: input.recordCalls, recordingNotice: notice };
    await this.prisma.catiDialer.upsert({ where: { surveyId }, create: { surveyId, tenantId: survey.tenantId, ...data }, update: data });
    await this.audit.record(user, 'cati.dialer_set', 'survey', surveyId, { enabled: data.enabled, recordCalls: data.recordCalls });
    return this.dialer(user, surveyId);
  }

  // ---- Calls -------------------------------------------------------------------------------------

  /** Ring the interviewer's phone for their open case; the respondent is dialled when they answer. */
  async dial(user: AuthUser, caseId: string) {
    const provider = this.current();
    if (!provider) throw new ServiceUnavailableException('The phone dialer is not set up for this installation.');
    const c = await this.cati.openCase(user, caseId);
    const settings = await this.prisma.catiDialer.findUnique({ where: { surveyId: c.surveyId } });
    if (!settings?.enabled) throw new ConflictException('This survey does not use the dialer. Dial the number yourself.');
    if (!c.phoneSealed) throw new ConflictException('The phone number of this case was erased');
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phoneSealed: true } });
    if (!me.phoneSealed) throw new ConflictException('Add the phone number the dialer should ring for you first.');
    const active = await this.prisma.catiDial.findFirst({
      where: { caseId: c.id, status: { in: ACTIVE }, createdAt: { gt: new Date(Date.now() - 2 * 3_600_000) } },
    });
    if (active) throw new ConflictException('A call for this case is already in progress. Hang up first.');
    const dial = await this.prisma.catiDial.create({
      data: {
        id: randomBytes(16).toString('base64url'),
        tenantId: c.tenantId,
        surveyId: c.surveyId,
        caseId: c.id,
        interviewerId: user.id,
        provider: provider.name,
        record: settings.recordCalls,
      },
    });
    const cfg = config();
    try {
      const placed = await provider.placeCall({
        to: this.secrets.open(me.phoneSealed),
        from: integration('twilio').values.callerId!,
        answerUrl: this.hook('answer', dial.id),
        statusUrl: this.hook('status', dial.id),
        ringSeconds: cfg.TELEPHONY_RING_SECONDS,
      });
      const updated = await this.prisma.catiDial.update({
        where: { id: dial.id },
        data: { providerCallId: placed.callId, status: placed.status },
      });
      await this.audit.record(user, 'cati.dial', 'survey', c.surveyId, { caseId: c.id, dialId: dial.id, record: dial.record });
      return this.present(updated);
    } catch (e) {
      const reason = e instanceof TelephonyError ? e.message : 'The call could not be placed';
      await this.prisma.catiDial.update({ where: { id: dial.id }, data: { status: 'failed', error: reason, endedAt: new Date() } });
      if (e instanceof TelephonyError) throw new BadGatewayException(reason);
      throw e;
    }
  }

  /** The latest call the interviewer placed for this case. */
  async latest(user: AuthUser, caseId: string) {
    const c = await this.cati.openCase(user, caseId);
    const d = await this.prisma.catiDial.findFirst({ where: { caseId: c.id, interviewerId: user.id }, orderBy: { createdAt: 'desc' } });
    return d ? this.present(d) : null;
  }

  async hangUp(user: AuthUser, dialId: string) {
    const d = await this.prisma.catiDial.findFirst({ where: { id: dialId, tenantId: user.tenantId, interviewerId: user.id } });
    if (!d) throw new NotFoundException('Call not found');
    const provider = this.current();
    if (provider && d.providerCallId && !ENDED.has(d.status)) {
      try {
        await provider.hangUp(d.providerCallId);
      } catch (e) {
        if (e instanceof TelephonyError) throw new BadGatewayException(e.message);
        throw e;
      }
    }
    await this.audit.record(user, 'cati.hang_up', 'survey', d.surveyId, { dialId: d.id });
    return this.present(await this.prisma.catiDial.findUniqueOrThrow({ where: { id: d.id } }));
  }

  private present(d: CatiDial) {
    return {
      id: d.id,
      status: d.status,
      respondentStatus: d.respondentStatus,
      talkSeconds: d.talkSeconds,
      record: d.record,
      recordingStatus: d.recordingStatus,
      error: d.error,
      createdAt: d.createdAt,
      endedAt: d.endedAt,
    };
  }

  // ---- Twilio webhooks -----------------------------------------------------------------------------

  /** Check X-Twilio-Signature against the address Twilio was given (the webhook base in Settings > Integrations). */
  verifyTwilio(pathAndQuery: string, params: Record<string, unknown>, signature: string | undefined): boolean {
    const s = integration('twilio');
    if (!s.enabled || !signature) return false;
    // pathAndQuery is the request's address below /api, e.g. /telephony/twilio/answer?d=...
    const url = `${s.values.webhookBase!.replace(/\/$/, '')}${pathAndQuery}`;
    const expected = Buffer.from(twilioSignature(s.values.authToken!, url, params));
    const got = Buffer.from(signature);
    return expected.length === got.length && timingSafeEqual(expected, got);
  }

  private async dialById(dialId: string) {
    return typeof dialId === 'string' && dialId ? this.prisma.catiDial.findUnique({ where: { id: dialId } }) : null;
  }

  /** The interviewer answered: dial the respondent and bridge, unless the case is no longer theirs. */
  async onAnswer(dialId: string): Promise<string> {
    const d = await this.dialById(dialId);
    if (!d) return sayAndHangUp('This call is not known.');
    const c = await this.prisma.catiCase.findUnique({ where: { id: d.caseId } });
    const settings = await this.prisma.catiDialer.findUnique({ where: { surveyId: d.surveyId } });
    const fail = async (reason: string) => {
      await this.prisma.catiDial.update({ where: { id: d.id }, data: { error: reason } });
      return sayAndHangUp(reason);
    };
    if (!c || c.status !== 'IN_CALL' || c.lockedById !== d.interviewerId || !c.lockedUntil || c.lockedUntil < new Date())
      return fail('This case is no longer open for you.');
    if (!settings?.enabled) return fail('This survey no longer uses the dialer.');
    if (!c.phoneSealed) return fail('The phone number of this case was erased.');
    const phone = this.secrets.open(c.phoneSealed);
    // The do-not-call list is checked again at the moment of dialling.
    const listed = await this.prisma.doNotCall.findUnique({
      where: { tenantId_phoneHash: { tenantId: c.tenantId, phoneHash: phoneHash(c.tenantId, phone) } },
    });
    if (listed) return fail('This number is on the do-not-call list.');
    const cfg = config();
    const record = d.record && settings.recordCalls;
    const dialAttrs = [
      `callerId="${xml(integration('twilio').values.callerId!)}"`,
      `timeout="${cfg.TELEPHONY_RING_SECONDS}"`,
      'answerOnBridge="true"',
      `action="${xml(this.hook('bridged', d.id))}"`,
      'method="POST"',
      ...(record
        ? [
            'record="record-from-answer-dual"',
            `recordingStatusCallback="${xml(this.hook('recording', d.id))}"`,
            'recordingStatusCallbackMethod="POST"',
            'recordingStatusCallbackEvent="completed"',
          ]
        : []),
    ].join(' ');
    // With recording on, the respondent hears the notice when they answer, before being connected.
    const number = record
      ? `<Number url="${xml(this.hook('notice', d.id))}" method="POST">${xml(phone)}</Number>`
      : `<Number>${xml(phone)}</Number>`;
    if (record !== d.record) await this.prisma.catiDial.update({ where: { id: d.id }, data: { record } });
    return twiml(`<Say>Connecting.</Say><Dial ${dialAttrs}>${number}</Dial>`);
  }

  /** Read to the respondent once they answer, before the call is connected (recorded calls only). */
  async onNotice(dialId: string): Promise<string> {
    const d = await this.dialById(dialId);
    const settings = d ? await this.prisma.catiDialer.findUnique({ where: { surveyId: d.surveyId } }) : null;
    return twiml(`<Say>${xml(settings?.recordingNotice || DEFAULT_NOTICE)}</Say>`);
  }

  /** The respondent's leg ended (Dial action): keep how it went, for the interviewer's disposition. */
  async onBridged(dialId: string, params: Record<string, unknown>): Promise<string> {
    const d = await this.dialById(dialId);
    if (d) {
      const status = String(params.DialCallStatus ?? '').slice(0, 20) || null;
      const seconds = Number(params.DialCallDuration);
      await this.prisma.catiDial.update({
        where: { id: d.id },
        data: { respondentStatus: status, talkSeconds: Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : null },
      });
    }
    return sayAndHangUp('The call has ended.');
  }

  /** The interviewer's call status changed. */
  async onStatus(dialId: string, params: Record<string, unknown>) {
    const d = await this.dialById(dialId);
    const status = String(params.CallStatus ?? '');
    if (!d || !/^[a-z-]{3,20}$/.test(status)) return;
    if (ENDED.has(d.status)) return;
    await this.prisma.catiDial.update({ where: { id: d.id }, data: { status, ...(ENDED.has(status) ? { endedAt: new Date() } : {}) } });
  }

  /** A recording is ready at the provider: copy it into SampCode, then delete it there. */
  async onRecording(dialId: string, params: Record<string, unknown>) {
    const d = await this.dialById(dialId);
    const sid = String(params.RecordingSid ?? '');
    if (!d || !d.record || !TWILIO_SID.test(sid) || String(params.RecordingStatus ?? '') !== 'completed') return;
    // Claimed atomically, so a repeated callback copies nothing twice.
    const claimed = await this.prisma.catiDial.updateMany({
      where: { id: d.id, recordingStatus: 'none' },
      data: { recordingStatus: 'pending', recordingSid: sid },
    });
    if (!claimed.count) return;
    void this.storeRecording(d.id).catch((e) => this.log.error(`Recording of call ${d.id}: ${(e as Error).message}`));
  }

  /**
   * Copy a recording into the interview's captures and delete it at the provider. A call that did not
   * lead to an interview keeps no recording. Retried by housekeeping until it works (five tries).
   */
  async storeRecording(dialId: string): Promise<string> {
    const provider = this.current();
    const d = await this.prisma.catiDial.findUnique({ where: { id: dialId } });
    if (!provider || !d || d.recordingStatus !== 'pending' || !d.recordingSid) return d?.recordingStatus ?? 'none';
    await this.prisma.catiDial.update({ where: { id: d.id }, data: { recordingTries: { increment: 1 } } });
    try {
      const c = await this.prisma.catiCase.findUnique({ where: { id: d.caseId }, select: { responseId: true } });
      if (!c?.responseId) {
        await provider.deleteRecording(d.recordingSid);
        await this.prisma.catiDial.update({ where: { id: d.id }, data: { recordingStatus: 'discarded', error: null } });
        return 'discarded';
      }
      const data = await provider.fetchRecording(d.recordingSid);
      const contentType = checkCapture('audio', data);
      const capture = await this.captures.saveCallRecording(
        { tenantId: d.tenantId, surveyId: d.surveyId, responseId: c.responseId, ref: `call-${d.id}`, uploadedById: d.interviewerId },
        data,
        contentType,
      );
      await provider.deleteRecording(d.recordingSid);
      await this.prisma.catiDial.update({ where: { id: d.id }, data: { recordingStatus: 'stored', captureId: capture.id, error: null } });
      this.log.log(`Stored recording of call ${d.id} (${data.length} bytes)`);
      return 'stored';
    } catch (e) {
      const reason = (e as Error).message.slice(0, 300);
      const tries = d.recordingTries + 1;
      // After five tries the recording is left at the provider; the reason stays on the call.
      await this.prisma.catiDial.update({
        where: { id: d.id },
        data: { error: reason, ...(tries >= 5 ? { recordingStatus: 'failed' } : {}) },
      });
      throw e;
    }
  }

  /** Housekeeping: try recordings that could not be copied yet again. */
  async retryRecordings() {
    if (!this.current()) return 0;
    const pending = await this.prisma.catiDial.findMany({ where: { recordingStatus: 'pending' }, select: { id: true }, take: 100 });
    let done = 0;
    for (const p of pending) if ((await this.storeRecording(p.id).catch(() => 'pending')) !== 'pending') done++;
    return done;
  }
}
