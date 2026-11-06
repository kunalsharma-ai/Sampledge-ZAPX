/**
 * Integrations in the CRM, through the real UI: the administrator of the organization that runs the
 * installation pastes an IPinfo token (kept off, so other specs are not affected), sees only its last
 * characters afterwards, tests a connection, and hands the integration back to the server settings.
 * An administrator of a customer organization has no Integrations page.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { autoConfirm } from './confirm-helper';

const run = `m21${Date.now().toString(36)}`;
const password = 'e2e-password-123';
const cli = join(__dirname, '../../apps/api/dist/cli/set-operator.js');
let previous = '';

async function signUp(page: Page, label: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M21 ${label} ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`${label}@${run}.e2e.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
}

test.afterAll(() => {
  // Give the installation back to the organization that ran it before this spec.
  for (const id of previous.split(',').filter(Boolean)) execFileSync('node', [cli, id]);
});

test('integrations are set up in the CRM by the operator only', async ({ page, browser }) => {
  await autoConfirm(page);
  await signUp(page, 'operator');
  const out = execFileSync('node', [cli, `operator@${run}.e2e.test`]).toString();
  previous = /previous=(.*)/.exec(out)?.[1]?.trim() ?? '';

  // Start from the server settings, whatever an earlier run left behind.
  await page.request.delete('/api/platform/integrations/ipinfo', { headers: { 'x-zapx-csrf': '1' } });
  await page.goto('/settings');
  await page.getByTestId('integrations-link').click();
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  for (const key of ['anthropic', 'ipinfo', 'deepgram', 'twilio', 'stripe', 's3'])
    await expect(page.getByTestId(`integration-${key}`)).toBeVisible();

  const ipinfo = page.getByTestId('integration-ipinfo');
  await expect(ipinfo.getByTestId('integration-status')).toHaveText('Not set up');
  await ipinfo.getByRole('button', { name: 'Set up' }).click();
  await ipinfo.getByLabel(/Access token/).fill('e2e-ipinfo-token-abcd1234');
  await ipinfo.getByRole('button', { name: 'Save' }).click();
  await expect(ipinfo.getByText('Saved. Takes effect within a few seconds.')).toBeVisible();
  await expect(ipinfo.getByTestId('integration-status')).toHaveText('Off');
  // The token is never shown again, only its last characters.
  await ipinfo.getByRole('button', { name: 'Cancel' }).click();
  await expect(ipinfo.getByText('…1234')).toBeVisible();
  await expect(page.getByText('e2e-ipinfo-token-abcd1234')).toHaveCount(0);

  // Deepgram runs from the server environment in this test run; its stand-in is not listening now.
  const deepgram = page.getByTestId('integration-deepgram');
  await expect(deepgram.getByText('Running from the server environment. Saving here takes over from it.')).toBeVisible();
  await expect(deepgram.getByTestId('integration-status')).toHaveText('On');
  await deepgram.getByRole('button', { name: 'Test connection' }).click();
  await expect(deepgram.getByTestId('integration-test-result')).toContainText('✗');

  await expect(page.getByTestId('integrations-elsewhere')).toContainText('Single sign-on');
  await expect(page.getByTestId('integrations-developer')).toContainText('SECRETS_KEY');

  await page.goto('/settings/audit');
  await expect(page.locator('td', { hasText: 'platform.integration_saved' }).first()).toBeVisible();

  await page.goto('/settings/integrations');
  await page.getByTestId('integration-ipinfo').getByRole('button', { name: 'Use server settings instead' }).click();
  await expect(page.getByTestId('integration-ipinfo').getByTestId('integration-status')).toHaveText('Not set up');

  // A customer organization's administrator cannot see or change them.
  const other = await browser.newContext();
  const customer = await other.newPage();
  await signUp(customer, 'customer');
  await customer.goto('/settings');
  await expect(customer.getByRole('heading', { name: 'Organization settings' })).toBeVisible();
  await expect(customer.getByTestId('integrations-link')).toHaveCount(0);
  await customer.goto('/settings/integrations');
  await expect(customer.getByText(/managed by the administrators of the organization that runs this installation/)).toBeVisible();
  expect((await customer.request.get('/api/platform/integrations')).status()).toBe(403);
  await other.close();
});
