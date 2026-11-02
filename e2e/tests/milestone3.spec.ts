/**
 * Milestone 3 acceptance test, through the real UI: pick a theme, add a French translation by hand,
 * offer it to respondents, block phones, publish; then respondents see the theme and French text,
 * can switch language, and phones are screened out.
 */
import { devices, expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const demo = readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8');
const run = `m3${Date.now().toString(36)}`;

async function testLink(page: Page): Promise<string> {
  const surveyId = page.url().match(/\/surveys\/([^/?#]+)/)![1];
  const res = await page.request.post(`/api/surveys/${surveyId}/links`, { data: { test: true }, headers: { 'x-zapx-csrf': '1' } });
  expect(res.ok()).toBe(true);
  return (await res.json()).url;
}

test('theme, translation and device rules reach respondents', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M3 ${run}`);
  await page.getByLabel('Your name').fill('E2E Programmer');
  await page.getByLabel('Email').fill(`e2e-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByLabel('Name').fill('Global tracker');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Global tracker' }).click();
  await page.getByPlaceholder('New survey name').fill('Global survey');
  await page.getByRole('button', { name: 'Create survey' }).click();
  await page.getByRole('tab', { name: 'JSON' }).click();
  await page.getByLabel('Survey definition JSON').fill(demo);
  await page.getByRole('button', { name: 'Apply JSON' }).click();

  // --- Design: Warm preset, no phones ---
  await page.getByRole('tab', { name: 'Design' }).click();
  await page.getByRole('button', { name: 'Warm' }).click();
  await expect(page.getByLabel('Accent hex')).toHaveValue('#c2410c');
  const previewButton = page.getByTestId('preview-frame').locator('.zx-button');
  await expect(previewButton).toHaveCSS('background-color', 'rgb(194, 65, 12)');
  await page.getByTestId('device-settings').getByLabel('Phone').uncheck();
  await page.getByRole('button', { name: 'Phone (375px)' }).click();
  await expect(page.getByTestId('preview-frame')).toContainText('screened out');

  // --- Languages: add French, translate every text by hand, offer it ---
  await page.getByRole('tab', { name: 'Languages' }).click();
  await page.getByLabel('Source language (en)').fill('English');
  await page.getByLabel('Language tag').fill('fr');
  await page.getByLabel('Language name').fill('Français');
  await page.getByRole('button', { name: 'Add language' }).click();
  await page.getByLabel('Offer to respondents').check();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();

  const grid = page.getByTestId('translation-grid');
  const rows = grid.locator('tbody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThan(30);
  // Fill from the last row up: filled rows leave the "Needs attention" list.
  for (let i = count - 1; i >= 0; i--) {
    const row = rows.nth(i);
    const source = (await row.locator('td').first().locator('div').first().innerText()).trim();
    await row.locator('textarea').fill(`FR ${source}`);
  }
  await expect(grid).toContainText('Every text is translated and reviewed.');
  await expect(page.getByTestId('language-summary')).toContainText(`${count} of ${count} translated · ${count} reviewed`);

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft v1/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();

  // --- Respondent on a desktop, French browser ---
  const desk = await browser.newContext({ locale: 'fr-FR' });
  const r1 = await desk.newPage();
  await r1.goto(await testLink(page));
  await expect(r1.getByText('FR How old are you?')).toBeVisible();
  await expect(r1.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(r1.getByRole('button', { name: 'FR Next' })).toHaveCSS('background-color', 'rgb(194, 65, 12)');
  await r1.getByRole('button', { name: 'FR Next' }).click();
  await expect(r1.getByText('FR This question requires an answer.').first()).toBeVisible();
  await r1.getByLabel('FR Language').selectOption('en');
  await expect(r1.getByRole('spinbutton', { name: 'How old are you?', exact: true })).toBeVisible();
  await desk.close();

  // --- Respondent on a phone ---
  const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
  const r2 = await phone.newPage();
  await r2.goto(await testLink(page));
  await expect(r2.getByText('This survey cannot be taken on this device. Please open the link on a computer.')).toBeVisible();
  await phone.close();
});
