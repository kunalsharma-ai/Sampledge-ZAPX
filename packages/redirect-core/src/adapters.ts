/**
 * Partner adapters. ZAPX talks to every redirect partner through this interface:
 *
 *   DIRECT  – ZAPX resolves redirects itself (static / dynamic / hybrid, with the configurable
 *             precedence in layers.ts) and sends optional signed callbacks to the vendor.
 *   PROJEXA – ZAPX is a "client survey platform" behind PROJEXA, per PROJEXA's
 *             docs/SURVEY_INTEGRATION.md: the browser goes to {base}/r/{status}?token=..., and
 *             the outcome is confirmed by a signed POST {base}/api/v1/s2s/outcome.
 *   SAMPLEON – ZAPX is the survey host behind SAMPLEON, the Sampledge audience and routing engine.
 *             SAMPLEON deliberately uses the same survey-host contract as PROJEXA
 *             (SAMPLEON docs/ECOSYSTEM_ARCHITECTURE.md §5.3), so the two share one implementation:
 *             the respondent id is SAMPLEON's opaque session token, the browser returns to
 *             {base}/r/{status}?token=..., and the outcome is confirmed by a signed S2S POST.
 *             SAMPLEON only counts a complete after that confirmation, and SAMPLEON (not ZAPX)
 *             decides whether to route the respondent to another survey.
 *
 * Adapters are pure: no network, no database, no clock except the `nowMs` passed in.
 */
import { classifyHttpResult, type DeliveryVerdict, type HttpRequestSpec, type PlannedCallback } from './callbacks';
import { resolveStatusWord, resolveTemplate, type LayerLevel, type LayerStack } from './layers';
import { hmacHex, signRedirectUrl, unixSeconds } from './signing';
import { fillTemplate, isAllowedReturnUrl, parseHttpUrl } from './template';
import type { RedirectStatus } from './statuses';

export type IntegrationKind = 'DIRECT' | 'PROJEXA' | 'SAMPLEON';
export type RedirectMode = 'STATIC' | 'DYNAMIC' | 'HYBRID';

export interface RespondentContext {
  responseId: string;
  uid: string;
  vendorCode: string;
  country: string | null;
  /** Validated dynamic return URL captured at entry, if any. */
  returnUrl: string | null;
  entryParams: Record<string, string>;
}

export interface DirectConfig {
  kind: 'DIRECT';
  redirectMode: RedirectMode;
  layers: LayerStack;
  dynamicAllowedHosts: string[];
  signRedirects: boolean;
  /** Vendor shared secret: signs redirects and callbacks. */
  secret: string;
  /** Callback URL template (GET), e.g. https://panel.example/postback?uid=[UID]&s=[STATUS]. */
  callbackUrl: string | null;
  callbackStatuses: RedirectStatus[];
}

export interface ProjexaConfig {
  kind: 'PROJEXA';
  /** PROJEXA base URL, e.g. https://projexa.example */
  baseUrl: string;
  /** PROJEXA client secret, used only for the S2S outcome signature. */
  clientSecret: string | null;
  /** Send the S2S outcome confirmation (recommended by PROJEXA). */
  s2sEnabled: boolean;
}

/** Same fields as PROJEXA: SAMPLEON base URL, the survey-host outcome secret and the S2S switch. */
export interface SampleonConfig extends Omit<ProjexaConfig, 'kind'> {
  kind: 'SAMPLEON';
}

export type IntegrationConfig = DirectConfig | ProjexaConfig | SampleonConfig;

export interface ResolvedRedirect {
  url: string | null;
  source: 'static' | 'dynamic' | 'partner' | 'none';
  level: LayerLevel | null;
  statusWord: string;
}

export interface IntegrationAdapter<C extends IntegrationConfig = IntegrationConfig> {
  readonly kind: C['kind'];
  redirect(config: C, respondent: RespondentContext, status: RedirectStatus, nowMs?: number): ResolvedRedirect;
  /** The callback to queue for a recorded outcome, or null when none is configured. */
  planCallback(config: C, respondent: RespondentContext, status: RedirectStatus): PlannedCallback | null;
  /** Build the HTTP request for one delivery attempt (fresh timestamp and signature each time). */
  prepare(config: C, planned: PlannedCallback, idempotencyKey: string, nowMs?: number): HttpRequestSpec;
  classify(httpStatus: number | null): DeliveryVerdict;
}

// ---- DIRECT -------------------------------------------------------------------------------------

export const directAdapter: IntegrationAdapter<DirectConfig> = {
  kind: 'DIRECT',

  redirect(config, r, status, nowMs = Date.now()) {
    const word = resolveStatusWord(config.layers, status, r.country);
    let template: string | null = null;
    let source: ResolvedRedirect['source'] = 'none';
    let level: LayerLevel | null = null;

    const dynamicOk =
      config.redirectMode !== 'STATIC' && r.returnUrl !== null && isAllowedReturnUrl(r.returnUrl, config.dynamicAllowedHosts);
    if (dynamicOk) {
      template = r.returnUrl!;
      source = 'dynamic';
      // A dynamic URL without a [STATUS] placeholder gets the status appended.
      if (!/\[STATUS\]/i.test(template)) template += `${template.includes('?') ? '&' : '?'}status=[STATUS]`;
    } else if (config.redirectMode !== 'DYNAMIC') {
      const found = resolveTemplate(config.layers, status, r.country);
      if (found) {
        template = found.template;
        source = 'static';
        level = found.level;
      }
    }
    if (!template) return { url: null, source: 'none', level: null, statusWord: word };

    let url = fillTemplate(
      template,
      { UID: r.uid, VID: r.vendorCode, CC: r.country ?? '', STATUS: word, RID: r.responseId },
      r.entryParams,
    );
    if (!parseHttpUrl(url)) return { url: null, source: 'none', level: null, statusWord: word };
    if (config.signRedirects) url = signRedirectUrl(url, config.secret, nowMs);
    return { url, source, level, statusWord: word };
  },

  planCallback(config, r, status) {
    if (!config.callbackUrl || !config.callbackStatuses.includes(status)) return null;
    const word = resolveStatusWord(config.layers, status, r.country);
    const url = fillTemplate(
      config.callbackUrl,
      { UID: r.uid, VID: r.vendorCode, CC: r.country ?? '', STATUS: word, RID: r.responseId },
      r.entryParams,
    );
    return parseHttpUrl(url) ? { method: 'GET', url, payload: null } : null;
  },

  /** Headers mirror PROJEXA's vendor callbacks, so a vendor can verify both the same way. */
  prepare(config, planned, idempotencyKey, nowMs = Date.now()) {
    const timestamp = String(unixSeconds(nowMs));
    const body = null;
    return {
      method: planned.method,
      url: planned.url,
      body,
      headers: {
        'X-Idempotency-Key': idempotencyKey,
        'X-Zapx-Timestamp': timestamp,
        'X-Zapx-Signature': hmacHex(config.secret, `${timestamp}.${planned.url}.`),
      },
    };
  },

  classify: classifyHttpResult,
};

// ---- PROJEXA ------------------------------------------------------------------------------------

/** PROJEXA status slugs (docs/SURVEY_INTEGRATION.md). ZAPX always sends the primary slug. */
export const PROJEXA_SLUGS: Record<RedirectStatus, string> = {
  complete: 'complete',
  terminate: 'terminate',
  quota_full: 'quota_full',
  quality_fail: 'quality_fail',
  duplicate: 'duplicate',
  security_reject: 'security_reject',
  partial: 'partial',
  technical_error: 'technical_error',
};

const trimBase = (base: string) => base.replace(/\/+$/, '');

/** HMAC-SHA256(clientSecret, token + "." + status + "." + timestamp), hex. SAMPLEON uses the same. */
export const projexaS2sSignature = (clientSecret: string, token: string, status: string, timestamp: number) =>
  hmacHex(clientSecret, `${token}.${status}.${timestamp}`);

/** The partner survey-host contract shared by PROJEXA and SAMPLEON. */
function surveyHostAdapter<C extends ProjexaConfig | SampleonConfig>(kind: C['kind']): IntegrationAdapter<C> {
  return {
    kind,

    /** The respondent id ZAPX received is the partner's opaque session token. */
    redirect(config, r, status) {
      const slug = PROJEXA_SLUGS[status];
      const url = `${trimBase(config.baseUrl)}/r/${slug}?token=${encodeURIComponent(r.uid)}`;
      return parseHttpUrl(url)
        ? { url, source: 'partner', level: null, statusWord: slug }
        : { url: null, source: 'none', level: null, statusWord: slug };
    },

    planCallback(config, r, status) {
      if (!config.s2sEnabled || !config.clientSecret) return null;
      return {
        method: 'POST',
        url: `${trimBase(config.baseUrl)}/api/v1/s2s/outcome`,
        payload: { token: r.uid, status: PROJEXA_SLUGS[status] },
      };
    },

    prepare(config, planned, idempotencyKey, nowMs = Date.now()) {
      const timestamp = unixSeconds(nowMs);
      const token = planned.payload?.token ?? '';
      const status = planned.payload?.status ?? '';
      const signature = projexaS2sSignature(config.clientSecret ?? '', token, status, timestamp);
      return {
        method: 'POST',
        url: planned.url,
        body: JSON.stringify({ token, status, timestamp, signature }),
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
      };
    },

    /** 200 recorded · 401 bad signature/timestamp · 404 unknown token · 409 different status recorded. */
    classify(httpStatus) {
      if (httpStatus === 409) return 'conflict';
      return classifyHttpResult(httpStatus);
    },
  };
}

export const projexaAdapter = surveyHostAdapter<ProjexaConfig>('PROJEXA');
export const sampleonAdapter = surveyHostAdapter<SampleonConfig>('SAMPLEON');

const ADAPTERS = { DIRECT: directAdapter, PROJEXA: projexaAdapter, SAMPLEON: sampleonAdapter } as const;

export function adapterFor<C extends IntegrationConfig>(config: C): IntegrationAdapter<C> {
  return ADAPTERS[config.kind] as unknown as IntegrationAdapter<C>;
}

/** Convenience wrappers that pick the adapter from the config. */
export const resolveRedirect = (config: IntegrationConfig, r: RespondentContext, status: RedirectStatus, nowMs?: number) =>
  adapterFor(config).redirect(config, r, status, nowMs);
export const planCallback = (config: IntegrationConfig, r: RespondentContext, status: RedirectStatus) =>
  adapterFor(config).planCallback(config, r, status);
export const prepareCallback = (config: IntegrationConfig, planned: PlannedCallback, key: string, nowMs?: number) =>
  adapterFor(config).prepare(config, planned, key, nowMs);
export const classifyDelivery = (config: IntegrationConfig, httpStatus: number | null) => adapterFor(config).classify(httpStatus);
