/**
 * "i" help cards: every page header, section, survey tab and question type has a neon info button
 * that explains what the feature is for, how to use it and where to use it (apps/studio/lib/help.ts).
 */
import { expect, test } from '@playwright/test';

const run = `h${Date.now().toString(36)}`;

test('help cards explain pages, sections, tabs and question types', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E Help ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin@${run}.e2e.test`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // A dashboard section: click opens the card, Escape closes it and returns focus.
  const journeyHelp = page.getByRole('heading', { name: /Survey journey/ }).getByRole('button', { name: 'Help' });
  await journeyHelp.click();
  const card = page.getByRole('dialog', { name: 'Survey journey' });
  await expect(card).toContainText('What it is for');
  await expect(card).toContainText('How to use it');
  await expect(card).toContainText('Where and when to use it');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(journeyHelp).toBeFocused();

  // Survey workspace: the page header and the open tab have their own card.
  await page.getByTestId('hero-create-survey').click();
  const dialog = page.getByRole('dialog', { name: 'Create a survey' });
  await dialog.getByLabel('New project title').fill('Help tracker');
  await dialog.getByLabel('Survey title').fill('Help wave 1');
  await dialog.getByRole('button', { name: 'Create survey' }).click();
  await expect(page.getByRole('heading', { name: 'Help wave 1' })).toBeVisible();

  await page.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('dialog', { name: 'Survey workspace' })).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog', { name: 'Survey workspace' })).toBeHidden();

  await page.getByRole('tab', { name: 'Build' }).click();
  await page.getByRole('button', { name: 'What is this tab for?' }).click();
  await expect(page.getByRole('dialog', { name: 'Build' })).toContainText('visual questionnaire builder');
  await page.keyboard.press('Escape');

  // Question types: the card follows the type chosen for the next question.
  await page.getByLabel('New question type').selectOption('maxdiff');
  await page.locator('[data-help="qtype.maxdiff"]').click();
  await expect(page.getByRole('dialog', { name: 'MaxDiff (best-worst)' })).toContainText('best and the worst');
});
