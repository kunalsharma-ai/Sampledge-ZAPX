/**
 * Super admin, through the real UI: the super admin registers an organization, sees it in the
 * console, and switches a feature off for it; the organization's administrator, already signed in,
 * loses the menu entry without reloading and the API refuses the feature. Suspending the
 * organization sends its administrator to the suspended page.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { autoConfirm } from './confirm-helper';

const run = `sa${Date.now().toString(36)}`;
const password = 'e2e-password-123';
const operatorCli = join(__dirname, '../../apps/api/dist/cli/set-operator.js');
const superCli = join(__dirname, '../../apps/api/dist/cli/set-super-admin.js');
const superEmail = `super@${run}.e2e.test`;
let previous = '';

async function signUp(page: Page, label: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E SA ${label} ${run}`);
  await page.getByLabel('Your name').fill(`E2E ${label}`);
  await page.getByLabel('Email').fill(`${label}@${run}.e2e.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
}

test.afterAll(() => {
  execFileSync('node', [superCli, superEmail, '--remove']);
  for (const id of previous.split(',').filter(Boolean)) execFileSync('node', [operatorCli, id]);
});

test('the super admin controls an organization’s features live', async ({ page, browser }) => {
  page.on('dialog', (d) => void d.accept('Unpaid'));
  await autoConfirm(page);
  await signUp(page, 'super');
  previous = /previous=(.*)/.exec(execFileSync('node', [operatorCli, superEmail]).toString())?.[1]?.trim() ?? '';
  execFileSync('node', [superCli, superEmail]);

  // A customer organization, signed in in another browser.
  const customer = await (await browser.newContext()).newPage();
  await signUp(customer, 'customer');
  await expect(customer.getByRole('link', { name: 'Question bank' })).toBeVisible();

  await page.goto('/super-admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByTestId('kpi-orgs')).toBeVisible();

  // Register a new organization: its administrator gets a setup link.
  await page.goto('/super-admin/organizations');
  await page.getByTestId('show-register').click();
  await page.getByTestId('org-name-input').fill(`Registered ${run}`);
  await page.getByTestId('admin-name-input').fill('New Admin');
  await page.getByTestId('admin-email-input').fill(`new@${run}.e2e.test`);
  await page.getByTestId('register-org-submit').click();
  await expect(page.getByTestId('org-created')).toContainText(`Registered ${run}`);
  await expect(page.getByLabel('Setup link')).toHaveValue(/reset-password\?token=/);

  // Switch the question bank off for the customer organization.
  await page.getByLabel('Search organizations').fill(`E2E SA customer ${run}`);
  await page.getByRole('link', { name: `E2E SA customer ${run}` }).click();
  await expect(page.getByTestId('org-feature-matrix')).toBeVisible();
  await page.getByTestId('feature-library-web').uncheck();
  await page.getByTestId('save-org-features').click();
  await expect(page.getByText('Saved. Applies at once.').first()).toBeVisible();

  // The customer's menu loses the entry without a reload, and the API refuses it.
  await expect(customer.getByRole('link', { name: 'Question bank' })).toHaveCount(0, { timeout: 20_000 });
  const r = await customer.request.get('/api/library');
  expect(r.status()).toBe(403);
  expect((await r.json()).code).toBe('FEATURE_DISABLED');

  // The change is in the activity, and suspending sends the customer to the suspended page.
  await page.getByTestId('suspend').click();
  await expect(page.getByTestId('reactivate')).toBeVisible();
  await customer.goto('/projects');
  await expect(customer.getByTestId('suspended')).toBeVisible();
  await page.getByTestId('reactivate').click();
  await expect(page.getByTestId('suspend')).toBeVisible();
  await page.goto('/super-admin/activity');
  await expect(page.getByTestId('activity-feed')).toContainText('Organization reactivated');
});

test('an organization administrator cannot open the console', async ({ page }) => {
  await signUp(page, 'other');
  await expect(page.getByRole('link', { name: 'Super admin' })).toHaveCount(0);
  await page.goto('/super-admin');
  await expect(page.getByTestId('super-admin-denied')).toBeVisible();
});
