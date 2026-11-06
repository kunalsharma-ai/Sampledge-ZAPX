import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, CLIENT_HEADER, normalizeServer } from '../src/lib/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('normalizeServer', () => {
  it('adds https, strips /api and trailing slashes', () => {
    expect(normalizeServer('zapx.example.com')).toBe('https://zapx.example.com');
    expect(normalizeServer('https://zapx.example.com/api/')).toBe('https://zapx.example.com');
    expect(normalizeServer(' http://192.168.1.20:3000 ')).toBe('http://192.168.1.20:3000');
  });
  it('refuses plain http on the internet', () => {
    expect(() => normalizeServer('http://zapx.example.com')).toThrow(/https/);
    expect(() => normalizeServer('')).toThrow();
  });
});

describe('ApiClient', () => {
  it('sends the bearer token and the mobile client header', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200, { ok: 1 }));
    const api = new ApiClient('https://z.example', 'tok', {}, f);
    await api.get('/dashboard');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://z.example/api/dashboard');
    const h = init!.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h[CLIENT_HEADER]).toBe('mobile');
  });

  it('reports a disabled feature so entitlements refresh, and a 401 so the session ends', async () => {
    const denied = vi.fn();
    const unauth = vi.fn();
    const answers = [
      json(403, { message: 'Not in your plan', code: 'FEATURE_DISABLED', feature: 'qa' }),
      json(401, { message: 'Unauthorized' }),
    ];
    const api = new ApiClient(
      'https://z.example',
      'tok',
      { onEntitlementDenied: denied, onUnauthorized: unauth },
      async () => answers.shift()!,
    );
    const e = await api.post('/surveys/1/qa/run').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).isFeatureDisabled).toBe(true);
    expect(denied).toHaveBeenCalledWith('qa');
    await api.get('/dashboard').catch(() => undefined);
    expect(unauth).toHaveBeenCalled();
  });

  it('treats ORG_SUSPENDED and MOBILE_DISABLED as entitlement denials', async () => {
    for (const code of ['ORG_SUSPENDED', 'MOBILE_DISABLED']) {
      const denied = vi.fn();
      const api = new ApiClient('https://z.example', 'tok', { onEntitlementDenied: denied }, async () => json(403, { message: 'x', code }));
      const e = (await api.get('/dashboard').catch((x: unknown) => x)) as ApiError;
      expect(e.isSuspended).toBe(true);
      expect(denied).toHaveBeenCalled();
    }
  });

  it('turns a network failure into a readable error', async () => {
    const api = new ApiClient('https://z.example', null, {}, async () => {
      throw new TypeError('Network request failed');
    });
    await expect(api.get('/x')).rejects.toThrow(/Cannot reach SampCode/);
  });
});
