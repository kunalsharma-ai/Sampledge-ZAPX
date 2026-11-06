/**
 * Blueprint phase 2 through the UI: a right-to-left language with a glossary term, and a QA test
 * case saved from the Programmer debugger and run in the QA lab.
 */
import { expect, test } from '@playwright/test';
import { autoConfirm } from './confirm-helper';

const run = `p${Date.now().toString(36)}`;

test('right-to-left translation, glossary and saved test cases', async ({ page }) => {
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? 'Default route' : undefined));
  await autoConfirm(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E Phase2 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin@${run}.e2e.test`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.getByTestId('hero-create-survey').click();
  const dialog = page.getByRole('dialog', { name: 'Create a survey' });
  await dialog.getByLabel('New project title').fill('Phase 2');
  await dialog.getByLabel('Survey title').fill('NPS wave');
  await dialog.getByRole('radio', { name: /Use a template/ }).click();
  await dialog.getByRole('radio', { name: /Customer satisfaction/ }).click();
  await dialog.getByRole('button', { name: 'Create survey' }).click();
  await expect(page.getByRole('heading', { name: 'NPS wave' })).toBeVisible();

  // --- Arabic is written right to left; glossary terms are checked ---
  await page.getByRole('tab', { name: 'Languages' }).click();
  await page.getByLabel('Language tag').fill('ar');
  await page.getByLabel('Language name').fill('العربية');
  await page.getByRole('button', { name: 'Add language' }).click();
  await expect(page.getByTestId('language-summary')).toContainText('written right to left');
  await expect(page.getByTestId('translation-grid').locator('textarea').first()).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('glossary').locator('summary').click();
  await page.getByLabel('Glossary term').fill('SampCode');
  await page.getByLabel('Glossary translation').fill('زابكس');
  await page.getByRole('button', { name: 'Add term' }).click();
  await expect(page.getByTestId('glossary')).toContainText('1 terms');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();

  // --- Save a test case from the debugger and run it in the QA lab ---
  await page.getByRole('tab', { name: 'Programmer' }).click();
  await page.getByRole('tab', { name: 'Debugger' }).click();
  await page.getByRole('button', { name: 'Save as test case' }).click();
  await expect(page.getByText('Saved. Run it any time from the QA lab.')).toBeVisible();
  await page.getByRole('tab', { name: 'QA lab' }).click();
  await expect(page.getByTestId('test-cases')).toContainText('Default route');
  await page.getByRole('button', { name: 'Run test cases' }).click();
  await expect(page.getByTestId('test-case-summary')).toContainText('1 passed, 0 failed');
});
