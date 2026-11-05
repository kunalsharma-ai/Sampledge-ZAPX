import { describe, expect, it, vi } from 'vitest';
import { changedKeys, EntitlementsStore, isOn, parseEntitlements, type Entitlements, type Transport } from '../src/lib/entitlements';
import { FEATURE_KEYS } from '../src/lib/features';

const ent = (features: Record<string, boolean>, extra: Partial<Entitlements> = {}): Entitlements => ({
  version: JSON.stringify(features) + JSON.stringify(extra),
  plan: 'team',
  surface: 'mobile',
  features,
  updatedAt: '2026-11-05T00:00:00.000Z',
  ...extra,
});

describe('parseEntitlements', () => {
  it('keeps only true booleans and fails closed on junk', () => {
    const e = parseEntitlements({
      version: 'v1',
      plan: 'team',
      surface: 'mobile',
      features: { dashboard: true, qa: 'yes', cati: false },
      updatedAt: 'x',
    });
    expect(isOn(e, 'dashboard')).toBe(true);
    expect(isOn(e, 'qa')).toBe(false);
    expect(isOn(e, 'cati')).toBe(false);
    expect(isOn(e, 'missing')).toBe(false);
    expect(parseEntitlements(null).features).toEqual({});
    expect(parseEntitlements('nope').version).toBe('');
  });

  it('turns everything off when suspended or when the mobile app is off for the member', () => {
    expect(isOn(parseEntitlements({ features: { dashboard: true }, suspended: true }), 'dashboard')).toBe(false);
    expect(isOn(parseEntitlements({ features: { dashboard: true }, surfaceAllowed: false }), 'dashboard')).toBe(false);
    expect(isOn(parseEntitlements({ features: { dashboard: true } }), 'dashboard')).toBe(true);
  });
});

describe('changedKeys', () => {
  it('lists keys whose effective state changed', () => {
    expect(changedKeys(ent({ a: true, b: true }), ent({ a: true, b: false, c: true }))).toEqual(['b', 'c']);
    expect(changedKeys(ent({ a: true }), ent({ a: true }, { suspended: true }))).toEqual(['a']);
  });
});

function fakeTransport(answers: Array<{ status: number; body?: unknown }>) {
  const calls: Array<string | undefined> = [];
  let push: ((b: unknown) => void) | null = null;
  let fail: (() => void) | null = null;
  const t: Transport = {
    get: async (_path, etag) => {
      calls.push(etag);
      return answers.shift() ?? { status: 304 };
    },
    stream: (_p, onMessage, onError) => {
      push = onMessage;
      fail = onError;
      return () => {
        push = null;
      };
    },
  };
  return { t, calls, push: (b: unknown) => push?.(b), fail: () => fail?.() };
}

describe('EntitlementsStore', () => {
  it('loads, sends the ETag on the next poll and treats 304 as unchanged', async () => {
    const f = fakeTransport([{ status: 200, body: { version: 'v1', features: { dashboard: true } } }, { status: 304 }]);
    const s = new EntitlementsStore(f.t, { setInterval: (() => 0) as never, clearInterval: (() => undefined) as never });
    const seen = vi.fn();
    s.subscribe(seen);
    await s.refresh();
    await s.refresh();
    expect(f.calls).toEqual([undefined, 'v1']);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(isOn(s.value, 'dashboard')).toBe(true);
  });

  it('applies a change pushed on the stream at once (super admin removed a feature)', async () => {
    const f = fakeTransport([{ status: 200, body: { version: 'v1', features: { dashboard: true, cati: true } } }]);
    const s = new EntitlementsStore(f.t, { setInterval: (() => 0) as never, clearInterval: (() => undefined) as never });
    const seen = vi.fn();
    s.subscribe(seen);
    s.start();
    await s.refresh();
    f.push({ version: 'v2', features: { dashboard: true, cati: false } });
    expect(isOn(s.value, 'cati')).toBe(false);
    const [next, prev] = seen.mock.calls.at(-1)!;
    expect(changedKeys(prev, next)).toEqual(['cati']);
    s.stop();
  });

  it('polls faster when the stream drops', () => {
    const intervals: number[] = [];
    const f = fakeTransport([]);
    const s = new EntitlementsStore(f.t, {
      pollMs: 15_000,
      pollWithStreamMs: 60_000,
      setInterval: ((_fn: () => void, ms: number) => (intervals.push(ms), intervals.length)) as never,
      clearInterval: (() => undefined) as never,
    });
    s.start();
    f.push({ version: 'v1', features: {} });
    f.fail();
    expect(intervals).toEqual([15_000, 60_000, 15_000]);
    s.stop();
  });

  it('keeps the last good answer when the server errors', async () => {
    const f = fakeTransport([{ status: 200, body: { version: 'v1', features: { qa: true } } }, { status: 500 }]);
    const s = new EntitlementsStore(f.t, { setInterval: (() => 0) as never, clearInterval: (() => undefined) as never });
    await s.refresh();
    await s.refresh();
    expect(isOn(s.value, 'qa')).toBe(true);
  });

  it('reset clears everything on sign-out', async () => {
    const f = fakeTransport([{ status: 200, body: { version: 'v1', features: { qa: true } } }]);
    const s = new EntitlementsStore(f.t, { setInterval: (() => 0) as never, clearInterval: (() => undefined) as never });
    await s.refresh();
    s.reset();
    expect(isOn(s.value, 'qa')).toBe(false);
    expect(s.isLoaded).toBe(false);
  });
});

describe('feature keys', () => {
  it('match the server catalog (apps/api/src/super-admin/features.ts) for the mobile surface', async () => {
    const server = await import('../../api/src/super-admin/features');
    const mobile = new Set(server.allFeatures('mobile'));
    for (const k of FEATURE_KEYS) expect(mobile.has(k), `${k} is not a mobile feature on the server`).toBe(true);
    for (const k of mobile) expect(FEATURE_KEYS as readonly string[], `server mobile feature ${k} is unknown to the app`).toContain(k);
  });
});
