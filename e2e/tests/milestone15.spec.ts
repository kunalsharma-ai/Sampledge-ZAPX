/**
 * Milestone 15 acceptance test, through the real UI: a sample with too many men is weighted to
 * 50/50 by gender. The programmer sets the targets, checks the weights (efficiency, achieved
 * shares), runs weighted frequencies, and saves the report with its weighting.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const run = `m15${Date.now().toString(36)}`;
const demo = JSON.parse(readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8'));
const definition = { ...demo, quotas: [] };

test('rim weighting by gender, checked and applied', async ({ page, playwright }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M15 ${run}`);
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
  const project = await call('/projects', { name: 'Tracker' });
  const survey = await call(`/projects/${project.id}/surveys`, { name: 'Weighted wave' });
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
  const device = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
  const { token } = await (
    await device.post('/api/auth/login', { data: { email: `ivy-${run}@test.zapx`, password: 'member-password-1' } })
  ).json();

  // 60 men aged 20, 20 women aged 40: 75% men, mean age 25 unweighted.
  const interviews = Array.from({ length: 80 }, (_, i) => ({
    clientId: randomUUID(),
    surveyId: survey.id,
    versionId: live.liveVersionId,
    answers: { AGE: i < 60 ? 20 : 40, GENDER: i < 60 ? 1 : 2, AWARE: [1], RATE: { a: 3, b: 3, c: 3 } },
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 240_000,
  }));
  const res = await device.post('/api/capi/sync', {
    data: { deviceId: randomUUID(), interviews },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await device.dispose();

  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Analysis' }).click();
  const weighting = page.getByTestId('weighting');
  await expect(weighting).toContainText('Results are unweighted');
  await weighting.getByLabel('Variable to weight by').selectOption('GENDER');
  await weighting.getByRole('button', { name: 'Add' }).click();
  await weighting.getByLabel('Target for Man').fill('50');
  await weighting.getByLabel('Target for Woman').fill('50');
  await weighting.getByLabel('Target for Another identity').fill('0');
  await weighting.getByLabel('Target for Prefer not to say').fill('0');
  await expect(weighting).toContainText('Targets add up to 100.0%.');

  await weighting.getByRole('button', { name: 'Check weights' }).click();
  const check = page.getByTestId('weight-check');
  await expect(check).toContainText('Targets met');
  await expect(check).toContainText('Efficiency 75%');
  await expect(check).toContainText('weights 0.67 to 2.00');
  await expect(page.getByTestId('weight-dim-GENDER').getByRole('row').filter({ hasText: 'Woman' })).toContainText('25.0%');

  await page.getByRole('checkbox', { name: /^GENDER\b/ }).check();
  await page.getByRole('checkbox', { name: /^AGE\b/ }).check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('weighted-note')).toContainText('weighted by GENDER (efficiency 75%');
  await expect(page.getByTestId('freq-GENDER').getByRole('row').filter({ hasText: 'Woman' })).toContainText('50.0%');
  await expect(page.getByTestId('freq-GENDER')).toContainText('Base: 80 answered');
  await expect(page.getByTestId('freq-AGE')).toContainText('30.00');

  await page.getByLabel('Report name').fill('Weighted by gender');
  await page.getByRole('button', { name: 'Save report' }).click();
  await expect(page.getByText('Saved “Weighted by gender”.')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.getByTestId('saved-reports').getByRole('button', { name: 'Weighted by gender', exact: true }).click();
  await expect(page.getByTestId('weighted-note')).toBeVisible();
  await expect(page.getByTestId('weight-dim-GENDER')).toBeVisible();
});
