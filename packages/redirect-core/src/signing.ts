/**
 * HMAC-SHA256 signing used across ZAPX integrations: signed entry links, signed redirects,
 * signed callbacks and authenticated vendor API requests. Comparisons are constant-time.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendQuery } from './template';

export const hmacHex = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('hex');

export function safeEqualHex(expectedHex: string, givenHex: string | undefined | null): boolean {
  if (!givenHex || !/^[0-9a-f]+$/i.test(givenHex)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(givenHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Default tolerance for signed timestamps, matching PROJEXA's S2S contract. */
export const SIGNATURE_WINDOW_SECONDS = 300;

export const unixSeconds = (nowMs = Date.now()) => Math.floor(nowMs / 1000);

export function withinWindow(
  timestamp: string | number | undefined,
  nowMs = Date.now(),
  windowSeconds = SIGNATURE_WINDOW_SECONDS,
): boolean {
  const ts = Number(timestamp);
  return Number.isInteger(ts) && Math.abs(unixSeconds(nowMs) - ts) <= windowSeconds;
}

/**
 * Signed redirect: appends `zts` (unix seconds) and `zsig` = HMAC(secret, url-including-zts).
 * The vendor recomputes the HMAC over everything before `&zsig=`.
 */
export function signRedirectUrl(url: string, secret: string, nowMs = Date.now()): string {
  const stamped = appendQuery(url, 'zts', String(unixSeconds(nowMs)));
  return appendQuery(stamped, 'zsig', hmacHex(secret, stamped));
}

export function verifySignedRedirectUrl(url: string, secret: string, nowMs = Date.now()): boolean {
  const i = url.lastIndexOf('&zsig=');
  if (i < 0) return false;
  const signed = url.slice(0, i);
  const zts = new URL(signed).searchParams.get('zts') ?? undefined;
  return withinWindow(zts, nowMs, 24 * 3600) && safeEqualHex(hmacHex(secret, signed), url.slice(i + 6));
}

// ---- Signed entry links -----------------------------------------------------------------------

/** Canonical string that is signed: every parameter except `sig`, sorted by name. */
export function canonicalParams(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sig')
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`)
    .join('&');
}

export const signParams = (params: Record<string, string>, secret: string) => hmacHex(secret, canonicalParams(params));

/** Verify `sig` (and `exp`, unix seconds, when present). */
export function verifySignedParams(
  params: Record<string, string>,
  secret: string,
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const sig = params.sig;
  if (!sig || !/^[0-9a-f]{64}$/i.test(sig)) return { ok: false, reason: 'missing_or_malformed_signature' };
  if (!safeEqualHex(signParams(params, secret), sig)) return { ok: false, reason: 'bad_signature' };
  if (params.exp !== undefined) {
    const exp = Number(params.exp);
    if (!Number.isFinite(exp) || exp * 1000 < nowMs) return { ok: false, reason: 'link_expired' };
  }
  return { ok: true };
}

// ---- Authenticated partner requests (vendor API) ----------------------------------------------

/** String a vendor signs to call the ZAPX vendor API: `timestamp.METHOD.path?query`. */
export const requestSigningString = (timestamp: string | number, method: string, pathWithQuery: string) =>
  `${timestamp}.${method.toUpperCase()}.${pathWithQuery}`;

export function signRequest(secret: string, method: string, pathWithQuery: string, nowMs = Date.now()) {
  const timestamp = String(unixSeconds(nowMs));
  return { timestamp, signature: hmacHex(secret, requestSigningString(timestamp, method, pathWithQuery)) };
}

export function verifyRequest(
  secret: string,
  input: { method: string; pathWithQuery: string; timestamp?: string; signature?: string },
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: 'stale_timestamp' | 'bad_signature' } {
  if (!withinWindow(input.timestamp, nowMs)) return { ok: false, reason: 'stale_timestamp' };
  const expected = hmacHex(secret, requestSigningString(input.timestamp!, input.method, input.pathWithQuery));
  return safeEqualHex(expected, input.signature) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
