/**
 * Milestone 10 acceptance test, through the real UI: interviews arrive (synced from the CAPI app's
 * endpoint), then a programmer runs frequencies, builds a crosstab with significance letters,
 * saves it as a report, reruns it from the list and downloads it as Excel.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const run = `m10${Date.now().toString(36)}`;
const demo = JSON.parse(readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8'));
// The demo's quotas would close the men's cell after one interview; this study has none.
const definition = { ...demo, quotas: [] };

test('frequencies, a significance-tested crosstab, and a saved report', async ({ page, playwright }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M10 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const headers = { 'x-zapx-csrf': '1' };
  const call = async (path: string, data: unknown, method: 'post' | 'put' = 'post') => {
    const res = await page.request[method](`/api${path}`, { data, headers });
    expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
    return res.json();
  };
  const project = await call('/projects', { name: 'Brand tracker' });
  const survey = await call(`/projects/${project.id}/surveys`, { name: 'Brand awareness wave 1' });
  await call(`/surveys/${survey.id}/draft`, { definition }, 'put');
  await call(`/surveys/${survey.id}/publish`, {});
  const live = await (await page.request.get(`/api/surveys/${survey.id}`)).json();
  const ivy = await call('/users', {
    name: 'Ivy Field',
    email: `ivy-${run}@test.zapx`,
    password: 'member-password-1',
    role: 'INTERVIEWER',
  });
  await call(`/surveys/${survey.id}/capi/assignments`, { interviewerId: ivy.id });
  // The interviewer signs in from their own context, so the admin's session cookie is kept.
  const device = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const login = await device.post('/api/auth/login', { data: { email: `ivy-${run}@test.zapx`, password: 'member-password-1' } });
  const { token } = await login.json();

  // 40 men, 80% aware of brand 1; 40 women, 30% aware of brand 1 and all aware of brand 2.
  const interviews = Array.from({ length: 80 }, (_, i) => {
    const man = i < 40;
    const k = i % 40;
    return {
      clientId: randomUUID(),
      surveyId: survey.id,
      versionId: live.liveVersionId,
      answers: {
        AGE: (man ? 22 : 42) + (k % 8),
        GENDER: man ? 1 : 2,
        AWARE: man ? (k % 5 ? [1] : [3]) : k % 10 < 3 ? [1, 2] : [2],
        RATE: { a: man ? 4 : 2, b: 3, c: 3 },
      },
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 240_000,
    };
  });
  for (const batch of [interviews.slice(0, 40), interviews.slice(40)]) {
    const res = await device.post('/api/capi/sync', {
      data: { deviceId: randomUUID(), interviews: batch },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
  await device.dispose();

  // --- Frequencies ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const results = page.getByTestId('analysis-results');
  await expect(results).toContainText('80 interviews');
  await expect(page.getByTestId('freq-GENDER')).toContainText('50.0%');
  await expect(page.getByTestId('freq-AGE')).toContainText('Mean');
  await expect(page.getByTestId('freq-AWARE')).toContainText('more than one answer allowed');

  // --- Crosstab: awareness by gender, tested at 95% ---
  await page.getByRole('radio', { name: 'Crosstab' }).click();
  await page.getByLabel('Banner (columns)').selectOption('GENDER');
  await page.getByRole('checkbox', { name: /^AWARE\b/ }).check();
  await page.getByRole('checkbox', { name: /^AGE\b/ }).check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const aware = page.getByTestId('xtab-AWARE');
  await expect(aware.getByRole('columnheader', { name: 'Man (A)' })).toBeVisible();
  // Brand A: men 80% is significantly higher than women (B); Brand B the other way round.
  await expect(aware.getByRole('row').filter({ hasText: 'Brand A' })).toContainText('80.0% B');
  await expect(aware.getByRole('row').filter({ hasText: 'Brand B' })).toContainText('100.0% A');
  await expect(page.getByTestId('xtab-AGE').getByRole('row', { name: /Mean/ })).toContainText('A');
  await expect(results).toContainText('at 95% confidence');

  // --- Save, rerun from the list, download ---
  await page.getByLabel('Report name').fill('Awareness by gender');
  await page.getByRole('button', { name: 'Save report' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved “Awareness by gender”.');
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  const saved = page.getByTestId('saved-reports');
  await saved.getByRole('button', { name: 'Awareness by gender', exact: true }).click();
  await expect(page.getByTestId('xtab-AWARE').getByRole('row').filter({ hasText: 'Brand A' })).toContainText('80.0% B');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    saved.getByRole('link', { name: 'Download Awareness by gender as Excel' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Awareness_by_gender.xlsx');
});
