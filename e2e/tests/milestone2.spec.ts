/**
 * Milestone 2 acceptance test, through the real UI: import a questionnaire from the CSV template,
 * review the proposal (diff, confidence), apply it, then run the QA Laboratory on the draft.
 * The server in this test has no AI key, so the AI panel must say so instead of pretending to work.
 */
import { expect, test } from '@playwright/test';

const run = `m2${Date.now().toString(36)}`;

const CSV = [
  'Page,ID,Type,Question,Options,Rows,Condition,Required,Help,Min,Max,Target,Notes',
  'P1,AGE,numeric,How old are you?,,,,,,0,120,,',
  'P1,GENDER,single,Are you...,"1=Male\n2=Female",,,,,,,,',
  ',T_U18,terminate,Under 18,,,AGE < 18,,,,,,',
  'P2,,multi,Which brands do you know?,"Brand A;Brand B;None [exclusive]",,,,,,,,randomize',
  ',QT_W,quota,Women,,,GENDER == 2,,,,,100,',
].join('\n');

test('import a questionnaire, review and apply it, then run QA', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M2 ${run}`);
  await page.getByLabel('Your name').fill('E2E Programmer');
  await page.getByLabel('Email').fill(`e2e-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByLabel('Name').fill('Tracker');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Tracker' }).click();
  await page.getByPlaceholder('New survey name').fill('Imported survey');
  await page.getByRole('button', { name: 'Create survey' }).click();
  await expect(page.getByRole('heading', { name: 'Imported survey' })).toBeVisible();

  // --- AI & import ---
  await page.getByRole('tab', { name: 'AI & import' }).click();
  await expect(page.getByTestId('ai-not-configured')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draft proposal' })).toBeDisabled();
  await page.getByLabel('Questionnaire file').setInputFiles({ name: 'questionnaire.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await page.getByRole('button', { name: 'Import file' }).click();

  const review = page.getByTestId('changeset-review');
  await expect(review.getByRole('heading', { name: 'Import questionnaire.csv' })).toBeVisible();
  await expect(review.getByText(/Import confidence: \d+%/)).toBeVisible();
  await expect(review.getByText('Some options had no code; codes were numbered automatically')).toBeVisible();
  await expect(page.getByTestId('diff').getByText(/AGE added \(numeric\)/)).toBeVisible();
  await expect(page.getByTestId('diff').getByText(/Q1: .*type.* changed/)).toBeVisible();
  await expect(review.getByText(/Logic check: 0 error\(s\)/)).toBeVisible();

  await review.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(review.getByText('applied', { exact: true })).toBeVisible();

  // The editor now shows the imported questions.
  await page.getByRole('tab', { name: 'Build' }).click();
  await expect(page.getByRole('button', { name: /GENDER/ }).first()).toBeVisible();

  // --- QA lab ---
  await page.getByRole('tab', { name: 'QA lab' }).click();
  await page.getByLabel('Respondents').fill('200');
  await page.getByLabel('Seed (optional)').fill('e2e');
  await page.getByRole('button', { name: 'Run QA' }).click();
  await expect(page.getByTestId('qa-verdict')).toHaveText('passed');
  await expect(page.getByTestId('qa-coverage')).toHaveText('100% coverage');
  await expect(page.getByText('No defects found.')).toBeVisible();
  await expect(page.getByRole('button', { name: /passed v\d+ · 200 resp/ })).toBeVisible();
});
