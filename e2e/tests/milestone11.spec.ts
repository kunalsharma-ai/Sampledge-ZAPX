/**
 * Milestone 11 acceptance test, through the real UI: a programmer uploads an ad video and pack
 * pictures in the visual editor and publishes; a respondent must play the ad to the end, picks a
 * pack by its picture, answers an NPS scale, ranks features, shares 100 points and uses a slider.
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const run = `m11${Date.now().toString(36)}`;
const fixture = (f: string) => join(__dirname, '../fixtures', f);

const definition = {
  schemaVersion: 1,
  title: 'Concept test',
  pages: [
    {
      id: 'P1',
      questions: [
        { id: 'AD', type: 'info', text: 'Please watch this ad.' },
        {
          id: 'PACK',
          type: 'single',
          text: 'Which pack do you prefer?',
          options: [
            { code: 1, label: 'Blue pack' },
            { code: 2, label: 'Red pack' },
          ],
        },
        {
          id: 'NPS',
          type: 'scale',
          text: 'How likely are you to recommend Brand A?',
          nps: true,
          minLabel: 'Not at all likely',
          maxLabel: 'Extremely likely',
        },
      ],
    },
    {
      id: 'P2',
      questions: [
        {
          id: 'RANK',
          type: 'ranking',
          text: 'Rank these features, most important first',
          options: [
            { code: 1, label: 'Price' },
            { code: 2, label: 'Taste' },
            { code: 3, label: 'Pack' },
          ],
        },
        {
          id: 'SPEND',
          type: 'sum',
          text: 'Share 100 points between the brands',
          unit: 'points',
          options: [
            { code: 1, label: 'Brand A' },
            { code: 2, label: 'Brand B' },
          ],
        },
        {
          id: 'TEMP',
          type: 'numeric',
          text: 'How appealing is the ad?',
          display: 'slider',
          min: 0,
          max: 10,
          step: 1,
          minLabel: 'Not at all',
          maxLabel: 'Very',
        },
      ],
    },
  ],
};

test('media in the editor, and the new question types for a respondent', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M11 ${run}`);
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
  const project = await call('/projects', { name: 'Concepts' });
  await call(`/projects/${project.id}/vendors`, { name: 'Panel', code: 'PN' });
  const survey = await call(`/projects/${project.id}/surveys`, { name: 'Ad and pack test' });
  await call(`/surveys/${survey.id}/draft`, { definition }, 'put');

  // --- Programmer: media in the visual editor ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('button', { name: /^AD\b/ }).click();
  await page.getByLabel('Upload a file (file)').setInputFiles(fixture('ad.webm'));
  await expect(page.locator('video.media-thumb')).toBeVisible();
  await page.getByLabel('Describe the clip (for screen readers)').fill('A short ad for Brand A');
  await page.getByLabel('Respondents must play it to the end before continuing').check();

  await page.getByRole('button', { name: /^PACK\b/ }).click();
  const rows = page.locator('.list-editor tbody tr');
  await rows.nth(0).getByLabel('Upload (file)').setInputFiles(fixture('pack-blue.png'));
  await expect(rows.nth(0).locator('img.option-thumb')).toBeVisible();
  await rows.nth(1).getByLabel('Upload (file)').setInputFiles(fixture('pack-red.png'));
  await expect(rows.nth(1).locator('img.option-thumb')).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();

  // --- Respondent ---
  const ctx = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const r = await ctx.newPage();
  await r.goto(`/s/${survey.id}?vid=PN&uid=${run}`);
  await expect(r.getByText('Please watch this ad.')).toBeVisible();
  const next = r.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  await expect(r.getByText('Please play the media to the end to continue.')).toBeVisible();
  const video = r.locator('video.zx-media-video');
  await expect(video).toHaveAttribute('aria-label', 'A short ad for Brand A');
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect(next).toBeEnabled({ timeout: 10_000 });

  // Image choice: the picture loads from the public media endpoint; the label names it.
  const blue = r.locator('label.zx-has-image', { hasText: 'Blue pack' });
  await expect(blue.locator('img')).toHaveJSProperty('complete', true);
  expect(await blue.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(320);
  await r.getByRole('radio', { name: 'Blue pack' }).check();
  await r.getByRole('radio', { name: '9', exact: true }).check();
  await next.click();

  // Ranking by tapping, then fine-tuning.
  await expect(r.getByText('Rank these features, most important first')).toBeVisible();
  await r.getByRole('button', { name: /Price.*rank 1/ }).click();
  await r.getByRole('button', { name: /Taste.*rank 2/ }).click();
  await r.getByRole('button', { name: 'Move up: Taste' }).click();
  await expect(r.getByRole('list', { name: 'Your ranking' }).getByRole('listitem').first()).toContainText('Taste');
  await r.getByRole('button', { name: /Pack.*rank 3/ }).click();

  // Constant sum with a running total.
  await r.getByRole('spinbutton', { name: 'Brand A' }).fill('70');
  await expect(r.getByText('Remaining: 30 points')).toBeVisible();
  await r.getByRole('spinbutton', { name: 'Brand B' }).fill('20');
  await r.getByRole('slider', { name: 'How appealing is the ad?' }).fill('8');
  await next.click();
  await expect(r.getByText('The amounts must add up to 100.')).toBeVisible();
  await r.getByRole('spinbutton', { name: 'Brand B' }).fill('30');
  await next.click();
  await expect(r.getByText('Thank you, your answers have been recorded.')).toBeVisible();

  // --- The data ---
  const csv = await (await page.request.get(`/api/surveys/${survey.id}/export?format=csv`)).text();
  const [header, row] = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');
  const cols = header!.split(',');
  const cell = (k: string) => row!.split(',')[cols.indexOf(k)];
  expect([
    cell('PACK'),
    cell('NPS'),
    cell('RANK_1'),
    cell('RANK_2'),
    cell('RANK_3'),
    cell('SPEND_1'),
    cell('SPEND_2'),
    cell('TEMP'),
  ]).toEqual(['1', '9', '2', '1', '3', '70', '30', '8']);
  await ctx.close();
});
