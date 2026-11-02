/**
 * Milestone 19 acceptance test, through the real UI, with a stand-in for Twilio that behaves like
 * it: when the dialer places a call, the stand-in reports the interviewer's phone ringing and
 * answered, asks ZAPX (signed, like Twilio) what to do, and reports that the respondent was busy.
 * The interviewer never sees the number, and the busy line is suggested as the call outcome.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const run = `m19${Date.now().toString(36)}`;
const demo = JSON.parse(readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8'));
const TOKEN = 'e2e-twilio-token';
const twimls: string[] = [];

function sign(url: string, params: Record<string, string>) {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac('sha1', TOKEN).update(data).digest('base64');
}
async function callBack(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(url, params) },
    body: new URLSearchParams(params),
  });
  return res.text();
}

let twilio: Server;
test.beforeAll(async () => {
  twilio = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST' || !req.url?.endsWith('/Calls.json')) {
        res.statusCode = 404;
        return res.end('{}');
      }
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      res.end(JSON.stringify({ sid: `CA${randomBytes(16).toString('hex')}`, status: 'queued' }));
      // What Twilio would do next: ring, answer, fetch the instructions, dial the respondent.
      const status = form.get('StatusCallback')!;
      const answer = form.get('Url')!;
      void (async () => {
        await new Promise((r) => setTimeout(r, 300));
        await callBack(status, { CallStatus: 'ringing' });
        await callBack(status, { CallStatus: 'in-progress' });
        const doc = await callBack(answer, { CallStatus: 'in-progress' });
        twimls.push(doc);
        const action = /action="([^"]+)"/.exec(doc)?.[1]?.replace(/&amp;/g, '&');
        if (action) await callBack(action, { DialCallStatus: 'busy', DialCallDuration: '0' });
        await callBack(status, { CallStatus: 'completed' });
      })();
    });
  });
  await new Promise<void>((r) => twilio.listen(5192, '127.0.0.1', r));
});
test.afterAll(async () => {
  await new Promise((r) => twilio?.close(r));
});

test('dialing through the phone dialer', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M19 ${run}`);
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
  const s = await post(`/projects/${project.id}/surveys`, { name: 'Dialled wave' });
  await post(`/surveys/${s.id}/draft`, { definition: demo }, 'put');
  await post(`/surveys/${s.id}/publish`, {});
  await post(`/surveys/${s.id}/capi/assignments`, { interviewerId: ivy.id });
  await post(`/surveys/${s.id}/cati/cases`, { cases: [{ code: 'D-1', phone: '+44 20 7946 0111', name: 'Asha Rao' }] });

  // --- Programmer turns the dialer on, with recording ---
  await page.goto(`/surveys/${s.id}`);
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  const dialer = page.getByTestId('cati-dialer');
  await expect(dialer).toContainText('Off: interviewers dial by hand.');
  await dialer.getByLabel('Use the dialer').check();
  await dialer.getByLabel('Record calls').check();
  await dialer.getByLabel('Read to the respondent before the call is connected').fill('This call is recorded for research.');
  await dialer.getByRole('button', { name: 'Save dialer settings' }).click();
  await expect(dialer.getByRole('status')).toHaveText('Dialer settings saved.');
  await expect(dialer).toContainText('On, calls are recorded. Interviewers do not see numbers.');

  // --- Interviewer adds their phone and calls ---
  const ctx = await browser.newContext();
  const caller = await ctx.newPage();
  await caller.goto('/login');
  await caller.getByLabel('Email').fill(`ivy-${run}@test.zapx`);
  await caller.getByLabel('Password').fill('member-password-1');
  await caller.getByRole('button', { name: 'Sign in', exact: true }).click();
  await caller.getByRole('link', { name: 'Calls' }).first().click();
  const mine = caller.getByTestId('my-phone');
  await mine.getByLabel('Phone number').fill('+44 7700 900123');
  await mine.getByRole('button', { name: 'Save my number' }).click();
  await expect(mine).toContainText('The dialer rings your number ending …123.');

  await caller.getByRole('button', { name: 'Next case for Dialled wave' }).click();
  const card = caller.getByTestId('call-case');
  await expect(card.getByRole('heading')).toContainText('Asha Rao');
  await expect(card.getByTestId('call-number')).toHaveCount(0);
  await expect(card).not.toContainText('7946');
  await expect(card.getByTestId('dialer')).toContainText('Number …111');
  await expect(card.getByTestId('dialer')).toContainText('Calls on this survey are recorded');
  await card.getByRole('button', { name: 'Call the respondent' }).click();
  await expect(card.getByTestId('dial-status')).toHaveText('The call has ended. Then the respondent was busy.', { timeout: 20_000 });
  await expect(card.getByLabel('How did the call end?')).toHaveValue('busy');
  expect(twimls[0]).toContain('+442079460111');
  expect(twimls[0]).toContain('record="record-from-answer-dual"');
  await card.getByRole('button', { name: 'Save call outcome' }).click();
  await expect(caller.getByRole('status')).toHaveText('Saved: Busy (pending).');
});
