/**
 * Milestone 8 acceptance test, through the real UI: an administrator sees the plan and usage,
 * connects an OpenID Connect provider (a local mock, not a real identity provider), creates a SCIM
 * token and disables a member. A new person then signs in with SSO and is created as a viewer.
 */
import { expect, test } from '@playwright/test';
import { MockOidc } from '../../apps/api/test/support/mock-oidc';

const run = `m8${Date.now().toString(36)}`;
const domain = `${run}.e2e.test`;
let idp: MockOidc;

test.beforeAll(async () => {
  idp = await new MockOidc().start();
});
test.afterAll(async () => {
  await idp?.stop();
});

test('single sign-on, SCIM token, plan usage and disabling members', async ({ page, browser }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M8 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin@${domain}`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();

  // --- Plan and usage ---
  const plan = page.getByTestId('plan-usage');
  await expect(plan.getByRole('heading', { name: 'Plan: Enterprise' })).toBeVisible();
  await expect(plan.getByTestId('usage-Team members')).toContainText('1 (unlimited)');

  // --- Single sign-on ---
  const sso = page.getByTestId('sso-settings');
  await expect(sso.getByLabel('Redirect URI')).toHaveValue('http://localhost:3000/api/auth/sso/callback');
  await sso.getByLabel('Issuer URL').fill(idp.issuer);
  await sso.getByLabel('Client ID').fill(idp.clientId);
  await sso.getByLabel('Client secret').fill(idp.clientSecret);
  await sso.getByLabel('Email domains').fill(domain);
  await sso.getByLabel('New people who sign in').selectOption('VIEWER');
  await sso.getByRole('button', { name: 'Save single sign-on' }).click();
  await expect(sso.getByRole('status')).toHaveText('Saved. The identity provider answered correctly.');
  await expect(sso.getByLabel('Client secret')).toHaveAttribute('placeholder', 'Stored. Leave empty to keep it.');

  // --- SCIM token ---
  const scim = page.getByTestId('scim-settings');
  await scim.getByRole('button', { name: 'Create SCIM token' }).click();
  await expect(scim.getByLabel('SCIM token')).toHaveValue(/^scim_[0-9a-f]{12}_/);
  await scim.getByRole('button', { name: 'I have stored it' }).click();
  await expect(scim.getByTestId('scim-token-status')).toContainText('not used yet');

  // --- Disable a member ---
  const team = page.getByTestId('team');
  await team.getByLabel('Member name').fill('Dana Leaver');
  await team.getByLabel('Member email').fill(`dana@${domain}`);
  await team.getByLabel('Initial password').fill('member-password-1');
  await team.getByRole('button', { name: 'Add member' }).click();
  const dana = team.getByRole('row', { name: /Dana Leaver/ });
  await expect(dana).toContainText('active');
  await dana.getByRole('button', { name: 'Disable Dana Leaver' }).click();
  await expect(dana).toContainText('disabled');
  await expect(plan.getByTestId('usage-Team members')).toBeVisible();

  // --- A new person signs in with SSO and is created as a viewer ---
  idp.nextLogin = { claims: { sub: `idp-${run}`, email: `newcomer@${domain}`, name: 'Nia Newcomer' } };
  const other = await (await browser.newContext()).newPage();
  await other.goto('/login');
  await other.getByLabel('Email').fill(`newcomer@${domain}`);
  await other.getByRole('button', { name: 'Sign in with SSO' }).click();
  await expect(other.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(other.getByText('Nia Newcomer · viewer')).toBeVisible();

  // The disabled member cannot sign in.
  await other.context().clearCookies();
  await other.goto('/login');
  await other.getByLabel('Email').fill(`dana@${domain}`);
  await other.getByLabel('Password').fill('member-password-1');
  await other.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(other.getByText('Your account is disabled')).toBeVisible();
});
