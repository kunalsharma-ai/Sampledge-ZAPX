/**
 * Blueprint phase 4 through the UI: MaxDiff and conjoint screens in the preview, the device matrix,
 * choice results from synced interviews (design downloaded through the API), a recode with lineage
 * in analysis, the research assistant's tables (AI is not configured in tests, which the page says),
 * suggested QA test cases, least-fill quota groups and recodes in the editor, and a page saved to the
 * question bank as a block and inserted again.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const run = `p4${Date.now().toString(36)}`;
/** Set SHOTS to a folder to keep screenshots of the new screens (used for the pull request). */
const shot = async (p: import('@playwright/test').Page, name: string, el?: import('@playwright/test').Locator) => {
  if (!process.env.SHOTS) return;
  await (el ?? p).screenshot({ path: `${process.env.SHOTS}/${name}.png`, ...(el ? {} : { fullPage: true }) });
};

const items = ['Price', 'Taste', 'Brand', 'Pack', 'Health'];
const definition = {
  schemaVersion: 1,
  title: 'Snack study',
  pages: [
    {
      id: 'P1',
      questions: [
        { id: 'AGE', type: 'numeric', text: 'How old are you?', min: 18, max: 99, integer: true },
        {
          id: 'AWARE',
          type: 'multi',
          text: 'Which brands do you know?',
          options: [1, 2, 3].map((code) => ({ code, label: `Brand ${code}` })),
        },
      ],
    },
    {
      id: 'P2',
      questions: [
        {
          id: 'MD',
          type: 'maxdiff',
          text: 'Which matters most and least when you buy a snack?',
          options: items.map((label, i) => ({ code: i + 1, label })),
          itemsPerSet: 3,
          sets: 4,
          versions: 2,
        },
      ],
    },
    {
      id: 'P3',
      questions: [
        {
          id: 'CBC',
          type: 'conjoint',
          text: 'Which pack would you buy?',
          attributes: [
            {
              id: 'price',
              label: 'Price',
              levels: [
                { code: 1, label: '₹20' },
                { code: 2, label: '₹30' },
              ],
            },
            {
              id: 'size',
              label: 'Size',
              levels: [
                { code: 1, label: '50 g' },
                { code: 2, label: '100 g' },
              ],
            },
          ],
          tasks: 3,
          conceptsPerTask: 2,
          versions: 2,
        },
      ],
    },
  ],
  quotas: [1, 2, 3].map((b) => ({ id: `QB${b}`, label: `Brand ${b}`, condition: `selected(AWARE, ${b})`, target: 100, group: 'BRAND' })),
  recodes: [
    {
      id: 'AGEGRP',
      label: 'Age group',
      source: 'AGE',
      groups: [
        { code: 1, label: 'Under 35', max: 34 },
        { code: 2, label: '35 plus', min: 35 },
      ],
    },
  ],
};

const csvRows = (text: string) =>
  text
    .trim()
    .split(/\r\n/)
    .slice(1)
    .map((l) => l.split(',').map(Number));

test('choice modelling, derived variables, assistant tables, suggested cases and bank blocks', async ({ page, playwright }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E P4 ${run}`);
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
  const project = await call('/projects', { name: 'Snacks' });
  const survey = await call(`/projects/${project.id}/surveys`, { name: 'Snack study' });
  await call(`/surveys/${survey.id}/draft`, { definition }, 'put');
  await call(`/surveys/${survey.id}/publish`, {});
  const live = await (await page.request.get(`/api/surveys/${survey.id}`)).json();

  // --- 30 synced interviews, answered from the published design ---
  const md = csvRows(await (await page.request.get(`/api/surveys/${survey.id}/analysis/choice/MD/design.csv`)).text());
  const cbc = csvRows(await (await page.request.get(`/api/surveys/${survey.id}/analysis/choice/CBC/design.csv`)).text());
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
  const interviews = Array.from({ length: 30 }, (_, i) => {
    const v = i % 2;
    const mdAns: Record<string, number> = { v };
    for (let s = 1; s <= 4; s++) {
      const set = md.filter((r) => r[0] === v && r[1] === s).map((r) => r[3]!);
      const best = set.includes(1) ? 1 : set.find((c) => c !== 4)!;
      mdAns[`b${s}`] = best;
      mdAns[`w${s}`] = set.includes(4) && best !== 4 ? 4 : set.find((c) => c !== best)!;
    }
    const cbcAns: Record<string, number> = { v };
    for (let t = 1; t <= 3; t++) {
      const concepts = cbc.filter((r) => r[0] === v && r[1] === t);
      const cheap = concepts.find((r) => r[3] === 1);
      cbcAns[`t${t}`] = cheap ? cheap[2]! : 1;
    }
    return {
      clientId: randomUUID(),
      surveyId: survey.id,
      versionId: live.liveVersionId,
      answers: { AGE: i < 15 ? 25 : 50, AWARE: [1, 2, 3], MD: mdAns, CBC: cbcAns },
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 240_000,
    };
  });
  const synced = await device.post('/api/capi/sync', {
    data: { deviceId: randomUUID(), interviews },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(synced.ok(), await synced.text()).toBe(true);
  await device.dispose();
  // Least-fill group: 30 people aware of all three brands are spread 10 / 10 / 10.
  const quotas = (await (await page.request.get(`/api/surveys/${survey.id}/quotas`)).json()) as Array<{ id: string; count: number }>;
  expect(quotas.map((q) => q.count)).toEqual([10, 10, 10]);

  // --- Analysis: recode with lineage, choice results, assistant tables ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('freq-AGEGRP')).toContainText('Under 35');
  await expect(page.getByTestId('lineage-AGEGRP')).toContainText('Recode of AGE');

  const choice = page.getByTestId('choice-results');
  await choice.getByRole('button', { name: 'Estimate' }).click();
  const scores = page.getByTestId('maxdiff-scores');
  await expect(scores).toContainText('Price');
  await expect(scores.getByRole('row').nth(1)).toContainText('Price');
  await shot(page, 'p4-maxdiff-scores', choice);
  await choice.getByRole('combobox').first().selectOption('CBC');
  await choice.getByRole('button', { name: 'Estimate' }).click();
  await expect(page.getByTestId('conjoint-importance')).toContainText('Price');
  await shot(page, 'p4-conjoint-results', choice);

  const assistant = page.getByTestId('research-assistant');
  await expect(assistant).toContainText('AI is not configured on this server');
  await expect(assistant.getByRole('button', { name: 'Ask' })).toBeDisabled();
  await assistant.getByLabel('Compare by (banner)').selectOption('AGEGRP');
  await assistant.getByRole('button', { name: 'Show the tables it reads' }).click();
  await expect(page.getByTestId('assistant-tables')).toContainText('T1 · AGE');
  await expect(page.getByTestId('assistant-tables')).toContainText('Significance at 95%');
  await shot(page, 'p4-research-assistant', assistant);

  // --- QA lab: suggested test cases ---
  await page.getByRole('tab', { name: 'QA lab' }).click();
  await page.getByRole('button', { name: 'Suggest test cases' }).click();
  const suggested = page.getByTestId('suggested-cases');
  await expect(suggested).toContainText('ends complete');
  const keep = suggested.getByRole('button', { name: /^Save Suggested 1/ });
  await keep.click();
  await expect(keep).toHaveText('Saved');
  await expect(keep).toBeDisabled();
  await page.getByRole('button', { name: 'Run test cases' }).click();
  await expect(page.getByTestId('test-case-summary')).toContainText('1 passed, 0 failed');
  await shot(page, 'p4-suggested-cases', page.getByTestId('test-cases'));

  // --- Preview: the MaxDiff and conjoint screens, and the device matrix ---
  await page.getByRole('tab', { name: 'Preview' }).click();
  const frame = page.getByTestId('preview-frame');
  await frame.getByLabel('How old are you?').fill('30');
  await frame.getByLabel('Brand 1').check();
  await frame.getByRole('button', { name: 'Next' }).click();
  const sets = frame.locator('table.zx-maxdiff');
  await expect(sets).toHaveCount(4);
  await expect(sets.first().locator('caption')).toHaveText('Set 1 of 4');
  await frame.getByRole('button', { name: 'Next' }).click();
  await expect(frame).toContainText(/requires an answer|Choose one best/);
  for (let s = 0; s < 4; s++) {
    const rows = sets.nth(s).locator('tbody tr');
    await rows.nth(0).getByRole('radio').first().check();
    await rows.nth(1).getByRole('radio').last().check();
  }
  await shot(page, 'p4-maxdiff-screen', frame);
  await frame.getByRole('button', { name: 'Next' }).click();
  await expect(frame.locator('table.zx-conjoint')).toHaveCount(3);
  for (let t = 1; t <= 3; t++) await frame.getByRole('radio', { name: `Choice ${t} of 3: Option 1` }).check();
  await shot(page, 'p4-conjoint-screen', frame);
  await page.getByRole('button', { name: 'Device matrix' }).click();
  const matrix = page.getByTestId('device-matrix');
  await expect(matrix.locator('figure')).toHaveCount(3);
  await shot(page, 'p4-device-matrix-check', page.getByTestId('device-matrix'));
  await expect(page.getByTestId('matrix-phone')).toContainText('fits the screen');
  await expect(page.getByTestId('matrix-phone').frameLocator('iframe').locator('table.zx-conjoint')).toHaveCount(3);
  await shot(page, 'p4-device-matrix', matrix);

  // --- Build: recode and quota group editors; a page saved as a bank block and inserted again ---
  await page.getByRole('tab', { name: 'Build' }).click();
  await expect(page.getByLabel('Recode id')).toHaveValue('AGEGRP');
  await expect(page.getByLabel('Groups')).toHaveValue('1 | Under 35 | ..34\n2 | 35 plus | 35..');
  await expect(page.getByLabel('Least-fill group of QB1')).toHaveValue('BRAND');
  await shot(page, 'p4-recodes', page.getByTestId('recode-0'));
  await page.getByRole('button', { name: 'P1', exact: true }).click();
  await page.getByRole('button', { name: 'Save page to question bank as a block' }).click();
  const saveCard = page.locator('.flow-card').filter({ hasText: 'Save page P1 (2 questions) to the question bank' });
  await saveCard.getByLabel('Title in the bank').fill('Screener block');
  await saveCard.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved. Anyone in your organization')).toBeVisible();
  await page.getByRole('button', { name: '+ block from bank' }).last().click();
  await page
    .getByTestId('insert-block')
    .getByRole('button', { name: /Screener block/ })
    .click();
  await expect(page.getByRole('button', { name: 'P1_2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /AGE_2/ })).toBeVisible();
});
