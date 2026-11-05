/**
 * Live feature entitlements for the signed-in member on the mobile surface.
 *
 * Contract (agreed with the super admin API):
 *   GET /api/me/entitlements?surface=mobile  -> Entitlements, ETag = version, 304 on If-None-Match
 *   GET /api/me/entitlements/stream          -> SSE, event "entitlements" with the same body
 * A key missing from `features` is off (fail closed), and a suspended organization has nothing on.
 *
 * The store keeps the last good answer, pushes every change to listeners at once, and is fed from
 * three places: the stream (instant), a poll with ETag (a fallback when the stream drops), and a
 * refresh whenever the API answers 403 FEATURE_DISABLED or the app returns to the foreground.
 */
export interface Entitlements {
  version: string;
  plan: string | null;
  surface: 'web' | 'mobile';
  features: Record<string, boolean>;
  updatedAt: string;
  suspended?: boolean;
  /** False when the super admin has turned the mobile app off for this member (every feature off). */
  surfaceAllowed?: boolean;
}

export const NONE: Entitlements = { version: '', plan: null, surface: 'mobile', features: {}, updatedAt: new Date(0).toISOString() };

/** Validate an untrusted body. Unknown shapes become "nothing on" rather than throwing. */
export function parseEntitlements(body: unknown): Entitlements {
  if (!body || typeof body !== 'object') return NONE;
  const b = body as Record<string, unknown>;
  const features: Record<string, boolean> = {};
  if (b.features && typeof b.features === 'object') {
    for (const [k, v] of Object.entries(b.features as Record<string, unknown>)) features[k] = v === true;
  }
  return {
    version: typeof b.version === 'string' ? b.version : '',
    plan: typeof b.plan === 'string' ? b.plan : null,
    surface: b.surface === 'web' ? 'web' : 'mobile',
    features,
    updatedAt: typeof b.updatedAt === 'string' ? b.updatedAt : new Date(0).toISOString(),
    suspended: b.suspended === true,
    surfaceAllowed: b.surfaceAllowed !== false,
  };
}

export function isOn(e: Entitlements, key: string): boolean {
  return !e.suspended && e.surfaceAllowed !== false && e.features[key] === true;
}

/** Keys whose on/off state differs between two answers (used to tell the member what changed). */
export function changedKeys(a: Entitlements, b: Entitlements): string[] {
  const keys = new Set([...Object.keys(a.features), ...Object.keys(b.features)]);
  return [...keys].filter((k) => isOn(a, k) !== isOn(b, k)).sort();
}

export interface Transport {
  /** GET with optional If-None-Match. Returns status, body (when 200) and the ETag header. */
  get(path: string, etag?: string): Promise<{ status: number; body?: unknown; etag?: string | null }>;
  /** Open the SSE stream; call onMessage with each "entitlements" event body. Returns a closer. */
  stream?(path: string, onMessage: (body: unknown) => void, onError: () => void): () => void;
}

export type Listener = (next: Entitlements, previous: Entitlements) => void;

export interface StoreOptions {
  pollMs?: number;
  /** Poll interval while the stream is connected (a safety net only). */
  pollWithStreamMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

export class EntitlementsStore {
  private current: Entitlements = NONE;
  private loaded = false;
  private listeners = new Set<Listener>();
  private timer: unknown = null;
  private closeStream: (() => void) | null = null;
  private streaming = false;
  private inflight: Promise<void> | null = null;
  private readonly opts: Required<StoreOptions>;

  constructor(
    private readonly transport: Transport,
    opts: StoreOptions = {},
  ) {
    this.opts = {
      pollMs: opts.pollMs ?? 15_000,
      pollWithStreamMs: opts.pollWithStreamMs ?? 60_000,
      // Wrapped so the timer functions are never called with `this` set to the options object
      // (browsers throw "Illegal invocation" for that).
      setInterval: opts.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
      clearInterval: opts.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>)),
    };
  }

  get value(): Entitlements {
    return this.current;
  }
  get isLoaded(): boolean {
    return this.loaded;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Apply a new answer; listeners hear about it only when the version or content changed. */
  apply(next: Entitlements): void {
    const prev = this.current;
    this.loaded = true;
    if (prev.version === next.version && prev.version !== '' && changedKeys(prev, next).length === 0) return;
    this.current = next;
    for (const l of this.listeners) l(next, prev);
  }

  /** Fetch now (deduplicated). A 304 keeps the current value; errors keep the last good value. */
  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const r = await this.transport.get('/me/entitlements?surface=mobile', this.current.version || undefined);
        if (r.status === 304) {
          this.loaded = true;
          return;
        }
        if (r.status === 200) this.apply(parseEntitlements(r.body));
        // 401 is handled by the session (sign-out); other errors keep the last good answer.
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  start(): void {
    this.stop();
    void this.refresh().catch(() => undefined);
    if (this.transport.stream) {
      this.closeStream = this.transport.stream(
        '/me/entitlements/stream',
        (body) => {
          this.streaming = true;
          this.apply(parseEntitlements(body));
          this.schedule();
        },
        () => {
          this.streaming = false;
          this.schedule();
        },
      );
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) this.opts.clearInterval(this.timer);
    const every = this.streaming ? this.opts.pollWithStreamMs : this.opts.pollMs;
    this.timer = this.opts.setInterval(() => void this.refresh().catch(() => undefined), every);
  }

  stop(): void {
    if (this.timer) this.opts.clearInterval(this.timer);
    this.timer = null;
    this.closeStream?.();
    this.closeStream = null;
    this.streaming = false;
  }

  /** Forget everything (sign-out). */
  reset(): void {
    this.stop();
    const prev = this.current;
    this.current = NONE;
    this.loaded = false;
    for (const l of this.listeners) l(NONE, prev);
  }
}
