/**
 * Server-to-server callbacks (postbacks): retry policy and result classification. Delivery
 * itself is done by the host application from an outbox, so every callback survives restarts
 * and is retried with backoff until it is delivered, permanently refused or dead-lettered.
 */

export interface RetryPolicy {
  /** Total attempts including the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** 0..1: each delay is randomised by up to this fraction either way. */
  jitter: number;
}

/** Same schedule as PROJEXA: 30s, 60s, 120s ... capped at one hour, 6 attempts. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 6, baseDelayMs: 30_000, maxDelayMs: 3_600_000, jitter: 0.2 };

/** Delay before the next attempt, after `failedAttempts` attempts have failed (1-based). */
export function retryDelayMs(
  failedAttempts: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, failedAttempts - 1));
  const factor = 1 + policy.jitter * (random() * 2 - 1);
  return Math.max(1000, Math.round(exp * factor));
}

/**
 * - delivered: done.
 * - retry: transient (network error, timeout, 408, 429, 5xx).
 * - permanent: the receiver refused it; retrying cannot help (other 4xx).
 * - conflict: the receiver already holds a different outcome for this respondent (PROJEXA 409).
 */
export type DeliveryVerdict = 'delivered' | 'retry' | 'permanent' | 'conflict';

/** `httpStatus` is null when no response arrived (network error or timeout). */
export function classifyHttpResult(httpStatus: number | null): DeliveryVerdict {
  if (httpStatus === null) return 'retry';
  if (httpStatus >= 200 && httpStatus < 300) return 'delivered';
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return 'retry';
  return 'permanent';
}

export interface HttpRequestSpec {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A callback as stored in the outbox. Anything time-dependent is added at send time. */
export interface PlannedCallback {
  method: 'GET' | 'POST';
  url: string;
  /** Adapter-specific data used to build the request body at send time. */
  payload: Record<string, string> | null;
}
