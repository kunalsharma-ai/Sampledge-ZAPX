/**
 * Milestone 6 acceptance test, through the real UI: an administrator adds a programmer who only
 * sees assigned projects and adds them to one project; creates and revokes an API key; adds a
 * webhook and sends a test event; finds those changes in the audit log. The programmer then signs
 * in and sees only the assigned project.
 */
import { expect, test } from '@playwright/test';

const run = `m6${Date.now().toString(36)}`;
const patEmail = `pat-${run}@test.zapx`;

test('project access, API keys, webhooks and the audit log', async ({ page, browser }) => {
  page.on('dialog', (d) => void d.accept());

  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M6 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`e2e-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  for (const name of ['Alpha study', 'Beta study']) {
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('link', { name })).toBeVisible();
  }

  // --- Team: a programmer with assigned project access ---
  await page.getByRole('link', { name: 'Settings' }).click();
  const team = page.getByTestId('team');
  await team.getByLabel('Member name').fill('Pat Programmer');
  await team.getByLabel('Member email').fill(patEmail);
  await team.getByLabel('Initial password').fill('member-password-1');
  await team.getByLabel('Role', { exact: true }).selectOption('PROGRAMMER');
  await team.getByLabel('Project access', { exact: true }).selectOption('ASSIGNED');
  await team.getByRole('button', { name: 'Add member' }).click();
  await expect(team.getByLabel('Project access of Pat Programmer')).toHaveValue('ASSIGNED');

  // --- API key: shown once, then revoked ---
  const keys = page.getByTestId('api-keys');
  await keys.getByLabel('Key label').fill('Nightly export');
  await keys.getByLabel('Key role').selectOption('VIEWER');
  await keys.getByRole('button', { name: 'Create API key' }).click();
  await expect(keys.getByTestId('new-api-key').getByLabel('New API key')).toHaveValue(/^zapx_[0-9a-f]{12}_/);
  await keys.getByRole('button', { name: 'I have stored it' }).click();
  await expect(keys.getByTestId('new-api-key')).toHaveCount(0);
  const keyRow = keys.getByRole('row', { name: /Nightly export/ });
  await expect(keyRow).toContainText('active');
  await keyRow.getByRole('button', { name: 'Revoke Nightly export' }).click();
  await expect(keyRow).toContainText('revoked');

  // --- Webhook: signing secret, test event, delivery log ---
  const hooks = page.getByTestId('webhooks');
  await hooks.getByLabel('Endpoint URL').fill('https://hooks.example.invalid/zapx');
  await hooks.getByLabel('survey.status_changed').check();
  await hooks.getByRole('button', { name: 'Add webhook' }).click();
  await expect(hooks.getByTestId('webhook-secret').getByLabel('Signing secret')).toHaveValue(/^whsec_/);
  const hook = hooks.getByTestId('webhook');
  await expect(hook).toContainText('response.finished, survey.status_changed');
  await hook.getByRole('button', { name: 'Send test event' }).click();
  await hook.getByRole('button', { name: 'Show deliveries' }).click();
  await expect(hook.getByTestId('webhook-deliveries')).toContainText('webhook.test');

  // --- Project access: add Pat to Alpha only ---
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'Alpha study' }).click();
  const access = page.getByTestId('project-access');
  await access.getByLabel('Member to add').selectOption({ label: 'Pat Programmer (programmer)' });
  await access.getByRole('button', { name: 'Add to project' }).click();
  await expect(access.getByRole('row', { name: /Pat Programmer/ })).toContainText('added to this project');

  // --- Audit log ---
  await page.goto('/settings/audit');
  const table = page.getByTestId('audit-table');
  await expect(table).toContainText('project.member_add');
  await expect(table).toContainText('api_key.revoke');
  await page.getByTestId('audit-filters').getByLabel('Action').selectOption('webhook.');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(table).toContainText('webhook.create');
  await expect(table).not.toContainText('project.member_add');
  await expect(page.getByRole('link', { name: 'Download CSV' })).toHaveAttribute('href', /\/api\/audit\/export\.csv\?action=webhook\./);

  // --- Pat sees only the assigned project ---
  const pat = await (await browser.newContext()).newPage();
  await pat.goto('/login');
  await pat.getByLabel('Email').fill(patEmail);
  await pat.getByLabel('Password').fill('member-password-1');
  await pat.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(pat.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(pat.getByRole('link', { name: 'Alpha study' })).toBeVisible();
  await expect(pat.getByRole('link', { name: 'Beta study' })).toHaveCount(0);
  await expect(pat.getByRole('link', { name: 'API keys' })).toBeVisible();
});
