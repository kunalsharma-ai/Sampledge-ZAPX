/**
 * SMS sending for invitations and reminders (blueprint phase 5).
 *
 * - Off by default (SMS_PROVIDER=off): no text message leaves ZAPX.
 * - Provider: Twilio Programmable Messaging (`POST /2010-04-01/Accounts/{sid}/Messages.json`, 201
 *   when queued). Another provider is one class implementing SmsProvider.
 *
 * Tested against a local stand-in of the Twilio API only, not the live service.
 */
import { config } from '../config';

export interface OutgoingSms {
  to: string;
  text: string;
}

export class SmsError extends Error {}

export interface SmsProvider {
  readonly name: string;
  send(sms: OutgoingSms, signal: AbortSignal): Promise<void>;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly base: string,
    private readonly from: string,
  ) {}

  async send(sms: OutgoingSms, signal: AbortSignal): Promise<void> {
    const form = new URLSearchParams({ To: sms.to, Body: sms.text });
    form.set(this.from.startsWith('MG') ? 'MessagingServiceSid' : 'From', this.from);
    const url = `${this.base.replace(/\/$/, '')}/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal,
    }).catch((e: Error) => {
      throw new SmsError(`Could not reach Twilio (${e.message})`);
    });
    if (res.status !== 201 && res.status !== 200) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
      throw new SmsError(
        `Twilio refused the message: ${body.message ?? `HTTP ${res.status}`}${body.code ? ` (${body.code})` : ''}`.slice(0, 300),
      );
    }
  }
}

/** The configured provider, or null when SMS is off. */
export function smsProvider(): SmsProvider | null {
  const c = config();
  if (c.SMS_PROVIDER !== 'twilio') return null;
  return new TwilioSmsProvider(c.TWILIO_ACCOUNT_SID, c.TWILIO_AUTH_TOKEN, c.TWILIO_API_BASE, c.SMS_FROM);
}

/** Phone numbers are stored in E.164. Accepts spaces, dashes, dots and brackets; needs the leading +. */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim().replace(/[\s\-().]/g, '');
  const v = t.startsWith('00') ? `+${t.slice(2)}` : t;
  return /^\+[1-9][0-9]{6,14}$/.test(v) ? v : null;
}

/** Length of an SMS body that still fits in a few segments (GSM-7: 153 characters per segment). */
export const MAX_SMS_BODY = 600;
