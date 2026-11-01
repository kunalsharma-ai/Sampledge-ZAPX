/**
 * Milestone 4 acceptance test, through the real UI: organization AI settings, project redirect
 * defaults, a direct vendor with a country override and callbacks, redirect QA by country, a
 * respondent redirected by the country rule, the redirect log and callback deliveries, and the
 * PROJEXA vendor form.
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const demo = readFileSync(join(__dirname, '../../docs/examples/demo-screener.json'), 'utf8');
const run = `m4${Date.now().toString(36)}`;

test('redirect rules, callbacks, vendor logs and AI settings', async ({ page, context }) => {
  const redirects: string[] = [];
  await context.route(/https:\/\/(panel|panel-de|project)\.test\//, (route) => {
    redirects.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'vendor stub' });
  });

  await page.goto('/login');
  await page.getByRole('button', { name: 'New here? Create an organization' }).click();
  await page.getByLabel('Organization').fill(`E2E M4 ${run}`);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill(`e2e-${run}@test.zapx`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // --- Organization settings: AI permissions ---
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Organization settings' })).toBeVisible();
  const ai = page.getByTestId('ai-settings');
  await expect(ai.getByLabel('Allow AI features in this organization')).toBeChecked();
  await ai.getByLabel('AI translation').uncheck();
  await ai.getByLabel('Requests per minute').fill('5');
  await ai.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(ai.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('ai-settings').getByLabel('AI translation')).not.toBeChecked();
  await expect(page.getByTestId('ai-settings').getByLabel('Requests per minute')).toHaveValue('5');
  await expect(page.getByTestId('ai-usage-total')).toContainText('0 calls');

  // --- Project, survey ---
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByLabel('Name').fill('Global panel');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Global panel' }).click();

  // Project default for terminates
  const defaults = page.getByTestId('project-redirect-defaults');
  await defaults.getByRole('button', { name: 'Edit defaults' }).click();
  await defaults.getByLabel('Terminate URL', { exact: true }).fill('https://project.test/t?u=[UID]&s=[STATUS]');
  await defaults.getByRole('button', { name: 'Save defaults' }).click();
  await expect(defaults.getByText('Saved')).toBeVisible();

  // --- Direct vendor with a German override and callbacks ---
  await page.getByRole('button', { name: '+ Custom vendor' }).click();
  const editor = page.getByTestId('vendor-editor');
  await editor.getByLabel('Name').fill('Panel');
  await editor.getByLabel('Vendor ID on links (vid)').fill('PN');
  await editor.getByLabel('Complete URL', { exact: true }).fill('https://panel.test/c?u=[UID]');
  await editor.getByLabel('New country code (vendor)').fill('de');
  await editor.getByRole('button', { name: 'Add country' }).click();
  await editor.getByLabel('DE Complete URL').fill('https://panel-de.test/c?u=[UID]');
  await editor.getByLabel('Callback URL (GET, same placeholders)').fill('https://panel.test/postback?uid=[UID]&s=[STATUS]');
  await editor.getByTestId('callback-settings').getByLabel('Complete', { exact: true }).check();
  await editor.getByRole('button', { name: 'Save vendor' }).click();
  await expect(page.getByTestId('vendor-editor')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /Panel vid=PN/ })).toBeVisible();

  // Redirect QA by country shows which rule wins
  await page
    .getByRole('row', { name: /Panel vid=PN/ })
    .getByRole('button', { name: 'Edit' })
    .click();
  await editor.getByLabel('Preview country').fill('DE');
  await editor.getByRole('button', { name: 'Preview every status for UID TEST123' }).click();
  const preview = editor.getByTestId('redirect-preview');
  await expect(preview.getByRole('row', { name: /^Complete/ })).toContainText(
    'https://panel-de.test/c?u=TEST123  (static, vendor + country)',
  );
  await expect(preview.getByRole('row', { name: /^Terminate/ })).toContainText(
    'https://project.test/t?u=TEST123&s=terminate  (static, project)',
  );

  // --- A German respondent completes and goes to the German URL ---
  await editor.getByRole('button', { name: 'Close' }).click();
  await page.getByPlaceholder('New survey name').fill('Panel survey');
  await page.getByRole('button', { name: 'Create survey' }).click();
  await page.getByRole('tab', { name: 'JSON' }).click();
  await page.getByLabel('Survey definition JSON').fill(demo);
  await page.getByRole('button', { name: 'Apply JSON' }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved draft v1/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
  const surveyId = page.url().match(/\/surveys\/([^/?#]+)/)![1];

  const r = await context.newPage();
  await r.goto(`http://localhost:5173/s/${surveyId}?vid=PN&uid=E2E-DE&cc=DE`);
  await r.getByRole('spinbutton', { name: 'How old are you?' }).fill('40');
  await r.getByLabel('Woman', { exact: true }).check();
  await r.getByRole('button', { name: 'Next' }).click();
  await r.getByLabel('None of these', { exact: true }).check();
  await r.getByRole('button', { name: 'Next' }).click();
  await r.getByRole('textbox').fill('ok');
  await r.getByRole('button', { name: 'Next' }).click();
  await expect.poll(() => redirects.find((u) => u.includes('E2E-DE'))).toBe('https://panel-de.test/c?u=E2E-DE');

  // --- Vendor logs: the redirect, and the queued callback ---
  await page.goto('/');
  await page.getByRole('link', { name: 'Global panel' }).click();
  await page
    .getByRole('row', { name: /Panel vid=PN/ })
    .getByRole('button', { name: 'Edit' })
    .click();
  const logs = page.getByTestId('vendor-logs');
  await expect(logs.getByRole('row', { name: /complete/ }).first()).toContainText('https://panel.test/postback?uid=E2E-DE&s=complete');
  await logs.getByRole('tab', { name: 'Redirect log' }).click();
  await expect(logs.getByRole('row', { name: /E2E-DE/ })).toContainText('vendor + country');
  await expect(logs.getByRole('row', { name: /E2E-DE/ })).toContainText('https://panel-de.test/c?u=E2E-DE');

  // --- PROJEXA vendor form ---
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: '+ PROJEXA' }).click();
  const px = page.getByTestId('projexa-settings');
  await expect(px).toContainText('has not been tested against a running PROJEXA yet');
  await page.getByRole('button', { name: 'Save vendor' }).click();
  await expect(page.getByTestId('vendor-editor').getByRole('alert')).toContainText('PROJEXA needs its base URL');
  await px.getByLabel('PROJEXA base URL').fill('https://projexa.example.com');
  await px.getByLabel(/PROJEXA client secret/).fill('a-client-secret-from-projexa');
  await page.getByRole('button', { name: 'Save vendor' }).click();
  await expect(page.getByRole('cell', { name: /PROJEXA vid=PX/ })).toBeVisible();
  await page
    .getByRole('row', { name: /PROJEXA vid=PX/ })
    .getByRole('button', { name: 'Edit' })
    .click();
  await expect(page.getByTestId('projexa-settings').getByText('(saved; leave empty to keep)')).toBeVisible();
  await expect(page.getByTestId('projexa-settings').getByLabel(/PROJEXA client secret/)).toHaveValue('');
});
