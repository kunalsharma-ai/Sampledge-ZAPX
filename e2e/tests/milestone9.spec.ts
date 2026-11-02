/**
 * Milestone 9 acceptance test, through the real UI: a programmer uploads a call list; an assigned
 * interviewer takes the next case, sees the number to dial, opens the interview in the respondent
 * runtime, and records a callback and a no-answer. The call list then shows both outcomes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const run = `m9${Date.now().toString(36)}`;
const demo = JSON.parse(readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8'));

test('a call list worked by an interviewer', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M9 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // Set up through the API with the admin's session: a live survey and an assigned interviewer.
  const headers = { 'x-zapx-csrf': '1' };
  const post = async (path: string, data: unknown, method: 'post' | 'put' = 'post') => {
    const res = await page.request[method](`/api${path}`, { data, headers });
    expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
    return res.json();
  };
  const project = await post('/projects', { name: 'Phone study' });
  const survey = await post(`/projects/${project.id}/surveys`, { name: 'Phone screener' });
  await post(`/surveys/${survey.id}/draft`, { definition: demo }, 'put');
  await post(`/surveys/${survey.id}/publish`, {});
  const ivy = await post('/users', {
    name: 'Ivy Caller',
    email: `ivy-${run}@test.zapx`,
    password: 'member-password-1',
    role: 'INTERVIEWER',
  });
  await post(`/surveys/${survey.id}/capi/assignments`, { interviewerId: ivy.id });

  // --- Programmer: upload the call list ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  const list = page.getByTestId('cati-calls');
  const csv = 'id,phone,name,city\nP-1,+91 98100 11111,Asha Rao,Pune\nP-2,+91 98100 22222,Ravi Iyer,Delhi\nP-3,12,Broken,Goa\n';
  await list.getByLabel('Call list file').setInputFiles({ name: 'calls.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await list.getByRole('button', { name: 'Add to call list' }).click();
  await expect(list.getByTestId('cati-upload-result')).toContainText('Added 2. Skipped 1: row 3 (The phone number is not valid)');
  await expect(list.getByTestId('cati-cases')).toContainText('…111');
  await expect(list.getByTestId('cati-cases')).not.toContainText('98100 11111');

  // --- Interviewer: work the queue ---
  const ctx = await browser.newContext();
  const caller = await ctx.newPage();
  await caller.goto('/login');
  await caller.getByLabel('Email').fill(`ivy-${run}@test.zapx`);
  await caller.getByLabel('Password').fill('member-password-1');
  await caller.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(caller.getByTestId('interviewer-notice')).toContainText('open Calls');
  await caller.getByRole('link', { name: 'Calls' }).first().click();
  await caller.getByRole('button', { name: 'Next case for Phone screener' }).click();
  const card = caller.getByTestId('call-case');
  await expect(card.getByTestId('call-number')).toHaveAttribute('href', /^tel:\+919810011111$|^tel:\+919810022222$/);
  const first = (await card.getByRole('heading').textContent())!;

  // The interview opens in the respondent runtime, in a new tab.
  const [runtime] = await Promise.all([ctx.waitForEvent('page'), card.getByRole('button', { name: 'Start interview' }).click()]);
  await runtime.waitForURL(/\/r\/[A-Za-z0-9_-]+$/);
  await expect(runtime.getByText('How old are you?')).toBeVisible();
  await runtime.close();

  // The person asks to be called back.
  await card.getByLabel('How did the call end?').selectOption('callback');
  await card.getByLabel('Note (optional)').fill('Call after 6 pm');
  await card.getByRole('button', { name: 'Save call outcome' }).click();
  await expect(caller.getByRole('status')).toHaveText('Saved: Call back later (callback).');

  // Next case: nobody answers.
  await caller.getByRole('button', { name: 'Next case for Phone screener' }).click();
  await expect(card.getByRole('heading')).not.toHaveText(first);
  await card.getByLabel('How did the call end?').selectOption('no_answer');
  await card.getByRole('button', { name: 'Save call outcome' }).click();
  await expect(caller.getByRole('status')).toHaveText('Saved: No answer (pending).');
  await caller.getByRole('button', { name: 'Next case for Phone screener' }).click();
  await expect(caller.getByText('Nobody is due to be called right now.')).toBeVisible();

  // --- Programmer: the list shows both outcomes ---
  await page.reload();
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  await expect(list.getByTestId('cati-summary')).toContainText('1 callback');
  await expect(list.getByTestId('cati-cases')).toContainText('no answer');
});
