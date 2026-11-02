/**
 * Milestone 1 acceptance test, through the real UI:
 * a programmer signs up, creates a project, adds the Sampledge vendor, programs the demo survey,
 * passes the logic check and publishes; respondents complete it through vendor links and are
 * redirected to the Sampledge platform URLs (complete, overquota); the export holds their data.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const demo = readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8');
const run = Date.now().toString(36);

async function takeSurvey(page: Page, link: string, answers: { age: string; gender: string; aware?: string[]; stopAfterFirst?: boolean }) {
  await page.goto(link);
  await expect(page.getByText('How old are you?')).toBeVisible();
  // the entry URL with the UID is replaced by a private session URL
  await expect(page).toHaveURL(/\/r\/[A-Za-z0-9_-]+$/);
  await page.getByRole('spinbutton', { name: 'How old are you?' }).fill(answers.age);
  await page.getByLabel(answers.gender, { exact: true }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  if (answers.stopAfterFirst) return;
  await expect(page.getByText('Which of these brands have you heard of?')).toBeVisible();
  for (const brand of answers.aware ?? []) await page.getByLabel(brand, { exact: true }).check();
  await page.getByRole('button', { name: 'Next' }).click();
}

test('program, publish, respond, redirect, export', async ({ page, context }) => {
  // Respondents are redirected to the Sampledge platform; capture those requests instead of leaving the test network.
  const redirects: string[] = [];
  await context.route('https://platform.sampledge.com/**', (route) => {
    redirects.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'sampledge platform stub' });
  });

  // --- Sign up and create a project ---
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E Research ${run}`);
  await page.getByLabel('Your name').fill('E2E Programmer');
  await page.getByLabel('Email').fill(`e2e-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.getByLabel('Name').fill('Cardiology tracker');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Cardiology tracker' }).click();

  // --- Vendor from the Sampledge preset ---
  await page.getByRole('button', { name: '+ Sampledge preset' }).click();
  await expect(page.getByLabel('Quota full URL')).toHaveValue('https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]');
  await expect(page.getByLabel('Quota full status word')).toHaveValue('overquota');
  await page.getByRole('button', { name: 'Save vendor' }).click();
  await expect(page.getByText('vid=SE')).toBeVisible();

  // --- Survey: paste the definition, check, publish ---
  await page.getByPlaceholder('New survey name').fill('Demo screener');
  await page.getByRole('button', { name: 'Create survey' }).click();
  await expect(page.getByRole('heading', { name: 'Demo screener' })).toBeVisible();

  await page.getByRole('tab', { name: 'JSON' }).click();
  const broken = JSON.parse(demo);
  broken.pages[2].condition = 'UNKNOWN_Q == 1';
  await page.getByLabel('Survey definition JSON').fill(JSON.stringify(broken));
  await page.getByRole('button', { name: 'Apply JSON' }).click();
  await expect(page.getByTestId('logic-report')).toContainText('"UNKNOWN_Q" is not a question in this survey');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();

  await page.getByLabel('Survey definition JSON').fill(demo);
  await page.getByRole('button', { name: 'Apply JSON' }).click();
  await expect(page.getByTestId('logic-report')).toContainText('Ready to publish');

  // Visual editor shows the same definition
  await page.getByRole('tab', { name: 'Build' }).click();
  await expect(page.getByRole('button', { name: /AWARE_OTHER/ })).toBeVisible();

  // Preview the unsaved draft in the browser: an under-18 is terminated
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.getByRole('spinbutton', { name: 'How old are you?' }).fill('15');
  await page.getByLabel('Woman', { exact: true }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('preview-outcome')).toContainText('terminate (rule T_UNDERAGE)');

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
  await expect(page.locator('.badge.live')).toBeVisible();

  // --- Links ---
  await page.getByRole('tab', { name: 'Links & status' }).click();
  const linkFor = async (uid: string) => {
    await page.getByLabel('UID (for a single link)').fill(uid);
    await page.getByRole('button', { name: 'Generate link' }).click();
    const input = page.getByLabel('Respondent link');
    await expect(input).toHaveValue(new RegExp(`uid=${uid}`));
    return input.inputValue();
  };
  const link1 = await linkFor('E2E-1');
  await expect(page.getByLabel('Vendor link template')).toHaveValue(/vid=SE&uid=\[UID\]$/);
  const link2 = await linkFor('E2E-2');

  // --- Respondent 1 completes ---
  const r1 = await context.newPage();
  await takeSurvey(r1, link1, { age: '42', gender: 'Man', aware: ['Brand A', 'Other'] });
  // validation: "Other" requires the specify box, which appeared on the same page
  await expect(r1.getByText('This question requires an answer.')).toBeVisible();
  await r1.getByRole('textbox', { name: 'Which other brand?' }).fill('Brand Z');
  await r1.getByRole('button', { name: 'Next' }).click();
  await expect(r1.getByText('You know Brand A, Other. How would you rate each brand?')).toBeVisible();
  await r1.getByLabel('Brand A: Excellent').check();
  await r1.getByRole('button', { name: 'Next' }).click();
  await r1.getByRole('textbox').fill('Great survey');
  await r1.getByRole('button', { name: 'Next' }).click();
  await expect.poll(() => redirects.length).toBe(1);
  expect(redirects[0]).toBe('https://platform.sampledge.com/response/status?status=complete&uid=E2E-1');

  // --- Respondent 2: men's quota (target 1) is full ---
  const r2 = await context.newPage();
  await takeSurvey(r2, link2, { age: '35', gender: 'Man', stopAfterFirst: true });
  await expect.poll(() => redirects.length).toBe(2);
  expect(redirects[1]).toBe('https://platform.sampledge.com/response/status?status=overquota&uid=E2E-2');

  // --- Quotas and export ---
  await page.getByRole('tab', { name: 'Quotas & data' }).click();
  await expect(page.getByRole('cell', { name: 'E2E-1' })).toBeVisible();
  const csv = await (await page.request.get(page.url().replace(/\/surveys\/([^/?#]+).*/, '/api/surveys/$1/export?format=csv'))).text();
  const [header, ...rows] = csv.replace(/^﻿/, '').trim().split('\r\n');
  const cols = header!.split(',');
  expect(rows).toHaveLength(2);
  const row1 = rows.map((r) => r.split(',')).find((r) => r[cols.indexOf('uid')] === 'E2E-1')!;
  expect(row1[cols.indexOf('status')]).toBe('complete');
  expect(row1[cols.indexOf('AGE')]).toBe('42');
  expect(row1[cols.indexOf('AWARE_98')]).toBe('1');
  expect(row1[cols.indexOf('AWARE_OTHER')]).toBe('Brand Z');
  expect(row1[cols.indexOf('RATE_a')]).toBe('4');
  const row2 = rows.map((r) => r.split(',')).find((r) => r[cols.indexOf('uid')] === 'E2E-2')!;
  expect(row2[cols.indexOf('status')]).toBe('quota_full');
  expect(row2[cols.indexOf('outcome_reason')]).toBe('QT_MEN');
});
