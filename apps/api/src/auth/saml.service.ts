/**
 * SAML 2.0 single sign-on (Milestone 13), next to OpenID Connect. SampCode is the service provider:
 * SP-initiated sign-in only, AuthnRequest by HTTP-Redirect, the response by HTTP-POST to the ACS URL.
 *
 * Checks (by @node-saml/node-saml, configured strictly here): the assertion is signed by one of the
 * organization's IdP certificates (wantAssertionsSigned), the Audience is SampCode's entity ID, timestamps hold within 60 s of skew, and InResponseTo matches a
 * request SampCode made in the last 10 minutes. SampCode itself
 * checks that the signed assertion's Issuer is the IdP entity ID (the library does not for sign-ins). Each request can be answered once: its row is deleted
 * when the response is checked, so a captured response cannot be replayed. IdP-initiated sign-in
 * (a response with no request) is refused, because it cannot be bound to a browser.
 */
import { Injectable } from '@nestjs/common';
import { randomBytes, X509Certificate } from 'node:crypto';
import {
  SAML,
  SamlStatusError,
  ValidateInResponseTo,
  generateServiceProviderMetadata,
  type CacheProvider,
  type Profile,
} from '@node-saml/node-saml';
import type { TenantSso } from '@zapx/db';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { SsoError } from './sso-error';

const REQUEST_TTL_MS = 10 * 60_000;
const TRANSIENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';

/** Attribute names identity providers use for the email address and the display name. */
const EMAIL_ATTRS = [
  'email',
  'mail',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.xmlsoap.org/claims/EmailAddress',
];
const NAME_ATTRS = ['displayName', 'name', 'http://schemas.microsoft.com/identity/claims/displayname', 'urn:oid:2.16.840.1.113730.3.1.241'];
const GIVEN = ['givenName', 'firstName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname', 'urn:oid:2.5.4.42'];
const SURNAME = ['sn', 'surname', 'lastName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname', 'urn:oid:2.5.4.4'];

function attr(p: Profile, names: string[]): string {
  for (const n of names) {
    const v = p[n];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s.trim()) return s.trim();
  }
  return '';
}

/** PEM bodies (or bare base64) to normalized PEM; throws SsoError for anything that is not a certificate. */
export function normalizeCerts(input: string[]): string[] {
  return input.map((raw, i) => {
    const body = raw.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
    const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END CERTIFICATE-----\n`;
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(pem);
    } catch {
      throw new SsoError(`Certificate ${i + 1} is not a valid X.509 certificate`);
    }
    if (new Date(cert.validTo).getTime() < Date.now()) throw new SsoError(`Certificate ${i + 1} expired on ${cert.validTo}`);
    return pem;
  });
}

export interface SamlLogin {
  tenantId: string;
  subject: string;
  email: string;
  name: string;
  next: string;
}

@Injectable()
export class SamlService {
  constructor(private readonly prisma: PrismaService) {}

  private static base() {
    return config().STUDIO_URL.replace(/\/$/, '');
  }
  /** SampCode's entity ID; also the address of its metadata. */
  static entityId() {
    return `${SamlService.base()}/api/auth/sso/saml/metadata`;
  }
  /** Assertion Consumer Service: where the IdP posts the response. */
  static acsUrl() {
    return `${SamlService.base()}/api/auth/sso/saml/acs`;
  }

  /** Service provider metadata for the IdP admin to import. */
  metadata() {
    return generateServiceProviderMetadata({
      issuer: SamlService.entityId(),
      callbackUrl: SamlService.acsUrl(),
      identifierFormat: null,
      wantAssertionsSigned: true,
    });
  }

  private saml(c: TenantSso, cache: CacheProvider, id?: string) {
    if (!c.samlEntryPoint || !c.samlIdpIssuer || !c.samlCerts.length) throw new SsoError('SAML sign-in is not fully set up');
    return new SAML({
      entryPoint: c.samlEntryPoint,
      issuer: SamlService.entityId(),
      callbackUrl: SamlService.acsUrl(),
      audience: SamlService.entityId(),
      idpCert: c.samlCerts,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: REQUEST_TTL_MS,
      acceptedClockSkewMs: 60_000,
      identifierFormat: null,
      disableRequestedAuthnContext: true,
      cacheProvider: cache,
      ...(id ? { generateUniqueId: () => id } : {}),
    });
  }

  /** Start a sign-in: stores the request and returns the IdP URL to send the browser to. */
  async begin(c: TenantSso, email: string, next: string) {
    const id = `_${randomBytes(20).toString('hex')}`;
    const prisma = this.prisma;
    const cache: CacheProvider = {
      async saveAsync(key) {
        const row = await prisma.ssoRequest.create({
          data: { id: key, tenantId: c.tenantId, next, expiresAt: new Date(Date.now() + REQUEST_TTL_MS) },
        });
        return { value: row.createdAt.toISOString(), createdAt: row.createdAt.getTime() };
      },
      getAsync: () => Promise.resolve(null),
      removeAsync: () => Promise.resolve(null),
    };
    // RelayState carries the request ID back, so the ACS knows which organization's settings to check against.
    const url = new URL(await this.saml(c, cache, id).getAuthorizeUrlAsync(id, undefined, {}));
    url.searchParams.set('login_hint', email);
    return url.toString();
  }

  /** Finish a sign-in from the IdP's POST. Throws SsoError with a message for the person. */
  async complete(body: Record<string, unknown>): Promise<SamlLogin> {
    const response = typeof body.SAMLResponse === 'string' ? body.SAMLResponse : '';
    const relay = typeof body.RelayState === 'string' ? body.RelayState : '';
    if (!response) throw new SsoError('The identity provider did not send a sign-in response');
    if (!/^_[a-f0-9]{40}$/.test(relay)) {
      throw new SsoError('Sign in from the SampCode login page. Sign-ins started at the identity provider are not accepted.');
    }
    const req = await this.prisma.ssoRequest.findUnique({ where: { id: relay } });
    if (!req || req.expiresAt < new Date()) throw new SsoError('The sign-in took too long or was already used. Try again.');
    const c = await this.prisma.tenantSso.findUnique({ where: { tenantId: req.tenantId } });
    if (!c?.enabled || c.protocol !== 'SAML') throw new SsoError('Single sign-on is turned off for this organization');

    const prisma = this.prisma;
    const cache: CacheProvider = {
      saveAsync: () => Promise.resolve(null),
      // Only the request this browser started counts, and only once.
      getAsync: (key) => Promise.resolve(key === req.id ? req.createdAt.toISOString() : null),
      async removeAsync(key) {
        if (key) await prisma.ssoRequest.deleteMany({ where: { id: key } });
        return key;
      },
    };
    let profile: Profile | null;
    try {
      ({ profile } = await this.saml(c, cache).validatePostResponseAsync({ SAMLResponse: response }));
    } catch (e) {
      await prisma.ssoRequest.deleteMany({ where: { id: req.id } });
      const msg = (e as Error).message ?? '';
      // A status error carries the IdP's own reason, which is safe and useful to show.
      if (e instanceof SamlStatusError) throw new SsoError(`The identity provider refused the sign-in: ${msg}`);
      throw new SsoVerifyError(msg);
    }
    await prisma.ssoRequest.deleteMany({ where: { id: req.id } });
    if (!profile?.nameID) throw new SsoError('The identity provider did not identify you');
    // The library checks the issuer only on logout messages, so the signed assertion's Issuer is checked here.
    if (profile.issuer !== c.samlIdpIssuer) throw new SsoVerifyError(`issuer ${String(profile.issuer)} is not ${c.samlIdpIssuer}`);
    if (profile.nameIDFormat === TRANSIENT) {
      throw new SsoError('The identity provider sends a transient name ID; set it to persistent or email address for SampCode');
    }
    const email = (attr(profile, EMAIL_ATTRS) || (/^[^@\s]+@[^@\s]+$/.test(profile.nameID) ? profile.nameID : '')).toLowerCase();
    if (!email) throw new SsoError('The identity provider did not share your email address');
    const name = attr(profile, NAME_ATTRS) || [attr(profile, GIVEN), attr(profile, SURNAME)].filter(Boolean).join(' ');
    return { tenantId: c.tenantId, subject: `saml:${profile.nameID}`, email, name, next: req.next };
  }
}

/** The response failed verification; the detail is logged, not shown. */
export class SsoVerifyError extends SsoError {
  constructor(readonly detail: string) {
    super('The identity provider sent a sign-in that could not be verified');
  }
}
