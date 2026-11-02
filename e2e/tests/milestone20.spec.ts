/**
 * Milestone 20 acceptance test, through the real UI: the studio sends its security headers, a weak
 * password is refused at sign-up, and "Sign out everywhere" ends the session in another browser too.
 */
import { expect, test } from '@playwright/test';

const run = `m20${Date.now().toString(36)}`;
const email = `admin@${run}.e2e.test`;
const password = 'e2e-password-123';

test('security headers, weak passwords and sign out everywhere', async ({ page, browser }) => {
  page.on('dialog', (d) => void d.accept());
  const res = await page.goto('/login');
  const headers = res!.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');

  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M20 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/too common/)).toBeVisible();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // A second browser signed in as the same person.
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto('/login');
  await second.getByLabel('Email').fill(email);
  await second.getByLabel('Password').fill(password);
  await second.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.getByTestId('sign-out-everywhere').click();
  await expect(page).toHaveURL(/\/login/);
  expect((await second.request.get('/api/auth/me')).status()).toBe(401);
  await other.close();
});
