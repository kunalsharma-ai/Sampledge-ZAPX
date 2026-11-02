import { describe, expect, it } from 'vitest';
import {
  REDIRECT_PRESETS,
  isAllowedReturnUrl,
  resolveRedirect,
  signParams,
  verifySignedParams,
  type VendorRedirectConfig,
} from '../src/vendors/redirects';

const sampledge = REDIRECT_PRESETS.find((p) => p.id === 'sampledge-platform')!;
const vendor = (over: Partial<VendorRedirectConfig> = {}): VendorRedirectConfig => ({
  code: 'SE',
  redirectMode: 'STATIC',
  staticUrls: sampledge.staticUrls,
  statusWords: sampledge.statusWords,
  dynamicAllowedHosts: [],
  secret: 's'.repeat(64),
  signRedirects: false,
  ...over,
});
const resp = (over = {}) => ({ responseId: 'R1', uid: 'abc 123', country: 'US', returnUrl: null, entryParams: { pid: 'P9' }, ...over });

describe('static redirects (Sampledge preset)', () => {
  it('produces the existing Sampledge platform URLs', () => {
    const v = vendor();
    expect(resolveRedirect(v, resp(), 'complete').url).toBe('https://platform.sampledge.com/response/status?status=complete&uid=abc%20123');
    expect(resolveRedirect(v, resp(), 'terminate').url).toContain('status=terminate&');
    expect(resolveRedirect(v, resp(), 'quota_full').url).toContain('status=overquota&');
    expect(resolveRedirect(v, resp(), 'security_reject').url).toContain('status=security&');
  });

  it('falls back for statuses without their own URL', () => {
    expect(resolveRedirect(vendor(), resp(), 'duplicate').url).toContain('status=security&');
    expect(resolveRedirect(vendor(), resp(), 'quality_fail').url).toContain('status=terminate&');
  });

  it('fills every placeholder and signs when asked', () => {
    const v = vendor({ staticUrls: { complete: 'https://x.test/c?u=[uid]&v=[VID]&c=[CC]&r=[RID]&p=[param:pid]&s=[STATUS]' }, signRedirects: true });
    const r = resolveRedirect(v, resp(), 'complete');
    expect(r.url).toMatch(/^https:\/\/x\.test\/c\?u=abc%20123&v=SE&c=US&r=R1&p=P9&s=complete&zsig=[0-9a-f]{64}$/);
  });
});

describe('dynamic and hybrid redirects', () => {
  const dyn = (mode: VendorRedirectConfig['redirectMode']) =>
    vendor({ redirectMode: mode, dynamicAllowedHosts: ['panel.example.com'] });

  it('uses the return URL supplied at entry when its host is allowed', () => {
    const r = resolveRedirect(dyn('DYNAMIC'), resp({ returnUrl: 'https://panel.example.com/back?id=[UID]' }), 'quota_full');
    expect(r).toEqual({ url: 'https://panel.example.com/back?id=abc%20123&status=overquota', source: 'dynamic' });
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

describe('signed entry links', () => {
  const secret = 'k'.repeat(64);
  it('accepts a correct signature and rejects tampering or expiry', () => {
    const params: Record<string, string> = { vid: 'SE', uid: 'u1', exp: String(Math.floor(Date.now() / 1000) + 60) };
    params.sig = signParams(params, secret);
    expect(verifySignedParams(params, secret)).toEqual({ ok: true });
    expect(verifySignedParams({ ...params, uid: 'u2' }, secret)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifySignedParams({ vid: 'SE', uid: 'u1' }, secret).ok).toBe(false);
    const old: Record<string, string> = { vid: 'SE', uid: 'u1', exp: '1000' };
    old.sig = signParams(old, secret);
    expect(verifySignedParams(old, secret)).toEqual({ ok: false, reason: 'link_expired' });
  });
});
