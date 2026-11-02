/**
 * Milestone 5 acceptance test, through the real UI: an administrator adds an interviewer, sets
 * quality rules in the studio and publishes; a speeding respondent lands in the review queue and
 * is rejected; the interviewer runs an interview offline in the CAPI app and it syncs when the
 * connection returns; the fieldwork dashboard shows both.
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const demo = readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8');
const run = `m5${Date.now().toString(36)}`;
const interviewerEmail = `field-${run}@test.zapx`;

test('quality review, fieldwork and an offline CAPI interview', async ({ page, browser }) => {
  page.on('dialog', (d) => void d.accept());

  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M5 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`e2e-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // --- Team: add a field interviewer ---
  await page.getByRole('link', { name: 'Settings' }).click();
  const team = page.getByTestId('team');
  await team.getByLabel('Member name').fill('Ana Field');
  await team.getByLabel('Member email').fill(interviewerEmail);
  await team.getByLabel('Initial password').fill('field-password-1');
  await team.getByLabel('Role').selectOption('INTERVIEWER');
  await team.getByRole('button', { name: 'Add member' }).click();
  await expect(team.getByRole('row', { name: /Ana Field/ })).toContainText('interviewer');

  // --- Project, vendor, survey with quality rules set in the studio ---
  await page.getByRole('link', { name: 'Projects' }).click();
  // Wait for the projects page: "Name" also matches the settings page's "Member name" field.
  await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
  await page.getByLabel('Name').fill('Field study');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Field study' }).click();
  await page.getByRole('button', { name: '+ Custom vendor' }).click();
  const editor = page.getByTestId('vendor-editor');
  await editor.getByLabel('Name').fill('Panel');
  await editor.getByLabel('Vendor ID on links (vid)').fill('PN');
  await editor.getByRole('button', { name: 'Save vendor' }).click();
  await expect(page.getByRole('cell', { name: /Panel vid=PN/ })).toBeVisible();

  await page.getByPlaceholder('New survey name').fill('Field survey');
  await page.getByRole('button', { name: 'Create survey' }).click();
  await page.getByRole('tab', { name: 'JSON' }).click();
  await page.getByLabel('Survey definition JSON').fill(demo);
  await page.getByRole('button', { name: 'Apply JSON' }).click();
  await page.getByRole('tab', { name: 'Quality & fieldwork' }).click();
  const settings = page.getByTestId('quality-settings');
  await settings.getByLabel('Minimum length (seconds)').fill('30');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft v1/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
  const surveyId = page.url().match(/\/surveys\/([^/?#]+)/)![1];

  // --- A speeding respondent with a gibberish answer ---
  const r = await page.context().newPage();
  await r.goto(`http://localhost:5173/s/${surveyId}?vid=PN&uid=E2E-FAST`);
  await r.getByRole('spinbutton', { name: 'How old are you?' }).fill('40');
  await r.getByLabel('Woman', { exact: true }).check();
  await r.getByRole('button', { name: 'Next' }).click();
  await r.getByLabel('None of these', { exact: true }).check();
  await r.getByRole('button', { name: 'Next' }).click();
  await r.getByRole('textbox').fill('sdfghjkl');
  await r.getByRole('button', { name: 'Next' }).click();
  await expect(r.getByText('Thank you, your answers have been recorded.')).toBeVisible();
  await r.close();

  // --- Review queue: the complete waits for a person, who rejects it ---
  await page.reload();
  await page.getByRole('tab', { name: 'Quality & fieldwork' }).click();
  const queue = page.getByTestId('review-queue');
  const item = queue.getByTestId('review-item').filter({ hasText: 'E2E-FAST' });
  await expect(item).toContainText('the minimum is 30 s');
  await expect(item).toContainText('COMMENTS: looks like gibberish.');
  await expect(item).toContainText('“sdfghjkl”');
  await expect(item.locator('.score')).toHaveText('20');
  await expect(page.getByTestId('fieldwork').getByRole('group', { name: 'Awaiting review' })).toContainText('1');
  await item.getByLabel('Select E2E-FAST').check();
  await queue.getByLabel('Review note').fill('Speeder, keyboard mashing');
  await queue.getByRole('button', { name: 'Reject selected' }).click();
  await expect(queue.getByText('Rejected 1')).toBeVisible();
  await queue.getByRole('tab', { name: /Rejected/ }).click();
  await expect(queue.getByTestId('review-item').filter({ hasText: 'E2E-FAST' })).toContainText('Note: Speeder, keyboard mashing');

  // --- Assign the interviewer ---
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  const capi = page.getByTestId('capi-assignments');
  await capi.getByLabel('Interviewer to assign').selectOption({ label: `Ana Field (${interviewerEmail})` });
  await capi.getByLabel('Target completes').fill('10');
  await capi.getByRole('button', { name: 'Assign' }).click();
  await expect(capi.getByRole('row', { name: /Ana Field/ })).toContainText('10');

  // --- The interviewer works offline in the CAPI app ---
  const field = await browser.newContext();
  const app = await field.newPage();
  app.on('dialog', (d) => void d.accept());
  await app.goto('http://localhost:5174/');
  await app.getByLabel('Email').fill(interviewerEmail);
  await app.getByLabel('Password').fill('field-password-1');
  await app.getByRole('button', { name: 'Sign in' }).click();
  const card = app.getByTestId('capi-survey').filter({ hasText: 'Field survey' });
  await expect(card).toContainText('0 completes synced of 10');

  await field.setOffline(true);
  await expect(app.getByTestId('connection')).toHaveText('Offline');
  await card.getByRole('button', { name: 'Start interview' }).click();
  await app.getByRole('spinbutton', { name: 'How old are you?' }).fill('52');
  await app.getByLabel('Man', { exact: true }).check();
  await app.getByRole('button', { name: 'Next' }).click();
  await app.getByLabel('None of these', { exact: true }).check();
  await app.getByRole('button', { name: 'Next' }).click();
  await app.getByRole('textbox').fill('Interviewed at the market, very engaged.');
  await app.getByRole('button', { name: 'Next' }).click();
  await expect(app.getByTestId('capi-finished')).toContainText('Result on this device: complete');
  await app.getByRole('button', { name: 'Back to interviews' }).click();
  await expect(app.getByTestId('waiting-count')).toHaveText('1');
  await expect(app.getByTestId('local-interviews')).toContainText('waiting · complete');

  // Back online: the app syncs by itself and the server confirms the outcome.
  await field.setOffline(false);
  await expect(app.getByTestId('local-interviews')).toContainText('synced · complete');
  await expect(app.getByTestId('waiting-count')).toHaveText('0');
  await expect(card).toContainText('1 complete synced of 10');
  await field.close();

  // --- Fieldwork shows the online and CAPI sources ---
  await page.getByRole('tab', { name: 'Quality & fieldwork' }).click();
  const fw = page.getByTestId('fieldwork');
  await fw.getByRole('button', { name: 'Refresh' }).click();
  await expect(fw.getByRole('group', { name: 'Starts' })).toContainText('1 online · 1 CAPI');
  await expect(fw.getByRole('row', { name: /CAPI · Ana Field/ })).toBeVisible();
  await expect(fw.getByRole('row', { name: /^PN/ })).toBeVisible();
});
