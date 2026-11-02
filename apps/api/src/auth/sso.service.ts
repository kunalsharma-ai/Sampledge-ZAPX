import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hash } from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import type { Role } from '@zapx/db';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { PlanService } from '../plans/plan.service';
import { SecretBox } from '../platform/secret-box';
import { guardedFetch, isPrivateAddress } from '../common/net-guard';
import type { AuthUser } from './auth.types';

import { SsoError } from './sso-error';
import { normalizeCerts, SamlService, SsoVerifyError } from './saml.service';

export { SsoError };

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface SsoConfigInput {
  enabled: boolean;
  protocol: 'OIDC' | 'SAML';
  /** OIDC */
  issuer: string;
  clientId: string;
  /** Omitted to keep the stored secret. */
  clientSecret?: string;
  domains: string[];
  enforced: boolean;
  jitRole: Role | null;
  /** SAML */
  samlEntryPoint?: string | null;
  samlIdpIssuer?: string | null;
  samlCerts?: string[];
}

/** What the browser keeps (signed, in a short-lived cookie) between leaving for the IdP and returning. */
interface LoginState {
  tid: string;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

const STATE_TTL_SECONDS = 600;
const DISCOVERY_TTL_MS = 10 * 60_000;
const b64url = (b: Buffer) => b.toString('base64url');
export const emailDomain = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';
/** Only same-site relative paths are allowed after sign-in (no open redirects). */
/**
 * Where to go after sign-in: a path on this site only. Browsers drop tabs and newlines from
 * addresses, so "/\t/evil.example" would become "//evil.example"; control characters and spaces
 * are refused, and the result must still be on this site once parsed.
 */
export const safeNext = (next: unknown) => {
  if (typeof next !== 'string' || next.length > 500 || !next.startsWith('/') || next.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (next.includes('\\') || /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/.test(next)) return '/';
  try {
    const u = new URL(next, 'https://zapx.invalid');
    return u.origin === 'https://zapx.invalid' ? `${u.pathname}${u.search}${u.hash}` : '/';
  } catch {
    return '/';
  }
};

/**
 * OpenID Connect single sign-on (Milestone 8): authorization code flow with PKCE, a nonce, and
 * ID token verification against the provider's published keys. One provider per organization,
 * chosen by the email domain the person types.
 */
@Injectable()
export class SsoService {
  private readonly log = new Logger('SSO');
  private readonly discoveries = new Map<string, { doc: Discovery; at: number }>();
  private readonly keySets = new Map<string, JWTVerifyGetKey>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretBox,
    private readonly plans: PlanService,
    private readonly audit: AuditService,
    private readonly saml: SamlService,
  ) {}

  static callbackUrl() {
    return `${config().STUDIO_URL.replace(/\/$/, '')}/api/auth/sso/callback`;
  }

  private stateKey() {
    return createHmac('sha256', config().JWT_SECRET).update('zapx-sso-state').digest();
  }

  /** Identity provider addresses must be https on a public host (unless SSO_ALLOW_INSECURE_ISSUER). */
  private async checkUrl(raw: string, what: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SsoError(`The identity provider's ${what} is not a valid address`);
    }
    if (config().SSO_ALLOW_INSECURE_ISSUER) return url;
    if (url.protocol !== 'https:') throw new SsoError(`The identity provider's ${what} must use https`);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new SsoError(`The identity provider's ${what} must be reachable on the public internet`);
    }
    return url;
  }

  async discover(issuer: string): Promise<Discovery> {
    const cached = this.discoveries.get(issuer);
    if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
    const url = await this.checkUrl(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, 'issuer');
    const res = await guardedFetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      allowPrivate: config().SSO_ALLOW_INSECURE_ISSUER,
    }).catch((e: Error) => {
      throw new SsoError(`Could not reach the identity provider (${e.message})`);
    });
    if (!res.ok) throw new SsoError(`The identity provider's discovery document answered HTTP ${res.status}`);
    const doc = (await res.json().catch(() => null)) as Partial<Discovery> | null;
    if (!doc?.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri || !doc.issuer) {
      throw new SsoError('The identity provider did not publish a usable OpenID configuration');
    }
    if (doc.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) {
      throw new SsoError(`The identity provider says its issuer is ${doc.issuer}, not ${issuer}`);
    }
    for (const [k, what] of [
      ['authorization_endpoint', 'sign-in address'],
      ['token_endpoint', 'token address'],
      ['jwks_uri', 'key set address'],
    ] as const)
      await this.checkUrl(doc[k]!, what);
    this.discoveries.set(issuer, { doc: doc as Discovery, at: Date.now() });
    return doc as Discovery;
  }

  // ---- Settings (admins) ----------------------------------------------------------------------

  async getConfig(tenantId: string) {
    const c = await this.prisma.tenantSso.findUnique({ where: { tenantId } });
    const plan = await this.plans.plan(tenantId);
    return {
      available: plan.limits.sso,
      callbackUrl: SsoService.callbackUrl(),
      saml: { entityId: SamlService.entityId(), acsUrl: SamlService.acsUrl(), metadataUrl: SamlService.entityId() },
      config: c
        ? {
            enabled: c.enabled,
            protocol: c.protocol as 'OIDC' | 'SAML',
            samlEntryPoint: c.samlEntryPoint,
            samlIdpIssuer: c.samlIdpIssuer,
            samlCerts: c.samlCerts,
            issuer: c.issuer,
            clientId: c.clientId,
            clientSecretSet: !!c.clientSecretSealed,
            domains: c.domains,
            enforced: c.enforced,
            jitRole: c.jitRole,
            updatedAt: c.updatedAt,
          }
        : null,
    };
  }

  async saveConfig(user: AuthUser, input: SsoConfigInput) {
    await this.plans.assertFeature(user.tenantId, 'sso');
    const domains = [...new Set(input.domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
    if (!domains.length) throw new BadRequestException('Add at least one email domain');
    const clash = await this.prisma.tenantSso.findFirst({ where: { tenantId: { not: user.tenantId }, domains: { hasSome: domains } } });
    if (clash) throw new ConflictException('One of these domains already signs in to another organization');
    const before = await this.prisma.tenantSso.findUnique({ where: { tenantId: user.tenantId } });
    if (input.protocol === 'SAML') return this.saveSaml(user, input, domains);
    if (!input.issuer || !input.clientId) throw new BadRequestException('Enter the issuer and the client ID');
    if (!(before?.protocol === 'OIDC' && before.clientSecretSealed) && !input.clientSecret)
      throw new BadRequestException('Enter the client secret');
    const issuer = input.issuer.trim().replace(/\/$/, '');
    if (input.enabled) {
      // Check the provider now, so a typo is caught here rather than at everyone's next sign-in.
      this.discoveries.delete(issuer);
      await this.discover(issuer).catch((e: unknown) => {
        throw new BadRequestException(e instanceof SsoError ? e.message : 'Could not check the identity provider');
      });
    }
    const data = {
      enabled: input.enabled,
      protocol: 'OIDC',
      samlEntryPoint: null,
      samlIdpIssuer: null,
      samlCerts: [],
      issuer,
      clientId: input.clientId.trim(),
      ...(input.clientSecret ? { clientSecretSealed: this.secrets.seal(input.clientSecret) } : {}),
      domains,
      enforced: input.enforced,
      jitRole: input.jitRole,
      updatedById: user.id,
    };
    await this.prisma.tenantSso.upsert({
      where: { tenantId: user.tenantId },
      create: { tenantId: user.tenantId, clientSecretSealed: '', ...data },
      update: data,
    });
    await this.audit.record(user, 'sso.update', 'tenant', user.tenantId, {
      enabled: data.enabled,
      issuer,
      clientId: data.clientId,
      domains,
      enforced: data.enforced,
      jitRole: data.jitRole,
      secretChanged: !!input.clientSecret,
    });
    return this.getConfig(user.tenantId);
  }

  private async saveSaml(user: AuthUser, input: SsoConfigInput, domains: string[]) {
    const entryPoint = input.samlEntryPoint?.trim() ?? '';
    const idpIssuer = input.samlIdpIssuer?.trim() ?? '';
    if (!entryPoint || !idpIssuer || !input.samlCerts?.length) {
      throw new BadRequestException('Enter the sign-in URL, the entity ID and the signing certificate of the identity provider');
    }
    let certs: string[];
    try {
      await this.checkUrl(entryPoint, 'sign-in URL');
      certs = normalizeCerts(input.samlCerts);
    } catch (e) {
      throw new BadRequestException(e instanceof SsoError ? e.message : 'The SAML settings are not valid');
    }
    const data = {
      enabled: input.enabled,
      protocol: 'SAML',
      samlEntryPoint: entryPoint,
      samlIdpIssuer: idpIssuer,
      samlCerts: certs,
      // The OpenID Connect settings do not apply; the stored client secret is removed.
      issuer: '',
      clientId: '',
      clientSecretSealed: '',
      domains,
      enforced: input.enforced,
      jitRole: input.jitRole,
      updatedById: user.id,
    };
    await this.prisma.tenantSso.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, ...data }, update: data });
    await this.audit.record(user, 'sso.update', 'tenant', user.tenantId, {
      enabled: data.enabled,
      protocol: 'SAML',
      entryPoint,
      idpIssuer,
      certificates: certs.length,
      domains,
      enforced: data.enforced,
      jitRole: data.jitRole,
    });
    return this.getConfig(user.tenantId);
  }

  /** True when the member's organization requires SSO for everyone but admins. */
  async passwordBlocked(tenantId: string, role: string) {
    if (role === 'ADMIN') return false;
    const c = await this.prisma.tenantSso.findUnique({ where: { tenantId }, select: { enabled: true, enforced: true } });
    return !!(c?.enabled && c.enforced);
  }

  // ---- Sign-in --------------------------------------------------------------------------------

  private async providerFor(email: string) {
    const domain = emailDomain(email);
    const c = domain ? await this.prisma.tenantSso.findFirst({ where: { enabled: true, domains: { has: domain } } }) : null;
    if (!c) throw new NotFoundException('Single sign-on is not set up for this email domain');
    if (!(await this.plans.plan(c.tenantId)).limits.sso) throw new NotFoundException('Single sign-on is not set up for this email domain');
    return c;
  }

  /** Start a sign-in: returns the provider's authorization URL and the signed state for the cookie. */
  async begin(email: string, next: unknown): Promise<{ url: string; cookie: string | null; maxAgeMs: number }> {
    const c = await this.providerFor(email.toLowerCase());
    if (c.protocol === 'SAML') {
      const url = await this.saml.begin(c, email, safeNext(next)).catch((e: unknown) => {
        throw new BadRequestException(e instanceof SsoError ? e.message : 'Could not start the SAML sign-in');
      });
      return { url, cookie: null, maxAgeMs: 0 };
    }
    const doc = await this.discover(c.issuer).catch((e: unknown) => {
      throw new BadRequestException(e instanceof SsoError ? e.message : 'Could not reach the identity provider');
    });
    const st: LoginState = {
      tid: c.tenantId,
      state: b64url(randomBytes(24)),
      nonce: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(32)),
      next: safeNext(next),
    };
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      ...Object.fromEntries(url.searchParams),
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: SsoService.callbackUrl(),
      scope: 'openid email profile',
      state: st.state,
      nonce: st.nonce,
      code_challenge: b64url(createHash('sha256').update(st.verifier).digest()),
      code_challenge_method: 'S256',
      login_hint: email,
    }).toString();
    const cookie = await new SignJWT({ ...st })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${STATE_TTL_SECONDS}s`)
      .setAudience('zapx-sso-state')
      .sign(this.stateKey());
    return { url: url.toString(), cookie, maxAgeMs: STATE_TTL_SECONDS * 1000 };
  }

  /** Finish a sign-in: verify the state, exchange the code, verify the ID token, find or create the member. */
  async complete(query: { code?: string; state?: string; error?: string; error_description?: string }, cookie: string | undefined) {
    if (query.error) throw new SsoError(`The identity provider refused the sign-in: ${query.error_description ?? query.error}`);
    if (!cookie) throw new SsoError('The sign-in took too long or was started in another browser. Try again.');
    let st: LoginState;
    try {
      st = (await jwtVerify(cookie, this.stateKey(), { audience: 'zapx-sso-state' })).payload as unknown as LoginState;
    } catch {
      throw new SsoError('The sign-in took too long or was started in another browser. Try again.');
    }
    if (!query.code || !query.state || query.state !== st.state) throw new SsoError('The sign-in response did not match. Try again.');

    const c = await this.prisma.tenantSso.findUnique({ where: { tenantId: st.tid } });
    if (!c?.enabled || c.protocol !== 'OIDC') throw new SsoError('Single sign-on is turned off for this organization');
    const doc = await this.discover(c.issuer);

    const tokenRes = await guardedFetch(doc.token_endpoint, {
      method: 'POST',
      allowPrivate: config().SSO_ALLOW_INSECURE_ISSUER,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: SsoService.callbackUrl(),
        client_id: c.clientId,
        client_secret: this.secrets.open(c.clientSecretSealed),
        code_verifier: st.verifier,
      }),
    }).catch((e: Error) => {
      throw new SsoError(`Could not reach the identity provider (${e.message})`);
    });
    const tokens = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!tokenRes.ok || !tokens.id_token) {
      this.log.warn(`Token exchange failed for tenant ${c.tenantId}: HTTP ${tokenRes.status} ${tokens.error ?? ''}`);
      throw new SsoError(
        `The identity provider did not accept the sign-in (${tokens.error_description ?? tokens.error ?? `HTTP ${tokenRes.status}`})`,
      );
    }

    let keys = this.keySets.get(doc.jwks_uri);
    if (!keys) this.keySets.set(doc.jwks_uri, (keys = createRemoteJWKSet(new URL(doc.jwks_uri))));
    let claims: Record<string, unknown>;
    try {
      claims = (await jwtVerify(tokens.id_token, keys, { issuer: doc.issuer, audience: c.clientId, clockTolerance: 60 })).payload;
    } catch (e) {
      this.log.warn(`ID token rejected for tenant ${c.tenantId}: ${(e as Error).message}`);
      throw new SsoError('The identity provider sent a sign-in that could not be verified');
    }
    if (claims.nonce !== st.nonce) throw new SsoError('The sign-in response did not match. Try again.');
    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!sub || !email) throw new SsoError('The identity provider did not share your email address');
    if (claims.email_verified === false) throw new SsoError('Your email address is not verified with the identity provider');
    if (!c.domains.includes(emailDomain(email))) throw new SsoError(`${email} is not in a domain this organization signs in with`);

    const user = await this.member(c.tenantId, sub, email, typeof claims.name === 'string' ? claims.name : '', c.jitRole);
    await this.audit.record(user, 'auth.sso_login', 'user', user.id, { issuer: doc.issuer });
    return { user, next: st.next };
  }

  /** Finish a SAML sign-in posted by the identity provider. */
  async completeSaml(body: Record<string, unknown>) {
    let login;
    try {
      login = await this.saml.complete(body);
    } catch (e) {
      if (e instanceof SsoVerifyError) this.log.warn(`SAML response rejected: ${e.detail}`);
      throw e;
    }
    const c = await this.prisma.tenantSso.findUnique({ where: { tenantId: login.tenantId } });
    if (!c || !c.domains.includes(emailDomain(login.email))) {
      throw new SsoError(`${login.email} is not in a domain this organization signs in with`);
    }
    if (!(await this.plans.plan(login.tenantId)).limits.sso)
      throw new SsoError("Single sign-on is not included in this organization's plan");
    const user = await this.member(login.tenantId, login.subject, login.email, login.name, c.jitRole);
    await this.audit.record(user, 'auth.sso_login', 'user', user.id, { protocol: 'SAML', issuer: c.samlIdpIssuer });
    return { user, next: login.next };
  }

  private async member(tenantId: string, sub: string, email: string, name: string, jitRole: Role | null) {
    let user = await this.prisma.user.findUnique({ where: { tenantId_ssoSubject: { tenantId, ssoSubject: sub } } });
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      if (byEmail && byEmail.tenantId !== tenantId) throw new SsoError('This email address belongs to another ZAPX organization');
      if (byEmail?.ssoSubject && byEmail.ssoSubject !== sub) throw new SsoError('This account is linked to a different identity');
      if (byEmail) {
        user = await this.prisma.user.update({ where: { id: byEmail.id }, data: { ssoSubject: sub } });
      } else {
        if (!jitRole) throw new SsoError('You do not have a ZAPX account yet. Ask your administrator to add you.');
        await this.plans.assertSeat(tenantId, jitRole).catch((e: Error) => {
          throw new SsoError(`Your account could not be created: ${e.message}`);
        });
        user = await this.prisma.user.create({
          data: {
            tenantId,
            email,
            name: name.trim().slice(0, 120) || email,
            role: jitRole,
            ssoSubject: sub,
            // Not usable: SSO members sign in through their provider. An admin can set a password later.
            passwordHash: await hash(b64url(randomBytes(32)), 10),
          },
        });
        await this.audit.record(
          { id: user.id, tenantId, role: user.role, email: user.email, projectScope: user.projectScope },
          'user.sso_provision',
          'user',
          user.id,
          { email, role: jitRole },
        );
      }
    }
    if (user.disabledAt) throw new SsoError('Your account is disabled');
    return { id: user.id, tenantId: user.tenantId, role: user.role, email: user.email, projectScope: user.projectScope };
  }
}
