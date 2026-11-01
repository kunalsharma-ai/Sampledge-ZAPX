/**
 * Redirect engine: builds the URL a respondent is sent to when the interview ends.
 *
 * Three modes per vendor:
 *   STATIC  – fixed URL per outcome, configured on the vendor (e.g. the Sampledge platform URLs).
 *   DYNAMIC – the vendor passes a return URL on the survey link (e.g. ...&rurl=https%3A%2F%2F...).
 *             It must be on the vendor's allowed hosts, which prevents open redirects.
 *   HYBRID  – use the dynamic URL when one was supplied and valid, otherwise the static URL.
 *
 * Placeholders, case-insensitive, URL-encoded on substitution:
 *   [UID] respondent id · [VID] vendor code · [CC] country · [STATUS] status word
 *   [RID] ZAPX response id · [param:name] any extra parameter from the entry link
 *
 * This is deliberately a small, pure module behind the RedirectService interface so it can be
 * replaced by a shared Sampledge redirect service (PROJEXA) without touching the interview flow.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OutcomeStatus } from '@zapx/survey-schema';

export type RedirectMode = 'STATIC' | 'DYNAMIC' | 'HYBRID';

export interface VendorRedirectConfig {
  code: string;
  redirectMode: RedirectMode;
  staticUrls: Partial<Record<OutcomeStatus, string>>;
  statusWords: Partial<Record<OutcomeStatus, string>>;
  dynamicAllowedHosts: string[];
  secret: string;
  signRedirects: boolean;
}

export interface RespondentRedirectContext {
  responseId: string;
  uid: string;
  country: string | null;
  returnUrl: string | null;
  entryParams: Record<string, string>;
}

export const DEFAULT_STATUS_WORDS: Record<OutcomeStatus, string> = {
  complete: 'complete',
  terminate: 'terminate',
  quota_full: 'quota_full',
  quality_fail: 'quality_fail',
  security_reject: 'security_reject',
  duplicate: 'duplicate',
};

/** When a vendor has no URL for a status, fall back to a related one. */
const STATIC_FALLBACK: Partial<Record<OutcomeStatus, OutcomeStatus>> = {
  duplicate: 'security_reject',
  quality_fail: 'terminate',
};

export interface RedirectPreset {
  id: string;
  name: string;
  redirectMode: RedirectMode;
  staticUrls: Partial<Record<OutcomeStatus, string>>;
  statusWords: Partial<Record<OutcomeStatus, string>>;
}

/** Ready-made vendor configurations. */
export const REDIRECT_PRESETS: RedirectPreset[] = [
  {
    id: 'sampledge-platform',
    name: 'Sampledge platform (static)',
    redirectMode: 'STATIC',
    staticUrls: {
      complete: 'https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]',
      terminate: 'https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]',
      quota_full: 'https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]',
      security_reject: 'https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]',
    },
    statusWords: {
      complete: 'complete',
      terminate: 'terminate',
      quota_full: 'overquota',
      quality_fail: 'terminate',
      security_reject: 'security',
      duplicate: 'security',
    },
  },
];

export function statusWord(vendor: Pick<VendorRedirectConfig, 'statusWords'>, status: OutcomeStatus): string {
  return vendor.statusWords[status] ?? DEFAULT_STATUS_WORDS[status];
}

/** Is this an http(s) URL whose host is one of the allowed hosts (or a subdomain of one)? */
export function isAllowedReturnUrl(raw: string, allowedHosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return allowedHosts.some((h) => {
    const allowed = h.trim().toLowerCase();
    return allowed !== '' && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

export function fillTemplate(
  template: string,
  values: { UID: string; VID: string; CC: string; STATUS: string; RID: string },
  params: Record<string, string>,
): string {
  return template.replace(/\[(UID|VID|CC|STATUS|RID|param:[A-Za-z0-9_.-]{1,64})\]/gi, (_, key: string) => {
    if (key.toLowerCase().startsWith('param:')) return encodeURIComponent(params[key.slice(6)] ?? '');
    return encodeURIComponent(values[key.toUpperCase() as keyof typeof values] ?? '');
  });
}

export function signUrl(url: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(url).digest('hex');
  return `${url}${url.includes('?') ? '&' : '?'}zsig=${sig}`;
}

export interface ResolvedRedirect {
  url: string | null;
  source: 'static' | 'dynamic' | 'none';
}

/** Resolve the redirect for an outcome. Returns url=null when the vendor has nothing configured. */
export function resolveRedirect(
  vendor: VendorRedirectConfig,
  respondent: RespondentRedirectContext,
  status: OutcomeStatus,
): ResolvedRedirect {
  const word = statusWord(vendor, status);
  let template: string | null = null;
  let source: ResolvedRedirect['source'] = 'none';

  const dynamicOk =
    vendor.redirectMode !== 'STATIC' &&
    respondent.returnUrl !== null &&
    isAllowedReturnUrl(respondent.returnUrl, vendor.dynamicAllowedHosts);
  if (dynamicOk) {
    template = respondent.returnUrl!;
    source = 'dynamic';
    // A dynamic URL without a [STATUS] placeholder gets the status appended.
    if (!/\[STATUS\]/i.test(template)) template += `${template.includes('?') ? '&' : '?'}status=[STATUS]`;
  } else if (vendor.redirectMode !== 'DYNAMIC') {
    const fallback = STATIC_FALLBACK[status];
    template = vendor.staticUrls[status] ?? (fallback ? (vendor.staticUrls[fallback] ?? null) : null);
    if (template) source = 'static';
  }
  if (!template) return { url: null, source: 'none' };

  let url = fillTemplate(
    template,
    { UID: respondent.uid, VID: vendor.code, CC: respondent.country ?? '', STATUS: word, RID: respondent.responseId },
    respondent.entryParams,
  );
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { url: null, source: 'none' };
  } catch {
    return { url: null, source: 'none' };
  }
  if (vendor.signRedirects) url = signUrl(url, vendor.secret);
  return { url, source };
}

// ---------------------------------------------------------------------------------------------
// Signed entry links
// ---------------------------------------------------------------------------------------------

/** Canonical string that is signed: every parameter except `sig`, sorted by name. */
export function canonicalParams(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sig')
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`)
    .join('&');
}

export function signParams(params: Record<string, string>, secret: string): string {
  return createHmac('sha256', secret).update(canonicalParams(params)).digest('hex');
}

/** Verify `sig` (and `exp`, unix seconds, when present). */
export function verifySignedParams(
  params: Record<string, string>,
  secret: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const sig = params.sig;
  if (!sig || !/^[0-9a-f]{64}$/i.test(sig)) return { ok: false, reason: 'missing_or_malformed_signature' };
  const expected = Buffer.from(signParams(params, secret), 'hex');
  const given = Buffer.from(sig, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' };
  if (params.exp !== undefined) {
    const exp = Number(params.exp);
    if (!Number.isFinite(exp) || exp * 1000 < now) return { ok: false, reason: 'link_expired' };
  }
  return { ok: true };
}
