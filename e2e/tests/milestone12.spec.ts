/**
 * Milestone 12 acceptance test, through the real UI: a programmer turns on location and consented
 * recording for face-to-face interviews; an online respondent answers with a photo; a bot that fills
 * the hidden field is flagged and rejected with its device blocked; an interviewer records an
 * interview offline with a photo and the respondent's consent, it syncs with its files, and the
 * reviewer sees the location, the recording and the photo.
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const run = `m12${Date.now().toString(36)}`;
const photo = join(__dirname, '../fixtures/pack-blue.png');
const interviewerEmail = `field-${run}@test.zapx`;
const home = { latitude: 51.5007, longitude: -0.1246, accuracy: 9 };

const definition = {
  schemaVersion: 1,
  title: 'Shelf check',
  pages: [
    { id: 'P1', questions: [{ id: 'SHOP', type: 'open', text: 'Which shop are you in?' }] },
    { id: 'P2', questions: [{ id: 'SHELF', type: 'photo', text: 'Take a photo of the shelf' }] },
  ],
};

test('fraud signals, photo answers and face-to-face capture', async ({ page, browser }) => {
  test.setTimeout(150_000);
  page.on('dialog', (d) => void d.accept());
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M12 ${run}`);
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
  const project = await call('/projects', { name: 'Retail audit' });
  await call(`/projects/${project.id}/vendors`, { name: 'Panel', code: 'PN' });
  const survey = await call(`/projects/${project.id}/surveys`, { name: 'Shelf check' });
  await call(`/surveys/${survey.id}/draft`, { definition }, 'put');
  const ana = await call('/users', { name: 'Ana Field', email: interviewerEmail, password: 'field-password-1', role: 'INTERVIEWER' });
  await call(`/surveys/${survey.id}/capi/assignments`, { interviewerId: ana.id });

  // --- Programmer: capture settings in the studio ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Quality & fieldwork' }).click();
  const capture = page.getByTestId('capture-settings');
  await capture.getByLabel('Record the interview location').selectOption('required');
  await capture.getByLabel('Record the interview audio').selectOption('consent');
  await expect(capture.getByLabel('What the interviewer reads out to ask for consent')).toBeVisible();
  await expect(page.getByTestId('quality-settings').getByLabel(/Fraud checks/)).toBeChecked();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();

  // --- An online respondent answers with a photo ---
  const ctx = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const r = await ctx.newPage();
  await r.goto(`/s/${survey.id}?vid=PN&uid=PERSON-${run}`);
  await r.getByRole('textbox', { name: 'Which shop are you in?' }).fill('The corner shop on Mill Road');
  await r.getByRole('button', { name: 'Next' }).click();
  await r.getByLabel('Take a photo of the shelf: Take or choose a photo').setInputFiles(photo);
  await expect(r.locator('img.zx-photo-preview')).toBeVisible();
  await expect(r.getByLabel('Take a photo of the shelf: Use a different photo')).toBeAttached();
  await r.getByRole('button', { name: 'Next' }).click();
  await expect(r.getByText('Thank you, your answers have been recorded.')).toBeVisible();

  // --- A bot fills in the field people never see ---
  const b = await ctx.newPage();
  await b.goto(`/s/${survey.id}?vid=PN&uid=BOT-${run}`);
  await b.getByRole('textbox', { name: 'Which shop are you in?' }).fill('Supermarket near the station');
  await b.locator('input[name="website"]').evaluate((i: HTMLInputElement) => (i.value = 'http://spam.example'));
  await b.getByRole('button', { name: 'Next' }).click();
  await b.getByLabel('Take a photo of the shelf: Take or choose a photo').setInputFiles(photo);
  await expect(b.locator('img.zx-photo-preview')).toBeVisible();
  await b.getByRole('button', { name: 'Next' }).click();
  await expect(b.getByText('Thank you, your answers have been recorded.')).toBeVisible();
  await ctx.close();

  // --- The reviewer rejects the bot and blocks its device ---
  await page.reload();
  await page.getByRole('tab', { name: 'Quality & fieldwork' }).click();
  const queue = page.getByTestId('review-queue');
  const bot = queue.getByTestId('review-item').filter({ hasText: `BOT-${run}` });
  await expect(bot).toContainText('A hidden field that people cannot see was filled in.');
  await expect(bot).toContainText('1 other complete came from what looks like the same device.');
  const shot = bot.getByRole('img', { name: `Photo answer SHELF of BOT-${run}` });
  await expect(shot).toHaveJSProperty('complete', true);
  expect(await shot.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(320);
  await bot.getByLabel(`Select BOT-${run}`).check();
  await queue.getByLabel('When rejecting, also block their device and network').check();
  await queue.getByRole('button', { name: 'Reject selected' }).click();
  await expect(queue.getByText(/Rejected 1; blocked 2 device or network entries/)).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Quality & fieldwork' }).click();
  const blocks = page.getByTestId('block-list');
  await expect(blocks.getByRole('row', { name: /device/ })).toContainText(`BOT-${run} in Shelf check`);

  // --- An interviewer works offline with location, recording and a photo ---
  const field = await browser.newContext({ geolocation: home, permissions: ['geolocation', 'microphone'] });
  const app = await field.newPage();
  app.on('dialog', (d) => void d.accept());
  await app.goto('http://localhost:5174/');
  await app.getByLabel('Email').fill(interviewerEmail);
  await app.getByLabel('Password').fill('field-password-1');
  await app.getByRole('button', { name: 'Sign in' }).click();
  const card = app.getByTestId('capi-survey').filter({ hasText: 'Shelf check' });
  await expect(card).toBeVisible();

  await field.setOffline(true);
  await card.getByRole('button', { name: 'Start interview' }).click();
  const consent = app.getByTestId('capi-consent');
  await expect(consent).toContainText('May I record the sound of this interview?');
  await consent.getByRole('button', { name: 'Respondent agrees: start recording' }).click();
  await expect(app.getByRole('status').filter({ hasText: 'Recording' })).toBeVisible();
  await app.getByRole('textbox', { name: 'Which shop are you in?' }).fill('Mini market at 12 Mill Road');
  await app.getByRole('button', { name: 'Next' }).click();
  await app.getByLabel('Take a photo of the shelf: Take or choose a photo').setInputFiles(photo);
  await expect(app.locator('img.zx-photo-preview')).toBeVisible();
  await app.waitForTimeout(1500); // a little audio
  // The interviewer walked 2 km before finishing: flagged for review.
  await field.setGeolocation({ latitude: 51.5187, longitude: -0.1246, accuracy: 12 });
  await app.getByRole('button', { name: 'Next' }).click();
  await expect(app.getByTestId('capi-finished')).toContainText('Result on this device: complete');
  await app.getByRole('button', { name: 'Back to interviews' }).click();
  await expect(app.getByTestId('waiting-count')).toHaveText('1');

  await field.setOffline(false);
  await expect(app.getByTestId('local-interviews')).toContainText('synced · complete');
  // Files leave the device once the server has the interview.
  const left = await app.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('zapx-capi');
        req.onsuccess = () => {
          const all = req.result.transaction('captures').objectStore('captures').count();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );
  expect(left).toBe(0);
  await field.close();

  // --- The reviewer sees where it happened, hears it and sees the photo ---
  await page.reload();
  await page.getByRole('tab', { name: 'Quality & fieldwork' }).click();
  await queue.getByRole('tab', { name: 'All flagged' }).click();
  const capi = queue.getByTestId('review-item').filter({ hasText: 'Ana Field' });
  await expect(capi).toContainText('The interview ended 2.0 km from where it started.');
  const evidence = capi.getByTestId('evidence');
  await expect(evidence).toContainText('started at 51.50070, -0.12460 (±9 m), ended 2002 m away');
  await expect(evidence).toContainText('audio: recorded with consent');
  const audio = evidence.getByLabel(/Recording of interview/);
  await audio.evaluate((a: HTMLAudioElement) => {
    a.preload = 'metadata';
    a.load();
  });
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThan(0);
  await expect(evidence.getByRole('img', { name: /Photo answer SHELF/ })).toHaveJSProperty('complete', true);
  await expect(page.getByTestId('captures')).toContainText('3 photos, 1 recording');
});
