/**
 * Blueprint phase 1 through the UI: start a survey from a template, save a question to the
 * question bank and insert it into another page, and open the Programmer workspace.
 */
import { expect, test } from '@playwright/test';

const run = `b${Date.now().toString(36)}`;

test('template, question bank and programmer workspace', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E Blueprint ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin@${run}.e2e.test`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // --- Start from the brand health template ---
  await page.getByTestId('hero-create-survey').click();
  const dialog = page.getByRole('dialog', { name: 'Create a survey' });
  await dialog.getByLabel('New project title').fill('Blueprint tracker');
  await dialog.getByLabel('Survey title').fill('Brand wave 1');
  await dialog.getByRole('radio', { name: /Use a template/ }).click();
  await dialog.getByRole('radio', { name: /Brand health tracker/ }).click();
  await dialog.getByRole('button', { name: 'Create survey' }).click();
  await expect(page.getByRole('heading', { name: 'Brand wave 1' })).toBeVisible();
  const surveyUrl = page.url();

  // --- Save AGE to the question bank ---
  await page.getByRole('button', { name: /^AGE\b/ }).click();
  await page.getByRole('button', { name: 'Save to question bank' }).click();
  await page.getByLabel('Title in the bank').fill('Age bands');
  await page.getByLabel('Category').fill('Demographics');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved. Anyone in your organization')).toBeVisible();

  // --- The question bank page lists it ---
  await page.getByRole('link', { name: 'Question bank' }).click();
  await expect(page.getByRole('heading', { name: 'Question bank' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Age bands' })).toBeVisible();
  await page.getByRole('tab', { name: 'Built-in templates' }).click();
  await expect(page.getByRole('heading', { name: 'Concept test (monadic rotation)' })).toBeVisible();

  // --- Insert it into the survey: the variable name is made unique ---
  await page.goto(surveyUrl);
  await page.getByRole('button', { name: '+ from question bank' }).last().click();
  await page.getByRole('button', { name: /Age bands/ }).click();
  await expect(page.getByRole('button', { name: /^AGE_2\b/ })).toBeVisible();

  // --- Programmer workspace: XML with the loop, and the debugger ---
  await page.getByRole('tab', { name: 'Programmer' }).click();
  await expect(page.getByTestId('programmer')).toBeVisible();
  await expect(page.getByTestId('code-editor')).toContainText('title="Brand wave 1"');
  await page.getByRole('tab', { name: 'Debugger' }).click();
  await page.getByRole('tab', { name: 'Dependencies' }).click();
  await expect(page.getByTestId('programmer').getByText('AWARE').first()).toBeVisible();
});
