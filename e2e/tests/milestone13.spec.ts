/**
 * Milestone 13 acceptance test, through the real UI: an administrator connects a SAML identity
 * provider (a local test IdP that signs with a throwaway key, not a real identity provider), and a new
 * person signs in through it from the login page: SampCode sends the browser to the IdP, the IdP posts a
 * signed response back to the ACS URL, and the person lands in the studio as a viewer. The billing
 * panel says plainly that online billing is off on this installation.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { readAuthnRequest, samlResponse, testIdpKeys } from '../../apps/api/test/support/mock-saml';

const run = `m13${Date.now().toString(36)}`;
const domain = `${run}.e2e.test`;
const ISSUER = `https://idp.${run}.e2e.test/saml`;
const keys = testIdpKeys('E2E test IdP');
let server: Server;
let ssoUrl = '';

test.beforeAll(async () => {
  // The IdP "signs in" whoever SampCode names in login_hint and posts the response straight back.
  server = createServer((req, res) => {
    void (async () => {
      const url = `http://127.0.0.1${req.url ?? '/'}`;
      const authn = await readAuthnRequest(url);
      const acs = /AssertionConsumerServiceURL="([^"]+)"/.exec(authn.xml)![1]!;
      const audience = />([^<]+)<\/saml:Issuer>/.exec(authn.xml)![1]!;
      const email = authn.url.searchParams.get('login_hint') ?? '';
      const response = samlResponse({
        key: keys.key,
        issuer: ISSUER,
        inResponseTo: authn.id,
        audience,
        acsUrl: acs,
        nameID: email,
        attributes: { displayName: 'Sam Saml' },
      });
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><title>Test IdP</title><form method="post" action="${acs}">` +
            `<input type="hidden" name="SAMLResponse" value="${response}"><input type="hidden" name="RelayState" value="${authn.relayState}">` +
            `<p>Test identity provider: signing in ${email}</p><button>Continue</button></form>` +
            `<script>document.forms[0].submit()</script>`,
        );
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  ssoUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sso`;
});
test.afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

test('SAML single sign-on from the login page, and the billing panel', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M13 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin@${domain}`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();

  await expect(page.getByTestId('billing')).toContainText('Online billing is not turned on for this SampCode installation.');

  const sso = page.getByTestId('sso-settings');
  await sso.getByRole('radio', { name: 'SAML 2.0' }).check();
  await expect(sso.getByLabel('Entity ID (audience)')).toHaveValue('http://localhost:3000/api/auth/sso/saml/metadata');
  await expect(sso.getByLabel('Assertion consumer service (ACS) URL')).toHaveValue('http://localhost:3000/api/auth/sso/saml/acs');
  await sso.getByLabel('Identity provider sign-in URL').fill(ssoUrl);
  await sso.getByLabel('Identity provider entity ID (issuer)').fill(ISSUER);
  await sso.getByLabel(/Signing certificate/).fill(keys.cert);
  await sso.getByLabel('Email domains').fill(domain);
  await sso.getByLabel('New people who sign in').selectOption('VIEWER');
  await sso.getByRole('button', { name: 'Save single sign-on' }).click();
  await expect(sso.getByRole('status')).toHaveText('Saved. Sign in once from a private window to check the identity provider.');

  const metadata = await page.request.get('/api/auth/sso/saml/metadata');
  expect(await metadata.text()).toContain('AssertionConsumerService');

  // A new person signs in from a fresh browser.
  const other = await (await browser.newContext()).newPage();
  await other.goto('/login');
  await other.getByLabel('Email').fill(`sam@${domain}`);
  await other.getByRole('button', { name: 'Sign in with SSO' }).click();
  await expect(other.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(other.getByText('Sam Saml · viewer')).toBeVisible();

  // Someone outside the configured domains is sent back to the login page with the reason.
  await other.context().clearCookies();
  await other.goto('/login');
  await other.getByLabel('Email').fill(`intruder@elsewhere-${run}.test`);
  await other.getByRole('button', { name: 'Sign in with SSO' }).click();
  await expect(other.getByText('Single sign-on is not set up for this email domain')).toBeVisible();
});
