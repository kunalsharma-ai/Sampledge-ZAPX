/**
 * HTTP client for the SampCode API. The mobile app signs in with email and password, keeps the session
 * token in the device's secure store and sends it as a Bearer token (no cookies, so no CSRF header).
 * Every request says it comes from the mobile app (X-ZAPX-Client: mobile), so the server applies the
 * super admin's mobile subscription, not the web one.
 */
export const CLIENT_HEADER = 'X-ZAPX-Client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly feature?: string,
  ) {
    super(message);
  }
  get isFeatureDisabled() {
    return this.status === 403 && this.code === 'FEATURE_DISABLED';
  }
  get isSuspended() {
    return this.status === 403 && (this.code === 'ORG_SUSPENDED' || this.code === 'MOBILE_DISABLED');
  }
}

export interface ApiHooks {
  /** 401: the session ended or was revoked. */
  onUnauthorized?: () => void;
  /** 403 FEATURE_DISABLED / ORG_SUSPENDED / MOBILE_DISABLED: refresh entitlements so the screen disappears. */
  onEntitlementDenied?: (feature?: string) => void;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Turn a typed-in server address into the API base ("https://zapx.example.com" -> ".../api"). */
export function normalizeServer(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('Enter your SampCode address');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (u.protocol === 'http:' && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) {
    throw new Error('Use an https:// address (http is only allowed on a local network)');
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/api$/, '')}`;
}

function messageOf(body: unknown, status: number): { message: string; code?: string; feature?: string } {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const m = Array.isArray(b.message) ? b.message.join(', ') : typeof b.message === 'string' ? b.message : undefined;
    return {
      message: m ?? (typeof b.error === 'string' ? b.error : `Request failed (${status})`),
      code: typeof b.code === 'string' ? b.code : undefined,
      feature: typeof b.feature === 'string' ? b.feature : undefined,
    };
  }
  return { message: `Request failed (${status})` };
}

export class ApiClient {
  constructor(
    private server: string,
    private token: string | null,
    private readonly hooks: ApiHooks = {},
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
  ) {}

  get baseUrl() {
    return `${this.server}/api`;
  }
  get serverUrl() {
    return this.server;
  }
  get bearer() {
    return this.token;
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', [CLIENT_HEADER]: 'mobile', ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /** Low-level request that also returns 304s (used by entitlements polling). */
  async raw(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
    const headers = this.headers(init.headers);
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.raw(method, path, { body });
    } catch {
      throw new ApiError(0, 'Cannot reach SampCode. Check your connection.');
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const { message, code, feature } = messageOf(parsed, res.status);
      const err = new ApiError(res.status, message, code, feature);
      if (res.status === 401) this.hooks.onUnauthorized?.();
      if (err.isFeatureDisabled || err.isSuspended) this.hooks.onEntitlementDenied?.(feature);
      throw err;
    }
    return parsed as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  del<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
}
