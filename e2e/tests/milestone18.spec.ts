/**
 * Milestone 18 acceptance test, through the real UI: a programmer sets calling hours that exclude
 * the current time, so the interviewer is offered nothing; the hours are removed, the interviewer
 * takes the case, and the respondent asks not to be called again. The number joins the
 * organization's do-not-call list and the same number in another survey is never offered.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const run = `m18${Date.now().toString(36)}`;
const demo = JSON.parse(readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8'));
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

test('calling hours and the do-not-call list', async ({ page, browser }) => {
  test.setTimeout(90_000);
  page.on('dialog', (d) => void d.accept());
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M18 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`admin-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const headers = { 'x-zapx-csrf': '1' };
  const post = async (path: string, data: unknown, method: 'post' | 'put' = 'post') => {
    const res = await page.request[method](`/api${path}`, { data, headers });
    expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
    return res.json();
  };
  const project = await post('/projects', { name: 'Phone study' });
  const ivy = await post('/users', {
    name: 'Ivy Caller',
    email: `ivy-${run}@test.zapx`,
    password: 'member-password-1',
    role: 'INTERVIEWER',
  });
  const surveys: string[] = [];
  for (const name of ['Phone wave 1', 'Phone wave 2']) {
    const s = await post(`/projects/${project.id}/surveys`, { name });
    await post(`/surveys/${s.id}/draft`, { definition: demo }, 'put');
    await post(`/surveys/${s.id}/publish`, {});
    await post(`/surveys/${s.id}/capi/assignments`, { interviewerId: ivy.id });
    surveys.push(s.id);
  }
  await post(`/surveys/${surveys[1]}/cati/cases`, { cases: [{ code: 'W2-1', phone: '+44 7700 900111' }] });

  // --- Programmer: call list with a time zone column, and hours that exclude now (UTC) ---
  await page.goto(`/surveys/${surveys[0]}`);
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  const list = page.getByTestId('cati-calls');
  const csv = 'id,phone,name,timezone\nW1-1,+44 7700 900111,Asha Rao,UTC\n';
  await list.getByLabel('Call list file').setInputFiles({ name: 'calls.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await list.getByRole('button', { name: 'Add to call list' }).click();
  await expect(list.getByTestId('cati-upload-result')).toContainText('Added 1.');
  const hours = list.getByTestId('cati-hours');
  await expect(hours).toContainText('Not set: cases can be called at any time.');
  const now = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const [from, until] = now < 720 ? [now + 120, now + 240] : [now - 240, now - 120];
  await hours.getByLabel('Time zone').fill('UTC');
  await hours.getByLabel('From').fill(hm(from));
  await hours.getByLabel('Until').fill(hm(until));
  for (const d of ['Sun']) await hours.getByLabel(d).check();
  await hours.getByRole('button', { name: 'Save calling hours' }).click();
  await expect(hours.getByRole('status')).toHaveText('Calling hours saved.');
  await expect(hours).toContainText(`${hm(from)} to ${hm(until)}, Mon Tue Wed Thu Fri Sat Sun`);
  await expect(hours).toContainText('outside calling hours now');

  // --- Interviewer: nothing is offered outside the hours ---
  const ctx = await browser.newContext();
  const caller = await ctx.newPage();
  await caller.goto('/login');
  await caller.getByLabel('Email').fill(`ivy-${run}@test.zapx`);
  await caller.getByLabel('Password').fill('member-password-1');
  await caller.getByRole('button', { name: 'Sign in', exact: true }).click();
  await caller.getByRole('link', { name: 'Calls' }).first().click();
  await caller.getByRole('button', { name: 'Next case for Phone wave 1' }).click();
  await expect(caller.getByText('outside calling hours where the respondent lives')).toBeVisible();

  // --- Programmer removes the hours; the interviewer gets the case; the respondent says never again ---
  await hours.getByRole('button', { name: 'Remove' }).click();
  await expect(hours.getByRole('status')).toHaveText('Calling hours removed: cases can be called at any time.');
  await caller.reload();
  await caller.getByRole('button', { name: 'Next case for Phone wave 1' }).click();
  const card = caller.getByTestId('call-case');
  await expect(card.getByRole('heading')).toContainText('Asha Rao');
  await card.getByLabel('How did the call end?').selectOption('do_not_call');
  await card.getByRole('button', { name: 'Save call outcome' }).click();
  await expect(caller.getByRole('status')).toHaveText('Saved: Do not call again (closed).');

  // The same number in the other survey is never offered.
  await caller.reload();
  await caller.getByRole('button', { name: 'Next case for Phone wave 2' }).click();
  await expect(caller.getByText('Nobody is due to be called right now')).toBeVisible();

  await page.reload();
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  const dnc = page.getByTestId('do-not-call');
  await expect(dnc).toContainText('1 number.');
  await expect(dnc.getByRole('row').filter({ hasText: '…111' })).toContainText('asked on a call');
  await page.goto(`/surveys/${surveys[1]}`);
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  await expect(page.getByTestId('cati-dnc-count')).toContainText('1 on the do-not-call list');
});
