/**
 * The eight final outcomes a respondent can reach, shared with the Sampledge ecosystem
 * (PROJEXA uses the same eight). Each outcome maps to a redirect and, optionally, a callback.
 */
export const REDIRECT_STATUSES = [
  'complete',
  'terminate',
  'quota_full',
  'quality_fail',
  'security_reject',
  'duplicate',
  'partial',
  'technical_error',
] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];

export const STATUS_LABELS: Record<RedirectStatus, string> = {
  complete: 'Complete',
  terminate: 'Terminate',
  quota_full: 'Quota full',
  quality_fail: 'Quality fail',
  security_reject: 'Security reject',
  duplicate: 'Duplicate',
  partial: 'Partial (abandoned)',
  technical_error: 'Technical error',
};

/** The word sent for [STATUS] when nothing else is configured. */
export const DEFAULT_STATUS_WORDS: Record<RedirectStatus, string> = {
  complete: 'complete',
  terminate: 'terminate',
  quota_full: 'quota_full',
  quality_fail: 'quality_fail',
  security_reject: 'security_reject',
  duplicate: 'duplicate',
  partial: 'partial',
  technical_error: 'technical_error',
};

/**
 * When no URL is configured for a status at any level, the URL of a related status is used.
 * Only one hop: the fallback's own fallback is never followed.
 */
export const STATUS_FALLBACK: Partial<Record<RedirectStatus, RedirectStatus>> = {
  duplicate: 'security_reject',
  quality_fail: 'terminate',
  partial: 'terminate',
  technical_error: 'terminate',
};

export function isRedirectStatus(value: unknown): value is RedirectStatus {
  return typeof value === 'string' && (REDIRECT_STATUSES as readonly string[]).includes(value);
}
