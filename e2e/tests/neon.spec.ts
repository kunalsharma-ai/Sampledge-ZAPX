/**
 * Neon AI dashboard: the home screen shows the organization's real numbers, "Create survey" makes a
 * project and survey and opens the AI & import tab, and the top-bar search finds it.
 */
import { expect, test } from '@playwright/test';

const run = `n${Date.now().toString(36)}`;

test('dashboard: real numbers, create a survey from the hero, find it with search', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E Neon ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin@${run}.e2e.test`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // Neon AI is the default theme.
  await expect(page.locator('html')).toHaveAttribute('data-q-theme', 'neon-ai');
  await expect(page.getByTestId('kpi-projects')).toContainText('0');
  await expect(page.getByTestId('kpi-responses')).toContainText('0');

  await page.getByTestId('hero-create-survey').click();
  const dialog = page.getByRole('dialog', { name: 'Create a survey' });
  await dialog.getByLabel('New project title').fill('Neon tracker');
  await dialog.getByLabel('Survey title').fill('Neon wave 1');
  await dialog.getByRole('radio', { name: /Describe it to AI/ }).click();
  await dialog.getByLabel('What should the survey cover?').fill('A short brand survey');
  await dialog.getByRole('button', { name: 'Create survey' }).click();

  await expect(page.getByRole('heading', { name: 'Neon wave 1' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'AI & import' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('ai-panel').getByLabel('Instruction')).toHaveValue('A short brand survey');

  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await expect(page.getByTestId('kpi-projects')).toContainText('1');
  await page.getByRole('combobox', { name: 'Search projects and surveys' }).fill('wave');
  await page.getByRole('option', { name: /Neon wave 1/ }).click();
  await expect(page.getByRole('heading', { name: 'Neon wave 1' })).toBeVisible();
});
