/** URL templates and return-URL safety checks. */

export interface TemplateValues {
  /** Respondent id from the vendor. */
  UID: string;
  /** Vendor code. */
  VID: string;
  /** Country code. */
  CC: string;
  /** Status word after mapping. */
  STATUS: string;
  /** ZAPX response id. */
  RID: string;
}

/**
 * Fill [UID] [VID] [CC] [STATUS] [RID] and [param:name] (case-insensitive). Every value is
 * URL-encoded, so a respondent-controlled value can never change the URL's structure.
 */
export function fillTemplate(template: string, values: TemplateValues, params: Record<string, string> = {}): string {
  return template.replace(/\[(UID|VID|CC|STATUS|RID|param:[A-Za-z0-9_.-]{1,64})\]/gi, (_, key: string) => {
    if (key.toLowerCase().startsWith('param:')) return encodeURIComponent(params[key.slice(6)] ?? '');
    return encodeURIComponent(values[key.toUpperCase() as keyof TemplateValues] ?? '');
  });
}

/** Parse an absolute http(s) URL without credentials, or return null. */
export function parseHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return url;
}

/** Is this an http(s) URL whose host is one of the allowed hosts (or a subdomain of one)? */
export function isAllowedReturnUrl(raw: string, allowedHosts: string[]): boolean {
  const url = parseHttpUrl(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return allowedHosts.some((h) => {
    const allowed = h.trim().toLowerCase();
    return allowed !== '' && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

export function appendQuery(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
