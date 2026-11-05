/**
 * Blueprint phase 3 through the UI: an interviewer outside the interview area scans a code, takes a
 * signature and pauses; the supervisor sees the exception and the evidence, fails a back-check; the
 * interviewer appeals and the supervisor reinstates the interview. Then email invitations: contacts
 * imported and a wave scheduled (sending is off in tests, which the page says).
 */
import { expect, test } from '@playwright/test';
import { autoConfirm } from './confirm-helper';

const run = `p3${Date.now().toString(36)}`;
/** Set SHOTS to a folder to keep screenshots of the new screens (used for the pull request). */
const shot = async (p: import('@playwright/test').Page, name: string, el?: import('@playwright/test').Locator) => {
  if (!process.env.SHOTS) return;
  await (el ?? p).screenshot({ path: `${process.env.SHOTS}/${name}.png`, ...(el ? {} : { fullPage: true }) });
};
const interviewerEmail = `field-${run}@test.zapx`;
const ward = { lat: 28.6315, lon: 77.2167 };

const definition = {
  schemaVersion: 1,
  title: 'Retail audit',
  pages: [
    {
      id: 'P1',
      questions: [
        { id: 'SHOP', type: 'open', text: 'Which shop are you in?' },
        { id: 'EAN', type: 'barcode', text: 'Scan the pack barcode', pattern: '^\\d{13}$' },
      ],
    },
    { id: 'P2', questions: [{ id: 'SIG', type: 'signature', text: 'Shopkeeper signature' }] },
  ],
  settings: { capi: { gps: 'optional', geofences: [{ label: 'Ward 4', ...ward, radiusM: 1500 }] } },
};

test('fieldwork evidence, back-checks, appeals and email invitations', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const answers: Record<string, string> = {
    'Why did the back-check fail? (shown to the interviewer if they appeal)': 'Shopkeeper says nobody came',
    'Questions whose answer did not match (ids, comma separated; optional)': 'SHOP',
    'Why is the interview reinstated?': 'Son confirmed the visit by phone',
  };
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? (answers[d.message()] ?? 'ok') : undefined));
  await autoConfirm(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E P3 ${run}`);
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
  const project = await call('/projects', { name: 'Field ops' });
  const survey = await call(`/projects/${project.id}/surveys`, { name: 'Retail audit' });
  await call(`/surveys/${survey.id}/draft`, { definition }, 'put');
  await call(`/surveys/${survey.id}/publish`, {});
  const ana = await call('/users', { name: 'Ana Field', email: interviewerEmail, password: 'field-password-1', role: 'INTERVIEWER' });
  await call(`/surveys/${survey.id}/capi/assignments`, { interviewerId: ana.id, target: 5 });

  // --- The interviewer is 3 km outside the area, scans a code, gets a signature and pauses ---
  const field = await browser.newContext({
    geolocation: { latitude: 28.66, longitude: 77.2167, accuracy: 15 },
    permissions: ['geolocation'],
  });
  const app = await field.newPage();
  const appDialogs: string[] = [];
  app.on('dialog', (d) => {
    appDialogs.push(d.message());
    void d.accept(d.type() === 'prompt' ? 'The owner was away; his son answered and signed.' : undefined);
  });
  await app.goto('http://localhost:5174/');
  await app.getByLabel('Email').fill(interviewerEmail);
  await app.getByLabel('Password').fill('field-password-1');
  await app.getByRole('button', { name: 'Sign in' }).click();
  const card = app.getByTestId('capi-survey').filter({ hasText: 'Retail audit' });
  await card.getByRole('button', { name: 'Start interview' }).click();
  const outside = app.getByRole('alertdialog', { name: 'Outside the interview areas' });
  await expect(outside).toContainText('outside the interview areas of this survey (nearest: Ward 4)');
  await outside.getByRole('button', { name: 'Start anyway' }).click();
  await app.getByRole('textbox', { name: 'Which shop are you in?' }).fill('Sharma General Store');
  await app.getByRole('textbox', { name: 'Scan the pack barcode' }).fill('ABC');
  await app.getByRole('button', { name: 'Next' }).click();
  await expect(app.getByText('This code does not have the expected format.')).toBeVisible();
  await app.getByRole('textbox', { name: 'Scan the pack barcode' }).fill('4006381333931');
  await app.getByRole('button', { name: 'Pause' }).click();
  await expect(app.getByTestId('capi-paused')).toContainText('The pause is logged with the interview.');
  await app.waitForTimeout(1200);
  await app.getByRole('button', { name: 'Resume the interview' }).click();
  await app.getByRole('button', { name: 'Next' }).click();

  const pad = app.getByRole('img', { name: /Shopkeeper signature/ });
  await app.getByRole('button', { name: 'Next' }).click();
  await expect(app.getByText('This question requires an answer.')).toBeVisible();
  const box = (await pad.boundingBox())!;
  await app.mouse.move(box.x + 20, box.y + box.height / 2);
  await app.mouse.down();
  for (let i = 1; i <= 10; i++) await app.mouse.move(box.x + 20 + i * 25, box.y + box.height / 2 + (i % 2 ? -20 : 20));
  await app.mouse.up();
  await expect(pad).toHaveAttribute('aria-label', 'Shopkeeper signature: signed');
  await shot(app, 'capi-signature');
  await app.getByRole('button', { name: 'Next' }).click();
  await expect(app.getByTestId('capi-finished')).toContainText('Result on this device: complete');
  await app.getByRole('button', { name: 'Back to interviews' }).click();
  await app.getByRole('button', { name: 'Sync now' }).click();
  await expect(app.getByTestId('local-interviews')).toContainText('synced · complete');

  // --- The supervisor sees the exception and the evidence ---
  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  const sup = page.getByTestId('supervisor');
  await expect(sup.getByTestId('productivity')).toContainText('Ana Field');
  await expect(sup.getByTestId('productivity')).toContainText('1 outside area');
  await expect(sup.getByTestId('exceptions')).toContainText('outside the nearest allowed area (Ward 4)');
  await expect(sup.getByTestId('field-map').locator('circle')).toHaveCount(2);

  await page.getByRole('tab', { name: 'Quality & fieldwork' }).click();
  const queue = page.getByTestId('review-queue');
  await queue.getByRole('tab', { name: 'All flagged' }).click();
  const item = queue.getByTestId('review-item').filter({ hasText: 'Ana Field' });
  const evidence = item.getByTestId('evidence');
  await expect(evidence).toContainText('Interview area: outside');
  await expect(evidence).toContainText('Interruptions: 1');
  await expect(evidence.getByRole('img', { name: /Signature SIG of/ })).toBeVisible();
  await evidence.getByText('Page timestamps (2)').click();
  await expect(evidence.getByTestId('page-times')).toContainText('P2');
  await shot(page, 'review-evidence', item);

  // --- A back-check fails; the interviewer appeals; the supervisor reinstates ---
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  const checks = page.getByTestId('backchecks');
  await checks.getByLabel('Share to check (%)').fill('100');
  await checks.getByRole('button', { name: 'Draw back-checks' }).click();
  await expect(checks.getByText('Drew 1 of 1 completed interviews not checked before.')).toBeVisible();
  await checks.getByRole('button', { name: 'Failed' }).click();
  await expect(checks).toContainText('Shopkeeper says nobody came');
  await expect(checks).toContainText('Did not match: SHOP');

  await app.getByRole('button', { name: 'Check my results' }).click();
  const results = app.getByTestId('results');
  await expect(results).toContainText('Back-check failed: Shopkeeper says nobody came');
  await results.getByRole('button', { name: 'Appeal' }).click();
  await expect(results).toContainText('appeal open');
  await shot(app, 'capi-appeal');
  await field.close();

  await page.reload();
  await page.getByRole('tab', { name: 'Interviewers' }).click();
  const appeals = page.getByTestId('appeals');
  await expect(appeals).toContainText('his son answered and signed');
  await appeals.getByRole('button', { name: 'Reinstate' }).click();
  await expect(appeals).toContainText('overturned');
  await shot(page, 'supervisor-dashboard', page.getByTestId('supervisor'));
  await expect(page.getByTestId('productivity')).toContainText('Ana Field');

  // --- Email invitations: contacts and a scheduled wave ---
  await page.getByRole('tab', { name: 'Distribution' }).click();
  const mail = page.getByTestId('email-invitations');
  await expect(mail.getByTestId('email-off')).toContainText('Email sending is off on this server');
  await mail
    .getByLabel(/Paste contacts as CSV/)
    .fill('email,name,region\nasha@example.com,Asha,North\nnot-an-email,Bob,South\nchen@example.com,Chen,East');
  await mail.getByRole('button', { name: 'Import contacts' }).click();
  await expect(mail.getByRole('status').filter({ hasText: '2 added' })).toContainText('row 3');
  await expect(mail).toContainText('2 contacts');
  await mail.getByRole('button', { name: 'Schedule wave' }).click();
  await expect(mail.getByTestId('waves')).toContainText('Wave 1');
  await expect(mail.getByTestId('waves')).toContainText('scheduled');
  await shot(page, 'email-invitations', mail);
  const download = page.waitForEvent('download');
  await mail.getByRole('link', { name: 'Personal links' }).click();
  const csv = await (await download).createReadStream();
  const text = await new Promise<string>((resolve) => {
    let s = '';
    csv.on('data', (c) => (s += c));
    csv.on('end', () => resolve(s));
  });
  expect(text).toContain(`/s/${survey.id}?vid=ZAPX_EMAIL&uid=inv-`);
  expect(text).toContain('region=North');
});
