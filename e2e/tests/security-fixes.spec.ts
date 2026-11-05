/**
 * Security fixes after the handbook review, through the real UI: an administrator creates a reset
 * link for a member, the member sets a new password with it, and a member changes their own
 * password on "My account".
 */
import { expect, test } from '@playwright/test';

const run = `sec${Date.now().toString(36)}`;
const email = `admin@${run}.e2e.test`;
const memberEmail = `pat@${run}.e2e.test`;
const password = 'e2e-password-123';

test('reset link, new password and change password', async ({ page, browser }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E security ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  const team = page.getByTestId('team');
  await team.getByLabel('Member name').fill('Pat Programmer');
  await team.getByLabel('Member email').fill(memberEmail);
  await team.getByLabel('Initial password').fill('member-password-1');
  await team.getByLabel('Role', { exact: true }).selectOption('PROGRAMMER');
  await team.getByRole('button', { name: 'Add member' }).click();
  await team
    .getByRole('row', { name: /Pat Programmer/ })
    .getByRole('button', { name: 'Reset password' })
    .click();
  const url = await team.getByTestId('reset-link').getByLabel('Reset link').inputValue();
  expect(url).toMatch(/\/reset-password\?token=/);

  // The member opens the link in their own browser.
  const other = await browser.newContext();
  const pat = await other.newPage();
  await pat.goto(new URL(url).pathname + new URL(url).search);
  await pat.getByLabel('New password (at least 10 characters)').fill('pat-new-password-1');
  await pat.getByLabel('Repeat new password').fill('pat-new-password-1');
  await pat.getByRole('button', { name: 'Set password' }).click();
  await expect(pat.getByText('Your password was changed')).toBeVisible();
  await pat.getByRole('link', { name: 'Sign in' }).click();
  await pat.getByLabel('Email').fill(memberEmail);
  await pat.getByLabel('Password').fill('pat-new-password-1');
  await pat.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(pat.getByTestId('my-account')).toBeVisible();

  // Pat changes the password again on My account and stays signed in.
  await pat.getByTestId('my-account').click();
  const form = pat.getByTestId('change-password');
  await form.getByLabel('Current password').fill('pat-new-password-1');
  await form.getByLabel('New password (at least 10 characters)').fill('pat-third-password');
  await form.getByLabel('Repeat new password').fill('pat-third-password');
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByText('Password changed.')).toBeVisible();
  expect((await pat.request.get('/api/auth/me')).status()).toBe(200);
  await other.close();
});
