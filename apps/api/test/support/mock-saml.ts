/**
 * A minimal SAML 2.0 identity provider for tests (Milestone 13). It builds Responses with an
 * Assertion signed by xml-crypto (RSA-SHA256, exclusive c14n) and can be told to misbehave (wrong
 * audience, wrong issuer, expired, unsigned, signed by another key) to test that SampCode refuses them.
 *
 * Keys are generated per test run (testIdpKeys, needs the openssl command); none are stored in the repo.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignedXml } from 'xml-crypto';

/** A throwaway key pair and self-signed certificate, made with openssl for this test run only. */
export function testIdpKeys(cn = 'SampCode test IdP') {
  const dir = mkdtempSync(join(tmpdir(), 'zapx-saml-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
        '-days',
        '2',
        '-subj',
        `/CN=${cn}`,
      ],
      {
        stdio: 'ignore',
      },
    );
    return { key: readFileSync(join(dir, 'k.pem'), 'utf8'), cert: readFileSync(join(dir, 'c.pem'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const TEST_IDP_ISSUER = 'https://idp.test.zapx/saml';
export const TEST_IDP_SSO_URL = 'https://idp.test.zapx/sso';

export interface SamlAssertionInput {
  inResponseTo: string;
  audience: string;
  acsUrl: string;
  nameID: string;
  nameIDFormat?: string;
  attributes?: Record<string, string>;
  issuer?: string;
  /** Seconds from now until the assertion expires (negative = already expired). */
  validForSeconds?: number;
  /** The PEM private key to sign with; 'none' leaves the assertion unsigned. */
  key: string | 'none';
  status?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function samlResponse(a: SamlAssertionInput): string {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const until = new Date(now.getTime() + (a.validForSeconds ?? 300) * 1000);
  const issuer = esc(a.issuer ?? TEST_IDP_ISSUER);
  const aid = `_a${randomBytes(16).toString('hex')}`;
  const rid = `_r${randomBytes(16).toString('hex')}`;
  const attrs = Object.entries(a.attributes ?? {})
    .map(([k, v]) => `<saml:Attribute Name="${esc(k)}"><saml:AttributeValue>${esc(v)}</saml:AttributeValue></saml:Attribute>`)
    .join('');
  const status = a.status ?? 'urn:oasis:names:tc:SAML:2.0:status:Success';
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${aid}" Version="2.0" IssueInstant="${iso(now)}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="${esc(a.nameIDFormat ?? 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress')}">${esc(a.nameID)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${esc(a.inResponseTo)}" NotOnOrAfter="${iso(until)}" Recipient="${esc(a.acsUrl)}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(new Date(now.getTime() - 30_000))}" NotOnOrAfter="${iso(until)}"><saml:AudienceRestriction><saml:Audience>${esc(a.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="${aid}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    (attrs ? `<saml:AttributeStatement>${attrs}</saml:AttributeStatement>` : '') +
    `</saml:Assertion>`;
  let signed = assertion;
  if (a.key !== 'none') {
    const sig = new SignedXml({
      privateKey: a.key,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    sig.addReference({
      xpath: `//*[local-name(.)='Assertion']`,
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    sig.computeSignature(assertion, { location: { reference: `//*[local-name(.)='Issuer']`, action: 'after' } });
    signed = sig.getSignedXml();
  }
  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${rid}" Version="2.0" IssueInstant="${iso(now)}" Destination="${esc(a.acsUrl)}" InResponseTo="${esc(a.inResponseTo)}">` +
    `<saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${status}"/></samlp:Status>` +
    (status.endsWith(':Success') ? signed : '') +
    `</samlp:Response>`;
  return Buffer.from(xml).toString('base64');
}

/** The AuthnRequest ID and RelayState from the redirect URL SampCode produced. */
export async function readAuthnRequest(url: string) {
  const { inflateRawSync } = await import('node:zlib');
  const u = new URL(url);
  const xml = inflateRawSync(Buffer.from(u.searchParams.get('SAMLRequest') ?? '', 'base64')).toString();
  return { xml, id: /ID="([^"]+)"/.exec(xml)?.[1] ?? '', relayState: u.searchParams.get('RelayState') ?? '', url: u };
}
