/**
 * Configurable redirects and status mappings at several levels. The most specific level that
 * defines something wins, in this order (the same order PROJEXA uses):
 *
 *   vendor + country  >  vendor  >  project + country  >  project  >  organization
 *
 * URLs and status words are resolved independently, so a project can set the URLs once and a
 * vendor can rename only the status words it needs.
 */
import { DEFAULT_STATUS_WORDS, STATUS_FALLBACK, type RedirectStatus } from './statuses';

export type StatusUrls = Partial<Record<RedirectStatus, string>>;
export type StatusWords = Partial<Record<RedirectStatus, string>>;

export interface RedirectRules {
  urls?: StatusUrls;
  words?: StatusWords;
}

/** One level of configuration, with optional per-country overrides (keys are upper-case codes). */
export interface RedirectLayer extends RedirectRules {
  countries?: Record<string, RedirectRules>;
}

export type LayerLevel = 'vendor_country' | 'vendor' | 'project_country' | 'project' | 'organization';

export interface LayerStack {
  vendor?: RedirectLayer;
  project?: RedirectLayer;
  organization?: RedirectLayer;
}

export const normalizeCountry = (cc: string | null | undefined): string | null => {
  const c = (cc ?? '').trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(c) ? c : null;
};

/** The levels to consult, most specific first. */
export function orderedRules(stack: LayerStack, country: string | null | undefined): Array<{ level: LayerLevel; rules: RedirectRules }> {
  const cc = normalizeCountry(country);
  const out: Array<{ level: LayerLevel; rules: RedirectRules }> = [];
  const push = (level: LayerLevel, rules: RedirectRules | undefined) => {
    if (rules) out.push({ level, rules });
  };
  if (cc) push('vendor_country', stack.vendor?.countries?.[cc]);
  push('vendor', stack.vendor);
  if (cc) push('project_country', stack.project?.countries?.[cc]);
  push('project', stack.project);
  push('organization', stack.organization);
  return out;
}

const present = (s: string | undefined): s is string => typeof s === 'string' && s.trim() !== '';

export interface ResolvedTemplate {
  template: string;
  level: LayerLevel;
  /** The status whose URL was used (differs from the requested status when a fallback applied). */
  usedStatus: RedirectStatus;
}

/** Find the URL template for a status, then for its fallback status, across all levels. */
export function resolveTemplate(stack: LayerStack, status: RedirectStatus, country: string | null | undefined): ResolvedTemplate | null {
  const levels = orderedRules(stack, country);
  for (const candidate of [status, STATUS_FALLBACK[status]]) {
    if (!candidate) continue;
    for (const { level, rules } of levels) {
      const t = rules.urls?.[candidate];
      if (present(t)) return { template: t, level, usedStatus: candidate };
    }
  }
  return null;
}

/** The status word for [STATUS]: always the requested status's word, never the fallback's. */
export function resolveStatusWord(stack: LayerStack, status: RedirectStatus, country: string | null | undefined): string {
  for (const { rules } of orderedRules(stack, country)) {
    const w = rules.words?.[status];
    if (present(w)) return w;
  }
  return DEFAULT_STATUS_WORDS[status];
}
