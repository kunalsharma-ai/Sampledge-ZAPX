import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_POLICY,
  REDIRECT_PRESETS,
  classifyDelivery,
  hmacHex,
  isAllowedReturnUrl,
  planCallback,
  prepareCallback,
  projexaS2sSignature,
  resolveRedirect,
  retryDelayMs,
  signParams,
  signRequest,
  verifyRequest,
  verifySignedParams,
  verifySignedRedirectUrl,
  type DirectConfig,
  type ProjexaConfig,
  type RespondentContext,
} from './index';

const sampledge = REDIRECT_PRESETS.find((p) => p.id === 'sampledge-platform')!;
const direct = (over: Partial<DirectConfig> = {}): DirectConfig => ({
  kind: 'DIRECT',
  redirectMode: 'STATIC',
  layers: { vendor: { urls: sampledge.staticUrls, words: sampledge.statusWords } },
  dynamicAllowedHosts: [],
  signRedirects: false,
  secret: 's'.repeat(64),
  callbackUrl: null,
  callbackStatuses: [],
  ...over,
});
const resp = (over: Partial<RespondentContext> = {}): RespondentContext => ({
  responseId: 'R1',
  uid: 'abc 123',
  vendorCode: 'SE',
  country: 'US',
  returnUrl: null,
  entryParams: { pid: 'P9' },
  ...over,
});

describe('static redirects (Sampledge preset)', () => {
  it('produces the existing Sampledge platform URLs', () => {
    const v = direct();
    expect(resolveRedirect(v, resp(), 'complete').url).toBe('https://platform.sampledge.com/response/status?status=complete&uid=abc%20123');
    expect(resolveRedirect(v, resp(), 'terminate').url).toContain('status=terminate&');
    expect(resolveRedirect(v, resp(), 'quota_full').url).toContain('status=overquota&');
    expect(resolveRedirect(v, resp(), 'security_reject').url).toContain('status=security&');
  });

  it('falls back for statuses without their own URL, keeping their own status word', () => {
    expect(resolveRedirect(direct(), resp(), 'duplicate').url).toContain('status=security&');
    expect(resolveRedirect(direct(), resp(), 'quality_fail').url).toContain('status=terminate&');
    const partial = direct({ layers: { vendor: { urls: { terminate: 'https://x.test/t?s=[STATUS]' } } } });
    expect(resolveRedirect(partial, resp(), 'partial').url).toBe('https://x.test/t?s=partial');
    expect(resolveRedirect(partial, resp(), 'technical_error').url).toBe('https://x.test/t?s=technical_error');
  });

  it('fills every placeholder and signs with a timestamp when asked', () => {
    const v = direct({
      layers: { vendor: { urls: { complete: 'https://x.test/c?u=[uid]&v=[VID]&c=[CC]&r=[RID]&p=[param:pid]&s=[STATUS]' } } },
      signRedirects: true,
    });
    const r = resolveRedirect(v, resp(), 'complete', 1_800_000_000_000);
    expect(r.url).toMatch(/^https:\/\/x\.test\/c\?u=abc%20123&v=SE&c=US&r=R1&p=P9&s=complete&zts=1800000000&zsig=[0-9a-f]{64}$/);
    expect(verifySignedRedirectUrl(r.url!, v.secret, 1_800_000_000_000)).toBe(true);
    expect(verifySignedRedirectUrl(r.url!.replace('R1', 'R2'), v.secret, 1_800_000_000_000)).toBe(false);
  });
});

describe('configuration precedence', () => {
  const layered = direct({
    layers: {
      vendor: {
        urls: { complete: 'https://vendor.test/c?s=[STATUS]' },
        words: { quota_full: 'oq' },
        countries: { DE: { urls: { complete: 'https://vendor-de.test/c' } } },
      },
      project: {
        urls: { terminate: 'https://project.test/t?s=[STATUS]', complete: 'https://project.test/c' },
        countries: { FR: { urls: { terminate: 'https://project-fr.test/t' } } },
      },
      organization: { urls: { quota_full: 'https://org.test/q?s=[STATUS]' }, words: { quota_full: 'org-word', terminate: 'screenout' } },
    },
  });
  it('vendor + country > vendor > project + country > project > organization', () => {
    expect(resolveRedirect(layered, resp({ country: 'de' }), 'complete')).toMatchObject({
      url: 'https://vendor-de.test/c',
      level: 'vendor_country',
    });
    expect(resolveRedirect(layered, resp({ country: 'US' }), 'complete')).toMatchObject({
      url: 'https://vendor.test/c?s=complete',
      level: 'vendor',
    });
    expect(resolveRedirect(layered, resp({ country: 'FR' }), 'terminate')).toMatchObject({
      url: 'https://project-fr.test/t',
      level: 'project_country',
    });
    expect(resolveRedirect(layered, resp({ country: null }), 'terminate')).toMatchObject({
      url: 'https://project.test/t?s=screenout',
      level: 'project',
    });
    expect(resolveRedirect(layered, resp(), 'quota_full')).toMatchObject({ url: 'https://org.test/q?s=oq', level: 'organization' });
  });
  it('ignores malformed country codes', () => {
    expect(resolveRedirect(layered, resp({ country: 'D E' }), 'complete').level).toBe('vendor');
  });
});

describe('dynamic and hybrid redirects', () => {
  const dyn = (mode: DirectConfig['redirectMode']) => direct({ redirectMode: mode, dynamicAllowedHosts: ['panel.example.com'] });

  it('uses the return URL supplied at entry when its host is allowed', () => {
    const r = resolveRedirect(dyn('DYNAMIC'), resp({ returnUrl: 'https://panel.example.com/back?id=[UID]' }), 'quota_full');
    expect(r).toMatchObject({ url: 'https://panel.example.com/back?id=abc%20123&status=overquota', source: 'dynamic' });
  });

  it('rejects return URLs on other hosts (no open redirect)', () => {
    expect(resolveRedirect(dyn('DYNAMIC'), resp({ returnUrl: 'https://evil.test/x' }), 'complete').url).toBeNull();
    expect(isAllowedReturnUrl('https://panel.example.com.evil.test/', ['panel.example.com'])).toBe(false);
    expect(isAllowedReturnUrl('javascript:alert(1)', ['panel.example.com'])).toBe(false);
    expect(isAllowedReturnUrl('https://user:pw@panel.example.com/', ['panel.example.com'])).toBe(false);
    expect(isAllowedReturnUrl('https://a.panel.example.com/', ['panel.example.com'])).toBe(true);
  });

  it('hybrid falls back to static when no dynamic URL was supplied', () => {
    expect(resolveRedirect(dyn('HYBRID'), resp(), 'complete').source).toBe('static');
    expect(resolveRedirect(dyn('HYBRID'), resp({ returnUrl: 'https://panel.example.com/b' }), 'complete').source).toBe('dynamic');
    expect(resolveRedirect(dyn('DYNAMIC'), resp(), 'complete').url).toBeNull();
  });
});

describe('signed entry links and vendor API requests', () => {
  const secret = 'k'.repeat(64);
  it('accepts a correct entry signature and rejects tampering or expiry', () => {
    const params: Record<string, string> = { vid: 'SE', uid: 'u1', exp: String(Math.floor(Date.now() / 1000) + 60) };
    params.sig = signParams(params, secret);
    expect(verifySignedParams(params, secret)).toEqual({ ok: true });
    expect(verifySignedParams({ ...params, uid: 'u2' }, secret)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifySignedParams({ vid: 'SE', uid: 'u1' }, secret).ok).toBe(false);
    const old: Record<string, string> = { vid: 'SE', uid: 'u1', exp: '1000' };
    old.sig = signParams(old, secret);
    expect(verifySignedParams(old, secret)).toEqual({ ok: false, reason: 'link_expired' });
  });

  it('verifies vendor API requests within a 5 minute window', () => {
    const now = 1_800_000_000_000;
    const s = signRequest(secret, 'get', '/api/v1/vendor/outcomes?since=x', now);
    expect(verifyRequest(secret, { method: 'GET', pathWithQuery: '/api/v1/vendor/outcomes?since=x', ...s }, now + 60_000)).toEqual({
      ok: true,
    });
    expect(verifyRequest(secret, { method: 'GET', pathWithQuery: '/api/v1/vendor/outcomes?since=y', ...s }, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyRequest(secret, { method: 'GET', pathWithQuery: '/api/v1/vendor/outcomes?since=x', ...s }, now + 301_000)).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
  });
});

describe('direct callbacks', () => {
  const v = direct({ callbackUrl: 'https://panel.test/pb?uid=[UID]&s=[STATUS]&cc=[CC]', callbackStatuses: ['complete', 'quota_full'] });
  it('plans callbacks only for the chosen statuses and maps the status word', () => {
    expect(planCallback(v, resp(), 'terminate')).toBeNull();
    expect(planCallback(v, resp(), 'quota_full')).toEqual({
      method: 'GET',
      url: 'https://panel.test/pb?uid=abc%20123&s=overquota&cc=US',
      payload: null,
    });
  });
  it('signs timestamp.url.body like PROJEXA vendor callbacks', () => {
    const planned = planCallback(v, resp(), 'complete')!;
    const req = prepareCallback(v, planned, 'R1:complete', 1_800_000_000_000);
    expect(req.headers['X-Idempotency-Key']).toBe('R1:complete');
    expect(req.headers['X-Zapx-Timestamp']).toBe('1800000000');
    expect(req.headers['X-Zapx-Signature']).toBe(hmacHex(v.secret, `1800000000.${planned.url}.`));
  });
  it('retries transient failures and stops on permanent ones', () => {
    expect(classifyDelivery(v, 204)).toBe('delivered');
    for (const s of [null, 408, 429, 500, 503]) expect(classifyDelivery(v, s)).toBe('retry');
    for (const s of [400, 401, 404, 409, 410]) expect(classifyDelivery(v, s)).toBe('permanent');
  });
  it('backs off exponentially with jitter, capped at one hour', () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => retryDelayMs(n, DEFAULT_RETRY_POLICY, mid))).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000,
    ]);
    const low = retryDelayMs(1, DEFAULT_RETRY_POLICY, () => 0);
    const high = retryDelayMs(1, DEFAULT_RETRY_POLICY, () => 0.9999);
    expect(low).toBe(24_000);
    expect(high).toBeGreaterThan(35_000);
  });
});

describe('PROJEXA adapter (per docs/SURVEY_INTEGRATION.md)', () => {
  const p: ProjexaConfig = { kind: 'PROJEXA', baseUrl: 'https://projexa.test/', clientSecret: 'client-secret', s2sEnabled: true };
  const token = resp({ uid: 'tok_ABC-123' });
  it('redirects the browser to /r/{status}?token=', () => {
    expect(resolveRedirect(p, token, 'complete')).toMatchObject({
      url: 'https://projexa.test/r/complete?token=tok_ABC-123',
      source: 'partner',
    });
    expect(resolveRedirect(p, token, 'quota_full').url).toBe('https://projexa.test/r/quota_full?token=tok_ABC-123');
    expect(resolveRedirect(p, token, 'technical_error').url).toBe('https://projexa.test/r/technical_error?token=tok_ABC-123');
  });
  it('confirms the outcome with a signed S2S POST', () => {
    const planned = planCallback(p, token, 'partial')!;
    expect(planned).toEqual({
      method: 'POST',
      url: 'https://projexa.test/api/v1/s2s/outcome',
      payload: { token: 'tok_ABC-123', status: 'partial' },
    });
    const req = prepareCallback(p, planned, 'R1:partial', 1_800_000_000_000);
    const body = JSON.parse(req.body!);
    expect(body).toEqual({
      token: 'tok_ABC-123',
      status: 'partial',
      timestamp: 1_800_000_000,
      signature: projexaS2sSignature('client-secret', 'tok_ABC-123', 'partial', 1_800_000_000),
    });
    expect(body.signature).toBe(hmacHex('client-secret', 'tok_ABC-123.partial.1800000000'));
  });
  it('treats 409 as a conflict and 401/404 as permanent', () => {
    expect(classifyDelivery(p, 200)).toBe('delivered');
    expect(classifyDelivery(p, 409)).toBe('conflict');
    expect(classifyDelivery(p, 401)).toBe('permanent');
    expect(classifyDelivery(p, 404)).toBe('permanent');
    expect(classifyDelivery(p, 502)).toBe('retry');
  });
  it('sends no S2S without a client secret', () => {
    expect(planCallback({ ...p, clientSecret: null }, token, 'complete')).toBeNull();
  });
});
