/**
 * Maps stored vendor, project and organization settings to the redirect-core configuration.
 * Everything read from JSON columns is re-validated here, so a malformed row can never produce
 * an unexpected redirect.
 */
import { z } from 'zod';
import type { Project, Tenant, Vendor } from '@zapx/db';
import {
  REDIRECT_STATUSES,
  isRedirectStatus,
  type IntegrationConfig,
  type RedirectLayer,
  type RedirectRules,
  type RedirectStatus,
} from '@zapx/redirect-core';
import type { SecretBox } from '../platform/secret-box';

export const URL_TEMPLATE = z
  .string()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), 'Must start with http:// or https://');
const WORD = z.string().min(1).max(60);

export const statusMap = (value: z.ZodTypeAny) =>
  z.object(Object.fromEntries(REDIRECT_STATUSES.map((s) => [s, value.optional()])) as Record<string, z.ZodTypeAny>).strict();

export const rulesSchema = z.object({ urls: statusMap(URL_TEMPLATE).prefault({}), words: statusMap(WORD).prefault({}) }).strict();

export const countryCode = z.string().regex(/^[A-Za-z]{2,3}$/, 'Use a 2 or 3 letter country code');

export const countryRulesSchema = z
  .record(countryCode, rulesSchema)
  .refine((m) => Object.keys(m).length <= 250, 'Too many countries')
  .transform((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toUpperCase(), v])));

export const layerSchema = rulesSchema.extend({ countries: countryRulesSchema.prefault({}) }).strict();
export type LayerInput = z.infer<typeof layerSchema>;

/** Lenient reader for stored JSON: drops anything that is not a known status with a string. */
function readRules(raw: unknown): RedirectRules {
  const pick = (m: unknown) => {
    const out: Partial<Record<RedirectStatus, string>> = {};
    if (m && typeof m === 'object')
      for (const [k, v] of Object.entries(m)) if (isRedirectStatus(k) && typeof v === 'string' && v.trim()) out[k] = v;
    return out;
  };
  const o = (raw && typeof raw === 'object' ? raw : {}) as { urls?: unknown; words?: unknown };
  return { urls: pick(o.urls), words: pick(o.words) };
}

export function readLayer(raw: unknown): RedirectLayer {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { countries?: unknown };
  const countries: Record<string, RedirectRules> = {};
  if (o.countries && typeof o.countries === 'object') {
    for (const [cc, rules] of Object.entries(o.countries)) if (/^[A-Z]{2,3}$/.test(cc)) countries[cc] = readRules(rules);
  }
  return { ...readRules(raw), countries };
}

/** Vendor columns → vendor layer (static URLs, status words and per-country overrides). */
export function vendorLayer(v: Pick<Vendor, 'staticUrls' | 'statusWords' | 'countryRedirects'>): RedirectLayer {
  return {
    ...readRules({ urls: v.staticUrls, words: v.statusWords }),
    countries: readLayer({ countries: v.countryRedirects }).countries,
  };
}

export function toIntegrationConfig(
  vendor: Vendor,
  project: Pick<Project, 'redirectDefaults'> | null,
  tenant: Pick<Tenant, 'redirectDefaults'> | null,
  box: SecretBox,
): IntegrationConfig {
  if (vendor.integration === 'PROJEXA' || vendor.integration === 'SAMPLEON') {
    let clientSecret: string | null = null;
    if (vendor.partnerSecretEnc) {
      try {
        clientSecret = box.open(vendor.partnerSecretEnc);
      } catch {
        clientSecret = null; // key rotated or corrupted: S2S is skipped and the delivery log says why
      }
    }
    return { kind: vendor.integration, baseUrl: vendor.partnerBaseUrl ?? '', clientSecret, s2sEnabled: vendor.partnerS2s };
  }
  return {
    kind: 'DIRECT',
    redirectMode: vendor.redirectMode,
    layers: {
      vendor: vendorLayer(vendor),
      project: project ? readLayer(project.redirectDefaults) : undefined,
      organization: tenant ? readLayer(tenant.redirectDefaults) : undefined,
    },
    dynamicAllowedHosts: vendor.dynamicAllowedHosts,
    signRedirects: vendor.signRedirects,
    secret: vendor.secret,
    callbackUrl: vendor.callbackUrl,
    callbackStatuses: vendor.callbackStatuses.filter(isRedirectStatus),
  };
}
