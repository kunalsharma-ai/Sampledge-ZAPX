/**
 * Email sending for invitations and reminders (blueprint phase 3).
 *
 * - Off by default (EMAIL_PROVIDER=off): no email leaves ZAPX.
 * - Provider: SendGrid v3 Mail Send (`POST /v3/mail/send`, 202 when accepted). Another provider is
 *   one class implementing EmailProvider.
 *
 * Tested against a local stand-in of the SendGrid API only.
 */
import { config } from '../config';

export interface OutgoingEmail {
  to: { email: string; name?: string | null };
  subject: string;
  text: string;
  /** One-click unsubscribe (RFC 8058): the List-Unsubscribe URL that accepts a POST. Not set for emails to members. */
  unsubscribeUrl?: string;
}

export class EmailError extends Error {}

export interface EmailProvider {
  readonly name: string;
  send(mail: OutgoingEmail, signal: AbortSignal): Promise<void>;
}

export class SendGridProvider implements EmailProvider {
  readonly name = 'sendgrid';
  constructor(
    private readonly key: string,
    private readonly base: string,
    private readonly from: { email: string; name: string },
  ) {}

  async send(mail: OutgoingEmail, signal: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base.replace(/\/$/, '')}/v3/mail/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: mail.to.email, ...(mail.to.name ? { name: mail.to.name } : {}) }] }],
        from: this.from,
        subject: mail.subject,
        content: [{ type: 'text/plain', value: mail.text }],
        ...(mail.unsubscribeUrl
          ? { headers: { 'List-Unsubscribe': `<${mail.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
          : {}),
      }),
      signal,
    }).catch((e: Error) => {
      throw new EmailError(`Could not reach SendGrid (${e.message})`);
    });
    if (res.status !== 202 && res.status !== 200) {
      const body = (await res.json().catch(() => ({}))) as { errors?: Array<{ message?: string }> };
      throw new EmailError(`SendGrid refused the email: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`.slice(0, 300));
    }
  }
}

/** The configured provider, or null when sending is off. */
export function emailProvider(): EmailProvider | null {
  const c = config();
  if (c.EMAIL_PROVIDER !== 'sendgrid') return null;
  return new SendGridProvider(c.SENDGRID_API_KEY, c.SENDGRID_API_BASE, { email: c.EMAIL_FROM, name: c.EMAIL_FROM_NAME });
}
