/**
 * Webcam eye tracking (experimental) through the UI: the question in the editor (picture and an
 * area of interest), a respondent who agrees and turns on the camera (the face model is served by
 * ZAPX and loads; the browser's fake camera shows no face, so the task ends as "no face found"), a
 * respondent who skips, and the results in Analysis from recorded answers.
 *
 * Gaze estimation on a real face is not exercised here: the test camera has no face, and the
 * estimator has not been validated on real webcams. The recorded answers below are made up.
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const run = `eye${Date.now().toString(36)}`;
const fixture = (f: string) => join(__dirname, '../fixtures', f);
const shot = async (p: import('@playwright/test').Page, name: string, el?: import('@playwright/test').Locator) => {
  if (!process.env.SHOTS) return;
  await (el ?? p).screenshot({ path: `${process.env.SHOTS}/${name}.png`, ...(el ? {} : { fullPage: true }) });
};

const definition = {
  schemaVersion: 1,
  title: 'Shelf test',
  pages: [
    {
      id: 'P1',
      questions: [
        {
          id: 'EYE',
          type: 'eyetrack',
          text: 'Please look at the pack as you normally would',
          imageAlt: 'A blue pack',
          aois: [],
          durationSec: 4,
        },
      ],
    },
  ],
};

/** Gaze on the left half for the first second, then the right half (thousandths of the picture). */
function recording(errorPct: number) {
  const pts: string[] = [];
  for (let t = 0; t < 4000; t += 100) pts.push(t < 1000 ? `${t},250,${400 + (t % 300)}` : `${t},${700 + (t % 200)},500`);
  return `recorded|${errorPct * 10}|4000|${pts.join(' ')}`;
}

test('eye tracking: editor, consent, camera with no face, skip, and results', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E Eye ${run}`);
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
  const project = await call('/projects', { name: 'Packs' });
  await call(`/projects/${project.id}/vendors`, { name: 'Panel', code: 'PN' });
  const survey = await call(`/projects/${project.id}/surveys`, { name: 'Shelf test' });
  await call(`/surveys/${survey.id}/draft`, { definition }, 'put');

  // --- Editor: the experimental notice, the picture and one area of interest ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('button', { name: /^EYE\b/ }).click();
  await expect(page.getByTestId('eyetrack-experimental')).toContainText('has not been validated on real webcams');
  await page.getByLabel('Upload (file)').setInputFiles(fixture('pack-blue.png'));
  const canvas = page.locator('.hotspot-canvas');
  await expect(canvas.locator('img')).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.9, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel('Area label').first().fill('Logo');
  await page.getByTestId('eyetrack-experimental').scrollIntoViewIfNeeded();
  await shot(page, 'eye-editor', page.locator('main'));
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();

  // --- A respondent agrees: the camera starts and the face model (served by ZAPX) loads ---
  const ctx = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const r = await ctx.newPage();
  await r.goto(`/s/${survey.id}?vid=PN&uid=${run}-a`);
  await expect(r.getByText('This question uses your camera')).toBeVisible();
  await expect(r.getByText('Experimental: the camera estimate')).toBeVisible();
  await shot(r, 'eye-consent');
  await r.getByRole('button', { name: 'I agree, turn on the camera' }).click();
  await expect(r.getByText('Sit about an arm’s length from the screen')).toBeVisible({ timeout: 30_000 });
  // The test camera shows no face, so calibration cannot start.
  await expect(r.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await shot(r, 'eye-camera');
  await expect(r.getByText('We could not see a face in the camera.')).toBeVisible({ timeout: 30_000 });
  await r.getByRole('button', { name: 'Next' }).click();
  await expect(r.getByText(/Thank you/)).toBeVisible();

  // --- Another skips the task ---
  await r.goto(`/s/${survey.id}?vid=PN&uid=${run}-b`);
  await r.getByRole('button', { name: 'Skip this task' }).click();
  await expect(r.getByText('You skipped this task.')).toBeVisible();
  await r.getByRole('button', { name: 'Next' }).click();
  await expect(r.getByText(/Thank you/)).toBeVisible();
  await ctx.close();

  // --- Three recorded answers (made-up gaze points), sent as the respondent page would ---
  for (const [i, err] of [6, 8, 30].entries()) {
    const start = await (
      await page.request.post(`/api/public/s/${survey.id}/start`, { data: { query: { vid: 'PN', uid: `${run}-r${i}` } } })
    ).json();
    const res = await page.request.post(`/api/public/r/${start.token}/answers`, {
      data: { pageId: 'P1', answers: { EYE: recording(err) } },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }

  // --- Results in Analysis ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Analysis' }).click();
  const results = page.getByTestId('eye-results');
  await expect(results).toContainText('has not been validated on real webcams');
  await results.getByRole('button', { name: 'Show results' }).click();
  await expect(results.getByTestId('eye-summary')).toContainText('2 of 5 respondents used');
  await expect(results.getByTestId('eye-summary')).toContainText('1 left out as less accurate than 15%');
  await expect(results.getByTestId('eye-statuses')).toContainText('No face found');
  const heat = results.getByTestId('eye-heatmap');
  await expect(heat.locator('canvas')).toBeVisible();
  // The heatmap covers exactly the picture.
  const [pic, layer] = await Promise.all([heat.locator('img').boundingBox(), heat.locator('canvas').boundingBox()]);
  expect(Math.abs(pic!.width - layer!.width)).toBeLessThan(2);
  expect(Math.abs(pic!.height - layer!.height)).toBeLessThan(2);
  await expect(results.getByTestId('eye-aois')).toContainText('Logo');
  await results.scrollIntoViewIfNeeded();
  await shot(page, 'eye-results', results);
});
