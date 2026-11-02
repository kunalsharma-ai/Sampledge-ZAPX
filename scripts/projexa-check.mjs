#!/usr/bin/env node
/**
 * PROJEXA connection check (Milestone 13).
 *
 * Runs one real respondent through PROJEXA and ZAPX over HTTP, the way a vendor's respondent would,
 * and checks every step of the contract in PROJEXA docs/SURVEY_INTEGRATION.md:
 *
 *   1. PROJEXA test entry link  GET {projexa}/s/{testEntryCode}?uid=...  ->  302 to the ZAPX survey
 *      with the PROJEXA session token as the ZAPX uid
 *   2. ZAPX interview to the end (complete), using the public respondent API
 *   3. ZAPX sends the browser back to {projexa}/r/complete?token=...  ->  PROJEXA records the outcome
 *   4. ZAPX's callback worker posts the signed S2S confirmation  ->  PROJEXA marks it verified
 *
 * It uses only the public APIs of both systems (never a database), PROJEXA's *test* entry link (test
 * sessions never count toward quotas, revenue, payout or vendor callbacks) and creates a clearly named
 * client, vendor and project on each side. Nothing is deleted afterwards, so the run can be inspected.
 *
 * Environment:
 *   PROJEXA_URL           e.g. https://projexa.sampledge.com (its PUBLIC_BASE_URL)
 *   PROJEXA_EMAIL         a PROJEXA admin (reading the client's S2S secret needs ADMIN)
 *   PROJEXA_PASSWORD
 *   ZAPX_API_URL          e.g. https://zapx.sampledge.com/api
 *   ZAPX_RUNTIME_URL      the respondent runtime, e.g. https://take.zapx.sampledge.com
 *   ZAPX_EMAIL            a ZAPX admin
 *   ZAPX_PASSWORD
 *   CHECK_TIMEOUT_S       how long to wait for the S2S confirmation (default 90)
 *
 * PROJEXA's organization must allow the ZAPX runtime host in its redirect domains, and ZAPX must be
 * able to reach PROJEXA (locally that needs CALLBACK_ALLOW_PRIVATE_HOSTS=true on the ZAPX API).
 * Exit code 0 only when every step passed.
 */
/* eslint-disable no-console -- a command-line report */
const env = (k, d) => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === '') {
    console.error(`Missing ${k}. See the header of scripts/projexa-check.mjs.`);
    process.exit(2);
  }
  return v.replace(/\/+$/, '');
};
const PX = env('PROJEXA_URL');
const ZAPX = env('ZAPX_API_URL');
const RUNTIME = env('ZAPX_RUNTIME_URL');
const TIMEOUT_S = Number(process.env.CHECK_TIMEOUT_S ?? 90);
const run = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
const code = `ZC${run.slice(6, 14)}${run.slice(-4)}`.toUpperCase();

const steps = [];
function pass(name, detail = '') {
  steps.push({ name, ok: true });
  console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
}
function fail(name, detail) {
  steps.push({ name, ok: false });
  console.log(`  FAIL  ${name}: ${detail}`);
  summary();
}
function summary() {
  const bad = steps.filter((s) => !s.ok).length;
  console.log(bad ? `\nPROJEXA check failed (${bad} step).` : `\nPROJEXA check passed: ${steps.length} steps.`);
  process.exit(bad ? 1 : 0);
}

async function call(base, path, { method, body, token, redirect = 'follow' } = {}) {
  const res = await fetch(base + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  return { status: res.status, data, location: res.headers.get('location') };
}
async function ok(label, base, path, opts) {
  const r = await call(base, path, opts);
  if (r.status >= 400)
    fail(label, `${opts?.method ?? (opts?.body ? 'POST' : 'GET')} ${path} returned ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}

console.log(`PROJEXA connection check ${run}\n  PROJEXA ${PX}\n  ZAPX    ${ZAPX} (respondents at ${RUNTIME})\n`);

// ---- Sign in to both --------------------------------------------------------------------------
const pxLogin = await call(PX, '/api/v1/auth/login', { body: { email: env('PROJEXA_EMAIL'), password: env('PROJEXA_PASSWORD') } });
if (pxLogin.status !== 200 || !pxLogin.data.token)
  fail(
    'Sign in to PROJEXA',
    `HTTP ${pxLogin.status}${pxLogin.data.mfaRequired ? ' (this account needs two-step sign-in; use one without it)' : ''}`,
  );
const px = pxLogin.data.token;
pass('Sign in to PROJEXA');
const zLogin = await call(ZAPX, '/auth/login', { body: { email: env('ZAPX_EMAIL'), password: env('ZAPX_PASSWORD') } });
if (zLogin.status >= 400 || !zLogin.data.token) fail('Sign in to ZAPX', `HTTP ${zLogin.status}`);
const zx = zLogin.data.token;
pass('Sign in to ZAPX');

// ---- ZAPX survey (needs its id before PROJEXA gets the client survey link) -------------------
const zProject = await ok('Create ZAPX project', ZAPX, '/projects', {
  token: zx,
  body: { name: `PROJEXA check ${run}`, client: 'PROJEXA connection check' },
});
const zSurvey = await ok('Create ZAPX survey', ZAPX, `/projects/${zProject.id}/surveys`, {
  token: zx,
  body: { name: `PROJEXA check ${run}` },
});
await ok('Save ZAPX survey', ZAPX, `/surveys/${zSurvey.id}/draft`, {
  method: 'PUT',
  token: zx,
  body: {
    definition: {
      schemaVersion: 1,
      title: 'PROJEXA connection check',
      pages: [{ id: 'P1', questions: [{ id: 'Q1', type: 'single', text: 'Connection check', options: [{ code: 1, label: 'Yes' }] }] }],
    },
  },
});
await ok('Publish ZAPX survey', ZAPX, `/surveys/${zSurvey.id}/publish`, { token: zx, body: {} });
pass('ZAPX survey live', zSurvey.id);

// ---- PROJEXA client, vendor and project pointing at ZAPX ---------------------------------------
const pxClient = await ok('Create PROJEXA client', PX, '/api/v1/clients', { token: px, body: { name: `ZAPX check ${run}`, code } });
const { s2sSecret } = await ok('Read PROJEXA S2S secret', PX, `/api/v1/clients/${pxClient.id}/s2s-secret`, { token: px });
if (!s2sSecret) fail('Read PROJEXA S2S secret', 'empty');
const pxVendor = await ok('Create PROJEXA vendor', PX, '/api/v1/vendors', {
  token: px,
  body: { name: `ZAPX check panel ${run}`, code: `${code}V` },
});
const liveSurveyUrl = `${RUNTIME}/s/${zSurvey.id}?vid=${code}&uid={session_token}`;
const pxProject = await ok('Create PROJEXA project', PX, '/api/v1/projects', {
  token: px,
  body: {
    name: `ZAPX connection check ${run}`,
    category: 'B2C',
    clientId: pxClient.id,
    defaults: { language: 'en', loiMinutes: 5, irPercent: 100, cpi: 1, targetCompletes: 1, liveSurveyUrl },
    countries: [{ countryCode: 'US' }],
  },
});
let detail = await ok('Read PROJEXA project', PX, `/api/v1/projects/${pxProject.id}`, { token: px });
const country = detail.countries[0];
await ok('Allocate PROJEXA vendor', PX, `/api/v1/projects/${pxProject.id}/countries/${country.id}/allocations`, {
  token: px,
  body: { vendorId: pxVendor.id, cpi: 1, targetCompletes: 1 },
});
await ok('Put PROJEXA country live', PX, `/api/v1/projects/${pxProject.id}/countries/${country.id}`, {
  method: 'PATCH',
  token: px,
  body: { status: 'LIVE' },
});
await ok('Put PROJEXA project live', PX, `/api/v1/projects/${pxProject.id}`, { method: 'PATCH', token: px, body: { status: 'LIVE' } });
detail = await ok('Read PROJEXA project', PX, `/api/v1/projects/${pxProject.id}`, { token: px });
const allocation = detail.countries[0].allocations.find((a) => a.vendorId === pxVendor.id);
if (!allocation?.testEntryCode) fail('PROJEXA test entry link', 'the allocation has no testEntryCode');
pass('PROJEXA project live', detail.code ?? pxProject.id);

// ---- ZAPX vendor of type PROJEXA ---------------------------------------------------------------
await ok('Create ZAPX PROJEXA vendor', ZAPX, `/projects/${zProject.id}/vendors`, {
  token: zx,
  body: { name: 'PROJEXA', code, integration: 'PROJEXA', partnerBaseUrl: PX, partnerSecret: s2sSecret, partnerS2s: true },
});
pass('ZAPX vendor linked to PROJEXA');

// ---- 1. Entry through PROJEXA -----------------------------------------------------------------
const uid = `ZAPXCHECK-${run}`;
const entry = await call(PX, `/s/${allocation.testEntryCode}?uid=${uid}`, { redirect: 'manual' });
if (entry.status !== 302 || !entry.location)
  fail('1. PROJEXA entry redirects to ZAPX', `HTTP ${entry.status} ${entry.location ?? JSON.stringify(entry.data).slice(0, 200)}`);
const target = new URL(entry.location, PX);
if (target.pathname.startsWith('/g/'))
  fail(
    '1. PROJEXA entry redirects to ZAPX',
    `PROJEXA showed its security gate (${target.pathname}); turn the gate off for this check project`,
  );
if (`${target.origin}${target.pathname}` !== `${new URL(RUNTIME).origin}/s/${zSurvey.id}`)
  fail('1. PROJEXA entry redirects to ZAPX', `went to ${target.href}`);
const pxToken = target.searchParams.get('uid');
if (!pxToken || target.searchParams.get('vid') !== code) fail('1. PROJEXA entry redirects to ZAPX', `no session token in ${target.href}`);
pass('1. PROJEXA entry redirects to ZAPX', `token ${pxToken.slice(0, 6)}…`);

// ---- 2. Interview in ZAPX ---------------------------------------------------------------------
const query = Object.fromEntries(target.searchParams);
const start = await ok('2. ZAPX interview starts', ZAPX, `/public/s/${zSurvey.id}/start`, {
  body: { query, client: { touch: false, screenShortSide: 900, automation: false } },
});
if (start.state !== 'in_progress') fail('2. ZAPX interview starts', `state ${start.state}: ${start.message ?? ''}`);
const done = await ok('2. ZAPX interview completes', ZAPX, `/public/r/${start.token}/answers`, {
  body: { pageId: start.page.id, answers: { Q1: 1 }, signals: { interactions: 3 } },
});
if (done.state !== 'finished' || done.status !== 'complete')
  fail('2. ZAPX interview completes', `state ${done.state} ${done.status ?? ''}`);
pass('2. ZAPX interview completes');

// ---- 3. Browser back to PROJEXA ---------------------------------------------------------------
const expected = `${PX}/r/complete?token=${encodeURIComponent(pxToken)}`;
if (done.redirectUrl !== expected) fail('3. ZAPX sends the respondent back to PROJEXA', `got ${done.redirectUrl}, expected ${expected}`);
const back = await call(PX, new URL(done.redirectUrl).pathname + new URL(done.redirectUrl).search, { redirect: 'manual' });
if (back.status !== 302) fail('3. PROJEXA accepts the return', `HTTP ${back.status}`);
pass('3. PROJEXA accepts the return', `then to ${back.location}`);

// ---- 4. Signed S2S confirmation ----------------------------------------------------------------
const deadline = Date.now() + TIMEOUT_S * 1000;
let session;
for (;;) {
  const list = await ok('4. Read PROJEXA sessions', PX, `/api/v1/projects/${pxProject.id}/sessions?includeTest=true`, { token: px });
  const rows = Array.isArray(list) ? list : (list.items ?? list.sessions ?? []);
  session = rows.find((s) => s.vendorRespondentId === uid);
  if (session?.outcomeVerified) break;
  if (Date.now() > deadline) break;
  await new Promise((r) => setTimeout(r, 2000));
}
if (!session) fail('4. PROJEXA has the session', 'the test session is not in the project sessions list');
if (session.status !== 'COMPLETE') fail('4. PROJEXA recorded complete', `status ${session.status}`);
pass('4. PROJEXA recorded complete', session.isTest ? 'test session' : 'live session');
if (!session.outcomeVerified)
  fail(
    '4. ZAPX S2S confirmation verified',
    `not verified after ${TIMEOUT_S}s; check the delivery log for vendor ${code} in ZAPX (Integrations)`,
  );
pass('4. ZAPX S2S confirmation verified');

summary();
