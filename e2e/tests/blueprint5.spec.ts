/**
 * Blueprint phase 5 through the UI: a cleaning rule and a segment in Analysis, a chart dashboard,
 * an automation rule made in the studio and one that notifies (the bell), data residency and
 * retention settings, the SMS channel for invitations (SMS is off in tests, which the page says),
 * and a theme for one studio area saved as a workspace preset.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const run = `p5${Date.now().toString(36)}`;
const shot = async (p: import('@playwright/test').Page, name: string, el?: import('@playwright/test').Locator) => {
  if (!process.env.SHOTS) return;
  await (el ?? p).screenshot({ path: `${process.env.SHOTS}/${name}.png`, ...(el ? {} : { fullPage: true }) });
};

const definition = {
  schemaVersion: 1,
  title: 'Brand tracker',
  pages: [
    {
      id: 'P1',
      questions: [
        { id: 'AGE', type: 'numeric', text: 'How old are you?', min: 0, max: 150, integer: true },
        {
          id: 'GENDER',
          type: 'single',
          text: 'Gender',
          options: [
            { code: 1, label: 'Man' },
            { code: 2, label: 'Woman' },
          ],
        },
        {
          id: 'AWARE',
          type: 'multi',
          text: 'Which brands do you know?',
          options: [1, 2, 3].map((code) => ({ code, label: `Brand ${code}` })),
        },
        { id: 'SAT', type: 'scale', text: 'How satisfied are you?', min: 1, max: 5 },
      ],
    },
  ],
  quotas: [{ id: 'QT_WOMEN', label: 'Women', condition: 'GENDER == 2', target: 100 }],
  cleaning: [{ id: 'C_AGE', label: 'Impossible age', when: 'AGE > 99', target: 'AGE', action: 'clear' }],
};

test('cleaning, segments, dashboards, automation, governance, SMS channel and area themes', async ({ page, playwright }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E P5 ${run}`);
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
  const project = await call('/projects', { name: 'Trackers' });
  const survey = await call(`/projects/${project.id}/surveys`, { name: 'Brand tracker' });
  await call(`/surveys/${survey.id}/draft`, { definition }, 'put');
  await call(`/surveys/${survey.id}/publish`, {});
  const live = await (await page.request.get(`/api/surveys/${survey.id}`)).json();

  // --- 24 synced interviews; one says 140 years old ---
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
  const interviews = Array.from({ length: 24 }, (_, i) => ({
    clientId: randomUUID(),
    surveyId: survey.id,
    versionId: live.liveVersionId,
    answers: { AGE: i === 0 ? 140 : 20 + i * 2, GENDER: 1 + (i % 2), AWARE: i % 3 === 0 ? [1, 2] : [3], SAT: 1 + (i % 5) },
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 240_000,
  }));
  const synced = await device.post('/api/capi/sync', {
    data: { deviceId: randomUUID(), interviews },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(synced.ok(), await synced.text()).toBe(true);
  await device.dispose();

  // --- Analysis: cleaning mark, a segment, a dashboard ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('cleaned-AGE')).toContainText('Cleaned by C_AGE');
  await expect(page.getByTestId('cleaning-note')).toContainText('C_AGE (1 changed)');
  const seg = page.getByTestId('segment-builder');
  await seg.getByLabel('Add a segment filter').selectOption('AWARE');
  await seg.getByRole('button', { name: 'Add' }).click();
  await seg.getByLabel('Brand 1').check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('segment-note')).toContainText('AWARE is Brand 1');
  await expect(page.getByTestId('analysis-results')).toContainText('8 interviews');
  await shot(page, 'p5-segment', page.getByTestId('analysis-results'));

  await page.getByRole('radio', { name: 'Dashboard' }).click();
  for (const v of ['GENDER', 'AWARE', 'SAT', 'AGE'])
    await page.locator('.var-picker label', { hasText: v }).first().getByRole('checkbox').check();
  await page.getByLabel('Chart for SAT').selectOption('column');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const tiles = page.getByTestId('dashboard-tiles');
  await expect(tiles.getByTestId('tile-GENDER')).toContainText('Man');
  await expect(tiles.getByTestId('tile-AGE')).toContainText('mean');
  await shot(page, 'p5-dashboard', page.getByTestId('analysis-results'));
  await page.getByLabel('Report name').fill('Tracker dashboard');
  await page.getByRole('button', { name: 'Save report' }).click();
  await expect(page.getByTestId('saved-reports')).toContainText('Dashboard');

  // --- Cleaning rules in the editor ---
  await page.getByRole('tab', { name: 'Build' }).click();
  await expect(page.getByTestId('cleaning-0').getByLabel('Cleaning condition')).toHaveValue('AGE > 99');

  // --- Automation: a rule made in the studio, and one that notifies on publish ---
  await page.goto('/automation');
  await page.getByTestId('new-rule').click();
  const editor = page.getByTestId('rule-editor');
  await editor.getByLabel('Name').fill('Pause when women are full');
  await editor.getByLabel('Survey').selectOption(survey.id);
  await editor.getByLabel('Trigger').selectOption('quota.full');
  await editor.getByRole('button', { name: 'Add condition' }).click();
  await editor.getByLabel('Condition 1 field').selectOption('event.quotaId');
  await editor.getByLabel('Condition 1 value').fill('QT_WOMEN');
  await editor.getByLabel('Action 1', { exact: true }).selectOption('set_survey_status');
  await editor.getByText('An administrator approves before it acts').click();
  await shot(page, 'p5-rule-editor', editor);
  await page.getByTestId('save-rule').click();
  await expect(page.getByTestId('rule-Pause when women are full')).toContainText(
    'When quota.full, if event.quotaId is QT_WOMEN: set the survey to paused (after an administrator approves).',
  );
  await call('/automation/rules', {
    name: 'New version published',
    surveyId: survey.id,
    trigger: 'survey.published',
    actions: [{ type: 'notify', to: 'admins', message: 'A new version of the brand tracker is live.' }],
  });
  await call(`/surveys/${survey.id}/draft`, { definition: { ...definition, title: 'Brand tracker, wave 2' } }, 'put');
  await call(`/surveys/${survey.id}/publish`, {});
  // The background worker runs the rule within a few seconds.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('notifications-unread')).toHaveText('1', { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId('notifications').click();
  await expect(page.getByRole('dialog', { name: 'Notifications' })).toContainText('A new version of the brand tracker is live.');
  await shot(page, 'p5-notifications');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('runs')).toContainText('Version 2 was published.');
  await shot(page, 'p5-automation');

  // --- Data residency and retention ---
  await page.goto('/settings');
  const gov = page.getByTestId('data-governance');
  await gov.getByLabel('Data region').fill('eu');
  await gov.getByRole('button', { name: 'Save region' }).click();
  await gov.getByLabel('Erase interviews after (days)').fill('365');
  await gov.getByTestId('save-retention').click();
  await expect(gov).toContainText('Saved. The policy is applied once an hour.');
  await gov.getByTestId('block-external').check();
  await expect(gov.getByRole('row', { name: /Transcription/ })).toContainText('Turned off');
  await shot(page, 'p5-governance', gov);
  const g = await (await page.request.get('/api/organization/governance')).json();
  expect(g).toMatchObject({ dataRegion: 'eu', blockExternalProcessors: true, retention: { responsesDays: 365 } });

  // --- SMS channel for invitations (SMS is off on the test server) ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Distribution' }).click();
  const inv = page.getByTestId('email-invitations');
  await expect(inv.getByTestId('sms-off')).toBeVisible();
  await inv.getByTestId('wave-channel').selectOption('SMS');
  await expect(inv.getByLabel('Subject')).toHaveCount(0);
  await expect(inv).toContainText('of 600 characters');
  await shot(page, 'p5-sms-wave', inv);

  // --- A theme for the Analysis area, saved as a workspace preset ---
  await page.goto('/appearance');
  await page.getByLabel('Theme for Analysis').selectOption('arctic-glass');
  await page.getByLabel('Preset name').fill('Research team');
  await page.getByTestId('save-preset').click();
  await expect(page.getByTestId('workspace-presets')).toContainText('Research team');
  // The area theme is saved to the account (shortly after the change).
  await expect
    .poll(async () => (await (await page.request.get('/api/me/preferences')).json()).appearance?.modules?.analysis, { timeout: 10_000 })
    .toBe('arctic-glass');
  await shot(page, 'p5-area-themes', page.getByTestId('area-themes').locator('..'));
  await page.goto(`/surveys/${survey.id}`);
  await expect(page.locator('html')).not.toHaveAttribute('data-q-theme', 'arctic-glass');
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-q-theme', 'arctic-glass');
  await shot(page, 'p5-analysis-area-theme');
});
