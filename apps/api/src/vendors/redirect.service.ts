import { Injectable } from '@nestjs/common';
import type { Vendor } from '@zapx/db';
import type { OutcomeStatus } from '@zapx/survey-schema';
import { resolveRedirect, type RespondentRedirectContext, type ResolvedRedirect, type VendorRedirectConfig } from './redirects';

export function toRedirectConfig(v: Vendor): VendorRedirectConfig {
  return {
    code: v.code,
    redirectMode: v.redirectMode,
    staticUrls: (v.staticUrls ?? {}) as VendorRedirectConfig['staticUrls'],
    statusWords: (v.statusWords ?? {}) as VendorRedirectConfig['statusWords'],
    dynamicAllowedHosts: v.dynamicAllowedHosts,
    secret: v.secret,
    signRedirects: v.signRedirects,
  };
}

/**
 * The interview flow depends on this abstract class, not on the implementation, so ZAPX can
 * later delegate to a shared Sampledge redirect service (e.g. PROJEXA) without other changes.
 */
export abstract class RedirectService {
  abstract resolve(vendor: Vendor, respondent: RespondentRedirectContext, status: OutcomeStatus): Promise<ResolvedRedirect>;
}

@Injectable()
export class LocalRedirectService extends RedirectService {
  async resolve(vendor: Vendor, respondent: RespondentRedirectContext, status: OutcomeStatus) {
    return resolveRedirect(toRedirectConfig(vendor), respondent, status);
  }
}
