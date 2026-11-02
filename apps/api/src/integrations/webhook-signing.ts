/**
 * Webhook signatures (Milestone 6). Each delivery carries
 *   X-Zapx-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * Receivers recompute the HMAC over the raw body, compare in constant time and reject old
 * timestamps (docs/modules/webhooks.md has a verification example).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-Zapx-Signature';
export const DEFAULT_TOLERANCE_S = 300;

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

export function signWebhook(secret: string, body: string, timestampS: number): string {
  const v1 = createHmac('sha256', secret).update(`${timestampS}.${body}`).digest('hex');
  return `t=${timestampS},v1=${v1}`;
}

export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  nowS = Math.floor(Date.now() / 1000),
  toleranceS = DEFAULT_TOLERANCE_S,
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(nowS - t) > toleranceS) return false;
  const expected = Buffer.from(signWebhook(secret, body, t).split('v1=')[1]!, 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
