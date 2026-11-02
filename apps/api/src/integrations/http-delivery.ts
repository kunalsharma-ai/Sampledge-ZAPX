/**
 * Sends one callback request. Protects against SSRF: unless explicitly allowed (development and
 * tests), callbacks may only go to public addresses, and redirects are never followed.
 */
import { Injectable } from '@nestjs/common';
import type { HttpRequestSpec } from '@zapx/redirect-core';
import { config } from '../config';
import { guardedFetch, isBlockedAddressError } from '../common/net-guard';

/** Kept here for existing callers; the full check lives in common/net-guard.ts. */
export { isPrivateAddress } from '../common/net-guard';

export interface DeliveryResult {
  httpStatus: number | null;
  error: string | null;
  ms: number;
  /** The request was refused before sending; retrying cannot help. */
  permanent?: boolean;
}

@Injectable()
export class HttpDelivery {
  async send(spec: HttpRequestSpec): Promise<DeliveryResult> {
    const started = Date.now();
    const cfg = config();
    try {
      // The address is checked when the socket connects, so a name cannot pass the check and then
      // resolve to a private address (DNS rebinding).
      const res = await guardedFetch(spec.url, {
        method: spec.method,
        headers: { 'User-Agent': 'ZAPX-Callbacks/1', ...spec.headers },
        body: spec.body ?? undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(cfg.CALLBACK_TIMEOUT_MS),
        allowPrivate: cfg.CALLBACK_ALLOW_PRIVATE_HOSTS,
      });
      await res.body?.cancel().catch(() => undefined);
      return { httpStatus: res.status, error: res.ok ? null : `HTTP ${res.status}`, ms: Date.now() - started };
    } catch (e) {
      if (isBlockedAddressError(e)) {
        return {
          httpStatus: null,
          error: 'blocked: callback host resolves to a private address',
          ms: Date.now() - started,
          permanent: true,
        };
      }
      const err = e as Error;
      return {
        httpStatus: null,
        error: err.name === 'TimeoutError' ? 'timeout' : `network: ${err.message}`.slice(0, 300),
        ms: Date.now() - started,
      };
    }
  }
}
