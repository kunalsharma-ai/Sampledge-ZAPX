/**
 * Milestone 7 acceptance test, through the real UI: a QA run above the in-request limit runs as a
 * background job with progress and lands in the run history; a background CSV export finishes and
 * its file downloads. The API runs the job worker in-process here (JOB_WORKER defaults to on).
 */
import { expect, test } from '@playwright/test';

const run = `m7${Date.now().toString(36)}`;

test('large QA runs and exports run as background jobs', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M7 ${run}`);
  await page.getByLabel('Your name').fill('E2E Programmer');
  await page.getByLabel('Email').fill(`e2e-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByLabel('Name').fill('Jobs study');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Jobs study' }).click();
  await page.getByPlaceholder('New survey name').fill('Background survey');
  await page.getByRole('button', { name: 'Create survey' }).click();
  await expect(page.getByRole('heading', { name: 'Background survey' })).toBeVisible();

  // --- QA lab: 3,000 respondents goes to the worker ---
  await page.getByRole('tab', { name: 'QA lab' }).click();
  await page.getByLabel('Respondents').fill('3000');
  await page.getByLabel('Seed (optional)').fill('e2e');
  await expect(page.getByText(/go to the background worker/)).toBeVisible();
  await page.getByRole('button', { name: 'Run QA' }).click();
  await expect(page.getByTestId('qa-verdict')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /v\d+ · 3000 resp/ })).toBeVisible();

  // --- Background export ---
  await page.getByRole('tab', { name: 'Quotas & data' }).click();
  const exportsPanel = page.getByTestId('export-jobs');
  await exportsPanel.getByRole('button', { name: 'Background CSV' }).click();
  const job = exportsPanel.getByTestId('export-job').first();
  await expect(job).toContainText('ready', { timeout: 30_000 });
  await expect(job).toContainText('0 rows');
  const [download] = await Promise.all([page.waitForEvent('download'), job.getByRole('link', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  expect((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')).toMatch(/^response_id,uid,/);
});
