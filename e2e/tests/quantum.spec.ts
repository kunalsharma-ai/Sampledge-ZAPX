/**
 * Quantum Design System acceptance test, through the real UI: a theme, mode, density and high
 * contrast apply at once without a reload, are saved to the account (another browser gets them), and
 * an admin's organization default applies to a member who has not chosen their own.
 */
import { expect, test } from '@playwright/test';

const run = `q${Date.now().toString(36)}`;
const password = 'e2e-password-123';

test('appearance settings apply live, follow the member and fall back to the organization default', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E Quantum ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin@${run}.e2e.test`);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.getByTestId('appearance-link').click();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  const html = page.locator('html');

  // Live, no reload: the page keeps its identity while the theme changes.
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
  await page
    .getByTestId('theme-presets')
    .getByRole('radio', { name: /Cyber Pulse/ })
    .click();
  await page.getByRole('radiogroup', { name: 'Colour mode' }).getByRole('radio', { name: 'Light' }).click();
  await page.getByRole('radiogroup', { name: 'Density' }).getByRole('radio', { name: 'Compact' }).click();
  await expect(html).toHaveAttribute('data-q-theme', 'cyber-pulse');
  await expect(html).toHaveAttribute('data-q-scheme', 'light');
  await expect(html).toHaveAttribute('data-q-density', 'compact');
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);

  // Keyboard: arrow keys move through the colour mode choices.
  await page.getByRole('radiogroup', { name: 'Colour mode' }).getByRole('radio', { name: 'Light' }).press('ArrowRight');
  await expect(html).toHaveAttribute('data-q-scheme', 'dark');

  await page.getByTestId('high-contrast').click();
  await expect(html).toHaveAttribute('data-q-contrast', 'high');
  await expect(page.getByText(/12 of 12 pairs pass/)).toBeVisible();
  await expect(page.getByTestId('appearance-source')).toContainText('saved to your account');

  // Saved to the account: a fresh browser (no local cache) signs in and gets the same appearance.
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto('/login');
  await second.getByLabel('Email').fill(`admin@${run}.e2e.test`);
  await second.getByLabel('Password').fill(password);
  await second.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(second.locator('html')).toHaveAttribute('data-q-theme', 'cyber-pulse');
  await expect(second.locator('html')).toHaveAttribute('data-q-contrast', 'high');
  await other.close();

  // Organization default: set it, add a member, and the member starts with it.
  await page
    .getByTestId('theme-presets')
    .getByRole('radio', { name: /Royal Amethyst/ })
    .click();
  await page.getByTestId('set-org-default').click();
  await expect(page.getByText(/Royal Amethyst is now the default/)).toBeVisible();

  await page.goto('/settings');
  const team = page.getByTestId('team');
  await team.getByLabel('Member name').fill('Pat Programmer');
  await team.getByLabel('Member email').fill(`pat@${run}.e2e.test`);
  await team.getByLabel('Initial password').fill('programmer-pass-1');
  await team.getByLabel('Role').selectOption('PROGRAMMER');
  await team.getByRole('button', { name: 'Add member' }).click();
  await expect(team.getByRole('row', { name: /Pat Programmer/ })).toBeVisible();

  const member = await browser.newContext();
  const m = await member.newPage();
  await m.goto('/login');
  await m.getByLabel('Email').fill(`pat@${run}.e2e.test`);
  await m.getByLabel('Password').fill('programmer-pass-1');
  await m.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(m.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(m.locator('html')).toHaveAttribute('data-q-theme', 'royal-amethyst');
  await m.getByTestId('appearance-link').click();
  await expect(m.getByTestId('appearance-source')).toContainText('organization’s default');
  await member.close();
});
