# API documentation

The ZAPX backend is a REST API under `/api`, served by `apps/api` on port 4000. This file explains the
common rules, walks through the main flows with **real requests and responses** (captured from a
local run on 2026-11-05; ids shortened), and then lists **all 246 endpoints** with who may call them
and the exact handler.

Other contracts that already exist and stay authoritative for partners:
[docs/api/openapi.yaml](../api/openapi.yaml) (vendor API) and
[docs/api/capi-openapi.yaml](../api/capi-openapi.yaml) (CAPI app API). Webhook payloads and
signatures: [docs/modules/webhooks.md](../modules/webhooks.md). Redirect placeholders and callbacks:
[docs/modules/redirects.md](../modules/redirects.md).

## 1. Common rules

| Topic          | Rule                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL       | `http://localhost:4000/api` locally; in browsers always the same origin (`/api/...`) through the studio/runtime/CAPI proxy                                           |
| Format         | JSON in and out (`Content-Type: application/json`). File uploads are `multipart/form-data` (field `file`). Downloads stream the file.                                |
| Authentication | one of: cookie `zapx_token` (studio), `Authorization: Bearer <session token>`, `Authorization: Bearer zapx_<prefix>_<secret>` (API key). Public routes need nothing. |
| CSRF           | when you authenticate **with the cookie**, every non-GET request must send `x-zapx-csrf: 1`, otherwise `403 Missing CSRF header`. Bearer requests do not need it.    |
| Roles          | see the "Who can call it" column. `INTERVIEWER` can only call routes that list it.                                                                                   |
| Project access | members with assigned-project access get `404` for anything outside their projects                                                                                   |
| Rate limits    | 600 requests/minute per address by default; tighter limits are shown per route. Over the limit: `429`.                                                               |
| Ids            | strings (cuid, UUID for responses, 22-char random for media and captures)                                                                                            |
| Dates          | ISO 8601 strings in UTC                                                                                                                                              |

### Error responses

All errors use NestJS's shape. Examples captured from the running API:

```jsonc
// 401 – no session
{ "message": "Not signed in", "error": "Unauthorized", "statusCode": 401 }

// 400 – body failed its Zod schema (apps/api/src/common/validation.ts)
{ "message": "Invalid request", "issues": [{ "path": "name", "message": "Invalid input: expected string, received undefined" }] }

// 409 – someone saved the draft since you loaded it
{ "message": "Someone else saved this draft since you opened it. Reload to see their changes.", "error": "Conflict", "statusCode": 409 }

// 422 – a respondent's page has invalid answers
{ "message": "Some answers need attention", "errors": [
    { "questionId": "AGE", "message": "Enter a number no greater than 120." },
    { "questionId": "GENDER", "message": "This question requires an answer." } ] }
```

| Status | Typical cause                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| 400    | invalid body or query                                                                                         |
| 401    | not signed in, session expired or revoked, account disabled, bad API key, bad vendor signature                |
| 403    | missing CSRF header, role not allowed, API key used where a session is needed, sign-up disabled, SSO required |
| 404    | not found **or** outside your organization/project access                                                     |
| 409    | stale draft or page, duplicate (vendor code, email), live survey must be paused first                         |
| 422    | publish blocked by the logic check / translations / missing media; respondent answers invalid                 |
| 429    | rate limit, or account locked (`code: "ACCOUNT_LOCKED"`)                                                      |
| 503    | AI not configured (no `ANTHROPIC_API_KEY` or `AI_MODEL`), or a provider switched off                          |

## 2. Main flows with examples

All examples use `curl` with a bearer token so they work outside the browser.

### Sign in and check who you are

```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@zapx.local","password":"<seed-password>"}'
```

```json
{ "user": { "id": "cmw38yji1…", "email": "admin@zapx.local", "name": "Demo admin", "role": "ADMIN" }, "token": "eyJhbGciOiJIUzI1NiIs…" }
```

The response also sets the `zapx_token` cookie (12 hours). Use the `token` as a bearer:

```bash
TOKEN=eyJhbGciOiJIUzI1NiIs…
curl -s http://localhost:4000/api/auth/me -H "Authorization: Bearer $TOKEN"
```

```json
{
  "id": "cmw38yji1…",
  "email": "admin@zapx.local",
  "name": "Demo admin",
  "role": "ADMIN",
  "projectScope": "ALL",
  "tenant": { "id": "cmw38yjf4…", "name": "Demo tenant" },
  "viaApiKey": null
}
```

Files: `apps/api/src/auth/auth.controller.ts` (`login`, `me`), `apps/studio/app/login/page.tsx`, `apps/studio/lib/useMe.ts`.

### Change or reset a password _(branch `security-fixes`)_

```bash
# Change my own password (keeps this session, signs out the others; 400 if the current one is wrong)
curl -s -b cookie.txt -c cookie.txt -H 'x-zapx-csrf: 1' -H 'content-type: application/json' \
  -d '{"currentPassword":"<current>","newPassword":"<new, 10+ characters>"}' localhost:4000/api/auth/change-password
# → {"ok":true}  (and a new zapx_token cookie)

# Administrator: one-time reset link for a member (also emailed when EMAIL_PROVIDER is set)
curl -s -b cookie.txt -H 'x-zapx-csrf: 1' -X POST localhost:4000/api/users/<memberId>/password-reset
# → {"url":"http://localhost:3000/reset-password?token=<token>","expiresAt":"…","emailed":false}

# Anyone: ask for a link by email (always 204, whether or not the account exists)
curl -s -H 'content-type: application/json' -d '{"email":"<email>"}' localhost:4000/api/auth/forgot-password

# Set the new password with the token from the link (204; 400 if used, expired or replaced)
curl -s -H 'content-type: application/json' -d '{"token":"<token>","password":"<new>"}' localhost:4000/api/auth/reset-password
```

A reset signs out every session of that member and clears an account lockout. Code:
`apps/api/src/auth/password-reset.service.ts`; studio pages `app/account`, `app/forgot-password`,
`app/reset-password`; the admin button is in `components/Team.tsx`.

### Create a project, a vendor and a survey

```bash
curl -s -X POST http://localhost:4000/api/projects -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Handbook demo","client":"Acme"}'
# → {"id":"cmw39965k…","tenantId":"…","name":"Handbook demo","client":"Acme","redirectDefaults":{},"createdAt":"…","deletedAt":null}

curl -s -X POST http://localhost:4000/api/projects/$PROJECT/vendors -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{
    "name":"Sampledge","code":"SE",
    "staticUrls":{"complete":"https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]"},
    "statusWords":{"complete":"complete"}}'
# → {"id":"cmw39967o…","code":"SE","integration":"DIRECT","redirectMode":"STATIC","secret":"<64 hex>", …, "partnerSecretSet":false}

curl -s -X POST http://localhost:4000/api/projects/$PROJECT/surveys -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Demo screener"}'
# → {"id":"cmw39969y…","status":"DRAFT","liveVersionId":null, …}
```

Vendor body fields (all optional except `name` and `code`) are defined by `vendorSchema` in
`apps/api/src/vendors/vendors.controller.ts`: `integration` (`DIRECT`/`PROJEXA`), `redirectMode`
(`STATIC`/`DYNAMIC`/`HYBRID`), `staticUrls` and `statusWords` (per outcome), `countryRedirects`,
`dynamicAllowedHosts`, `dynamicParam`, `requireSignedEntry`, `signRedirects`, `callbackUrl`,
`callbackStatuses`, `callbackMaxAttempts`, `partnerBaseUrl`, `partnerSecret` (write-only), `partnerS2s`,
`presetId`. A survey can start from `template` (built-in key) or `libraryItemId` _(PR #30)_.

The vendor's shared `secret` (64 hex characters) is in the answer only for ADMIN;
for PROGRAMMER and VIEWER the field is left out _(branch `security-fixes`)_.

### Save a draft, publish and go live

```bash
# 1. read the draft to get its updatedAt
curl -s http://localhost:4000/api/surveys/$SURVEY/draft -H "Authorization: Bearer $TOKEN"
# → {"version":{"id":"…","version":1,"definition":{…},"presentation":{…},"updatedAt":"2026-11-05T07:59:47.977Z",…},"check":{…}}

# 2. save a definition (here docs/examples/demo-screener.json)
curl -s -X PUT http://localhost:4000/api/surveys/$SURVEY/draft -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"definition": { …demo-screener.json… }, "expectedUpdatedAt": "2026-11-05T07:59:47.977Z"}'
# → {"version":{…},"check":{"schemaOk":true,"schemaIssues":[],"analysis":{"ok":true,…},"publishable":true,…}}
#   sending the same expectedUpdatedAt again → 409 (see errors above)

# 3. publish (422 if the check fails) and put it live
curl -s -X POST http://localhost:4000/api/surveys/$SURVEY/publish -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:4000/api/surveys/$SURVEY/status -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"LIVE"}'
# → {"id":"…","status":"LIVE","liveVersionId":"cmw3996a1…", …}
```

Publishing does not change the survey status by itself; set `LIVE`, `PAUSED` or `CLOSED` with
`/status`. Files: `apps/api/src/surveys/surveys.controller.ts`, `surveys.service.ts`
(`saveDraft`, `check`, `publish`, `setStatus`).

The `check` object is `CheckResult` in `apps/api/src/surveys/surveys.service.ts`: `schemaOk`,
`schemaIssues`, `analysis` (the logic engine's `AnalysisReport`, with `ok` and the list of problems),
`presentationIssues`, `translations`, `languageBlockers` and `publishable`.

### Create a respondent link

```bash
curl -s -X POST http://localhost:4000/api/surveys/$SURVEY/links -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"vendorId":"'$VENDOR'","uid":"R1001","country":"US"}'
```

```json
{ "url": "http://localhost:5173/s/cmw39969y…?vid=SE&uid=R1001&cc=US", "template": "http://localhost:5173/s/cmw39969y…?vid=SE&uid=[UID]" }
```

Body (`linkSchema`): `vendorId`, `uid`, `country`, `test` (signed test link, never counts toward
quotas), `expiresInHours` (signed vendors). For vendors with `requireSignedEntry`, the link carries
`exp` and `sig = HMAC-SHA256(vendor secret, sorted query without sig)`.

### Take the survey as a respondent (public)

```bash
curl -s -X POST http://localhost:4000/api/public/s/$SURVEY/start -H 'content-type: application/json' \
  -d '{"query":{"vid":"SE","uid":"R1001","cc":"US"},"client":{"touch":false,"screenShortSide":900}}'
```

```jsonc
{ "state": "in_progress", "token": "eOVYK9eD…",            // keep this: it is the respondent's key
  "survey": { "title": "Demo screener", "showProgress": true, "allowBack": false, … },
  "page": { "id": "P1", "questions": [ { "id": "AGE", "type": "numeric", … }, { "id": "GENDER", "type": "single", … } ] },
  "answers": {}, "context": {}, "progress": 0, "isFirstPage": true, "isTest": false, "look": { … } }
```

```bash
curl -s -X POST http://localhost:4000/api/public/r/$RTOKEN/answers -H 'content-type: application/json' \
  -d '{"pageId":"P1","answers":{"AGE":34,"GENDER":2}}'
# → {"state":"in_progress","page":{"id":"P2",…},"progress":25,…}
# wrong pageId → 409 "This page is out of date. Reload to continue."
# … last page:
# → {"state":"finished","status":"complete","message":"Thank you, your answers have been recorded.",
#    "redirectUrl":"https://platform.sampledge.com/response/status?status=complete&uid=R1001","isTest":false,…}
```

A screened-out respondent (`AGE` 15 hits termination `T_UNDERAGE`) got
`{"state":"finished","status":"terminate","redirectUrl":null}` because this vendor had no terminate
URL: **each outcome needs its own URL (or a project/organization default), or the respondent is not
redirected.** Other public routes: `GET /public/r/:token` (resume), `POST /public/r/:token/back`,
`POST /public/r/:token/language`, `POST /public/r/:token/captures` (photo). Body limits are in
`apps/api/src/interview/interview.controller.ts`.

### Export data

```bash
# small: direct download (up to EXPORT_SYNC_MAX_ROWS rows)
curl -s "http://localhost:4000/api/surveys/$SURVEY/export?format=csv" -H "Authorization: Bearer $TOKEN"
```

```
response_id,uid,vendor,country,language,device,status,outcome_reason,survey_version,test,started_at,completed_at,mode,interviewer,loi_seconds,quality_score,quality_flags,review,AGE,GENDER,AWARE_1,AWARE_2,…
f2855b1b-…,R1001,SE,US,en,desktop,complete,,1,0,2026-11-05T08:00:04.730Z,2026-11-05T08:00:15.038Z,cawi,,10,100,,none,34,2,1,1,…
```

```bash
# large: background job, then poll and download
curl -s -X POST http://localhost:4000/api/surveys/$SURVEY/jobs/export -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"format":"xlsx"}'
# → {"id":"cmw399ysb…","type":"export","status":"QUEUED","progress":0,"progressNote":"Waiting for a worker",…}
curl -s http://localhost:4000/api/jobs/$JOB -H "Authorization: Bearer $TOKEN"
# → {"status":"SUCCEEDED","progress":100,"result":{"name":"Demo_screener.xlsx","rows":2,"fileId":"cmw399yuw…","expiresAt":"…"},…}
curl -s -o export.xlsx http://localhost:4000/api/files/$FILE_ID -H "Authorization: Bearer $TOKEN"
```

Query options for direct export: `format=csv|xlsx`, `includeTest=true`, `status=COMPLETE,TERMINATE`.
Job body: `format`, `includeTest`, `statuses[]`.

### Use an API key (scripts and integrations)

Create it in Settings → API keys or `POST /api/api-keys` (signed in; the full key is shown once). Then:

```bash
curl -s http://localhost:4000/api/projects -H "Authorization: Bearer zapx_<prefix>_<secret>"
```

A key acts as the member who created it, never above programmer, and cannot manage keys, change
appearance or sign out everywhere. Guide: [docs/modules/access-and-api-keys.md](../modules/access-and-api-keys.md).

### Vendor API (partners reconcile outcomes)

Authenticated by HMAC, not by a session. Signing string: `<unix seconds>.<METHOD>.<path with query>`,
key = the vendor's `secret`, window ±300 s (`packages/redirect-core/src/signing.ts`).

```js
import { createHmac } from 'node:crypto';
const path = '/api/v1/vendor/outcomes?limit=2';
const ts = Math.floor(Date.now() / 1000);
const sig = createHmac('sha256', VENDOR_SECRET).update(`${ts}.GET.${path}`).digest('hex');
const res = await fetch(`https://<api-host>${path}`, {
  headers: { 'x-zapx-vendor': VENDOR_ID, 'x-zapx-timestamp': String(ts), 'x-zapx-signature': sig },
});
```

```json
{ "items": [
    { "responseId": "f2855b1b-…", "surveyId": "cmw39969y…", "uid": "R1001", "status": "complete", "country": "US",
      "startedAt": "2026-11-05T08:00:04.730Z", "completedAt": "2026-11-05T08:00:15.038Z" },
    { "responseId": "a1666c30-…", "surveyId": "cmw39969y…", "uid": "R1002", "status": "terminate", "country": null, … } ],
  "next": "2026-11-05T08:00:15.183Z" }
```

A wrong signature answers `401 {"message":"Invalid vendor credentials"}` and is audited as
`vendor_api.denied`. Page with `?since=<next>`; filter with `surveyId`; one respondent:
`GET /api/v1/vendor/outcomes/:uid`.

### Webhooks (ZAPX calls you)

Events: `response.finished`, `response.review_decided`, `survey.published`, `survey.status_changed`,
`quota.full` _(PR #34)_, `automation.fired` _(PR #34)_, plus `webhook.test`. Each POST carries
`X-Zapx-Event`, `X-Zapx-Delivery` and `X-Zapx-Signature: t=<unix>,v1=<hex>`. Verification code:
[docs/modules/webhooks.md](../modules/webhooks.md) (that page predates the two PR #34 events).

## 3. Endpoint reference

How to read the tables: **Who can call it** comes from the `@Public()` / `@Roles()` decorators.
"Signed-in (any role except INTERVIEWER)" means no `@Roles` is set, so admins, programmers and
viewers (and API keys) may call it, subject to project access. Some handlers also check the role
inside the method; those are noted. "Public" routes that still verify something themselves: the
vendor API (HMAC), SCIM (`ScimGuard` bearer token), Twilio webhooks (`x-twilio-signature`), Stripe
webhook (`stripe-signature`), SSO callbacks (signed state cookie), respondent routes (session token).

The request body for each route is the Zod schema near the top of the handler's file; click the
handler link to see it. Response bodies are the Prisma rows or objects the handler returns.

Admin checks inside the method: `GET/PUT /api/organization/ai` and `GET /api/organization/ai/usage` (admins only), `PUT /api/organization/redirect-defaults` (admins only),
API keys (non-admins see and revoke only their own keys).

### Health

Backend: `apps/api/src/health.controller.ts` · Frontend: —

| Method | Endpoint      | Who can call it | Handler (file:line)                                                      |
| ------ | ------------- | --------------- | ------------------------------------------------------------------------ |
| GET    | `/api/health` | Public          | [`HealthController.health`](../../apps/api/src/health.controller.ts#L11) |

### Authentication, sessions and single sign-on

Backend: `apps/api/src/auth` · Frontend: `apps/studio/app/login/page.tsx`, `apps/studio/lib/useMe.ts`, `apps/studio/components/Shell.tsx`, `apps/studio/components/Identity.tsx` (SSO settings), `apps/capi/src/api.ts` (interviewer sign-in)

| Method | Endpoint                      | Who can call it                                                       | Handler (file:line)                                                                 |
| ------ | ----------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| POST   | `/api/auth/login`             | Public · rate limit () => config().LOGIN_RATE_PER_MINUTE/min          | [`AuthController.login`](../../apps/api/src/auth/auth.controller.ts#L69)            |
| POST   | `/api/auth/register`          | Public · rate limit () => config().SIGNUP_RATE_PER_MINUTE/min         | [`AuthController.register`](../../apps/api/src/auth/auth.controller.ts#L106)        |
| POST   | `/api/auth/logout`            | Public                                                                | [`AuthController.logout`](../../apps/api/src/auth/auth.controller.ts#L147)          |
| POST   | `/api/auth/logout-all`        | Any role incl. INTERVIEWER                                            | [`AuthController.logoutAll`](../../apps/api/src/auth/auth.controller.ts#L166)       |
| POST   | `/api/auth/change-password`   | Any role incl. INTERVIEWER (session, not API key) · rate limit 10/min | [`AuthController.changePassword`](../../apps/api/src/auth/auth.controller.ts#L181)  |
| POST   | `/api/auth/forgot-password`   | Public · rate limit 5/min                                             | [`AuthController.forgot`](../../apps/api/src/auth/auth.controller.ts#L213)          |
| GET    | `/api/auth/password-options`  | Public                                                                | [`AuthController.passwordOptions`](../../apps/api/src/auth/auth.controller.ts#L227) |
| POST   | `/api/auth/reset-password`    | Public · rate limit 10/min                                            | [`AuthController.reset`](../../apps/api/src/auth/auth.controller.ts#L236)           |
| GET    | `/api/auth/me`                | Any role incl. INTERVIEWER                                            | [`AuthController.me`](../../apps/api/src/auth/auth.controller.ts#L244)              |
| POST   | `/api/auth/sso/start`         | Public · rate limit 20/min                                            | [`SsoController.start`](../../apps/api/src/auth/sso.controller.ts#L49)              |
| GET    | `/api/auth/sso/saml/metadata` | Public                                                                | [`SsoController.metadata`](../../apps/api/src/auth/sso.controller.ts#L67)           |
| POST   | `/api/auth/sso/saml/acs`      | Public · rate limit 30/min                                            | [`SsoController.acs`](../../apps/api/src/auth/sso.controller.ts#L75)                |
| GET    | `/api/auth/sso/callback`      | Public · rate limit 30/min                                            | [`SsoController.callback`](../../apps/api/src/auth/sso.controller.ts#L92)           |
| GET    | `/api/sso`                    | ADMIN                                                                 | [`SsoController.get`](../../apps/api/src/auth/sso.controller.ts#L108)               |
| PUT    | `/api/sso`                    | ADMIN                                                                 | [`SsoController.save`](../../apps/api/src/auth/sso.controller.ts#L114)              |

### Team members and personal preferences

Backend: `apps/api/src/users` · Frontend: `apps/studio/components/Team.tsx`, `apps/studio/app/appearance/page.tsx`, `apps/studio/lib/theme/ThemeProvider.tsx`

| Method | Endpoint                              | Who can call it            | Handler (file:line)                                                                             |
| ------ | ------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/api/me/preferences`                 | Any role incl. INTERVIEWER | [`PreferencesController.get`](../../apps/api/src/users/preferences.controller.ts#L50)           |
| PUT    | `/api/me/preferences`                 | Any role incl. INTERVIEWER | [`PreferencesController.put`](../../apps/api/src/users/preferences.controller.ts#L60)           |
| DELETE | `/api/me/preferences/appearance`      | Any role incl. INTERVIEWER | [`PreferencesController.reset`](../../apps/api/src/users/preferences.controller.ts#L72)         |
| PUT    | `/api/tenant/appearance`              | ADMIN                      | [`PreferencesController.putDefault`](../../apps/api/src/users/preferences.controller.ts#L82)    |
| DELETE | `/api/tenant/appearance`              | ADMIN                      | [`PreferencesController.clearDefault`](../../apps/api/src/users/preferences.controller.ts#L98)  |
| GET    | `/api/tenant/appearance-presets`      | Any role incl. INTERVIEWER | [`PreferencesController.list`](../../apps/api/src/users/preferences.controller.ts#L117)         |
| POST   | `/api/tenant/appearance-presets`      | ADMIN                      | [`PreferencesController.addPreset`](../../apps/api/src/users/preferences.controller.ts#L123)    |
| DELETE | `/api/tenant/appearance-presets/{id}` | ADMIN                      | [`PreferencesController.deletePreset`](../../apps/api/src/users/preferences.controller.ts#L142) |
| GET    | `/api/users`                          | ADMIN                      | [`UsersController.list`](../../apps/api/src/users/users.controller.ts#L92)                      |
| POST   | `/api/users`                          | ADMIN                      | [`UsersController.create`](../../apps/api/src/users/users.controller.ts#L101)                   |
| PATCH  | `/api/users/{id}`                     | ADMIN                      | [`UsersController.update`](../../apps/api/src/users/users.controller.ts#L127)                   |
| POST   | `/api/users/{id}/password-reset`      | ADMIN                      | [`UsersController.resetLink`](../../apps/api/src/users/users.controller.ts#L80)                 |

### Projects and project access

Backend: `apps/api/src/projects` · Frontend: `apps/studio/app/projects/page.tsx`, `apps/studio/app/projects/[id]/page.tsx`, `apps/studio/components/neon/ProjectsSection.tsx`, `apps/studio/components/ProjectAccess.tsx`

| Method | Endpoint                              | Who can call it                         | Handler (file:line)                                                                        |
| ------ | ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/projects/{id}/members`          | Signed-in (any role except INTERVIEWER) | [`ProjectMembersController.list`](../../apps/api/src/projects/members.controller.ts#L31)   |
| POST   | `/api/projects/{id}/members`          | ADMIN                                   | [`ProjectMembersController.add`](../../apps/api/src/projects/members.controller.ts#L47)    |
| DELETE | `/api/projects/{id}/members/{userId}` | ADMIN                                   | [`ProjectMembersController.remove`](../../apps/api/src/projects/members.controller.ts#L67) |
| GET    | `/api/projects`                       | Signed-in (any role except INTERVIEWER) | [`ProjectsController.list`](../../apps/api/src/projects/projects.controller.ts#L21)        |
| POST   | `/api/projects`                       | ADMIN, PROGRAMMER                       | [`ProjectsController.create`](../../apps/api/src/projects/projects.controller.ts#L31)      |
| GET    | `/api/projects/{id}`                  | Signed-in (any role except INTERVIEWER) | [`ProjectsController.get`](../../apps/api/src/projects/projects.controller.ts#L46)         |
| DELETE | `/api/projects/{id}`                  | ADMIN                                   | [`ProjectsController.remove`](../../apps/api/src/projects/projects.controller.ts#L69)      |
| GET    | `/api/projects/{id}/audit`            | Signed-in (any role except INTERVIEWER) | [`ProjectsController.audit_`](../../apps/api/src/projects/projects.controller.ts#L87)      |

### Surveys, drafts, publishing, links, export, translation

Backend: `apps/api/src/surveys` · Frontend: `apps/studio/app/surveys/[id]/page.tsx`, `apps/studio/components/VisualEditor.tsx`, `apps/studio/components/Languages.tsx`, `apps/studio/components/Glossary.tsx`

| Method | Endpoint                               | Who can call it                         | Handler (file:line)                                                                                        |
| ------ | -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/projects/{projectId}/surveys`    | Signed-in (any role except INTERVIEWER) | [`SurveysController.list`](../../apps/api/src/surveys/surveys.controller.ts#L68)                           |
| POST   | `/api/projects/{projectId}/surveys`    | ADMIN, PROGRAMMER                       | [`SurveysController.create`](../../apps/api/src/surveys/surveys.controller.ts#L74)                         |
| GET    | `/api/surveys/{id}`                    | Signed-in (any role except INTERVIEWER) | [`SurveysController.detail`](../../apps/api/src/surveys/surveys.controller.ts#L80)                         |
| GET    | `/api/surveys/{id}/draft`              | Signed-in (any role except INTERVIEWER) | [`SurveysController.draft`](../../apps/api/src/surveys/surveys.controller.ts#L85)                          |
| PUT    | `/api/surveys/{id}/draft`              | ADMIN, PROGRAMMER                       | [`SurveysController.saveDraft`](../../apps/api/src/surveys/surveys.controller.ts#L97)                      |
| PUT    | `/api/surveys/{id}/draft/presentation` | ADMIN, PROGRAMMER                       | [`SurveysController.savePresentation`](../../apps/api/src/surveys/surveys.controller.ts#L104)              |
| POST   | `/api/surveys/{id}/check`              | Signed-in (any role except INTERVIEWER) | [`SurveysController.check`](../../apps/api/src/surveys/surveys.controller.ts#L111)                         |
| POST   | `/api/surveys/{id}/publish`            | ADMIN, PROGRAMMER                       | [`SurveysController.publish`](../../apps/api/src/surveys/surveys.controller.ts#L119)                       |
| POST   | `/api/surveys/{id}/status`             | ADMIN, PROGRAMMER                       | [`SurveysController.status`](../../apps/api/src/surveys/surveys.controller.ts#L125)                        |
| DELETE | `/api/surveys/{id}`                    | ADMIN, PROGRAMMER                       | [`SurveysController.remove`](../../apps/api/src/surveys/surveys.controller.ts#L133)                        |
| GET    | `/api/surveys/{id}/versions`           | Signed-in (any role except INTERVIEWER) | [`SurveysController.versions`](../../apps/api/src/surveys/surveys.controller.ts#L141)                      |
| GET    | `/api/surveys/{id}/versions/{version}` | Signed-in (any role except INTERVIEWER) | [`SurveysController.version`](../../apps/api/src/surveys/surveys.controller.ts#L146)                       |
| GET    | `/api/surveys/{id}/quotas`             | Signed-in (any role except INTERVIEWER) | [`SurveysController.quotas`](../../apps/api/src/surveys/surveys.controller.ts#L151)                        |
| PUT    | `/api/surveys/{id}/quotas/{quotaId}`   | ADMIN, PROGRAMMER                       | [`SurveysController.setQuotaTarget`](../../apps/api/src/surveys/surveys.controller.ts#L158)                |
| GET    | `/api/surveys/{id}/responses`          | Signed-in (any role except INTERVIEWER) | [`SurveysController.responses`](../../apps/api/src/surveys/surveys.controller.ts#L164)                     |
| POST   | `/api/surveys/{id}/links`              | ADMIN, PROGRAMMER                       | [`SurveysController.link`](../../apps/api/src/surveys/surveys.controller.ts#L179)                          |
| GET    | `/api/surveys/{id}/export`             | Signed-in (any role except INTERVIEWER) | [`SurveysController.export`](../../apps/api/src/surveys/surveys.controller.ts#L222)                        |
| POST   | `/api/surveys/{id}/translate`          | ADMIN, PROGRAMMER · rate limit 10/min   | [`TranslateController.translate`](../../apps/api/src/surveys/translate.controller.ts#L43)                  |
| GET    | `/api/glossary`                        | Signed-in (any role except INTERVIEWER) | [`TranslationToolsController.glossary`](../../apps/api/src/surveys/translation-tools.controller.ts#L37)    |
| POST   | `/api/glossary`                        | ADMIN, PROGRAMMER                       | [`TranslationToolsController.addTerm`](../../apps/api/src/surveys/translation-tools.controller.ts#L47)     |
| DELETE | `/api/glossary/{id}`                   | ADMIN, PROGRAMMER                       | [`TranslationToolsController.removeTerm`](../../apps/api/src/surveys/translation-tools.controller.ts#L61)  |
| GET    | `/api/surveys/{id}/translation-qa`     | Signed-in (any role except INTERVIEWER) | [`TranslationToolsController.qa`](../../apps/api/src/surveys/translation-tools.controller.ts#L70)          |
| POST   | `/api/surveys/{id}/translation-memory` | ADMIN, PROGRAMMER                       | [`TranslationToolsController.applyMemory`](../../apps/api/src/surveys/translation-tools.controller.ts#L89) |

### Vendors (sample sources)

Backend: `apps/api/src/vendors` · Frontend: `apps/studio/components/VendorEditor.tsx`, `apps/studio/app/projects/[id]/page.tsx`

| Method | Endpoint                             | Who can call it                         | Handler (file:line)                                                                  |
| ------ | ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/vendor-presets`                | Signed-in (any role except INTERVIEWER) | [`VendorsController.presets`](../../apps/api/src/vendors/vendors.controller.ts#L123) |
| GET    | `/api/projects/{projectId}/vendors`  | Signed-in (any role except INTERVIEWER) | [`VendorsController.list`](../../apps/api/src/vendors/vendors.controller.ts#L128)    |
| POST   | `/api/projects/{projectId}/vendors`  | ADMIN, PROGRAMMER                       | [`VendorsController.create`](../../apps/api/src/vendors/vendors.controller.ts#L138)  |
| GET    | `/api/vendors/{id}`                  | Signed-in (any role except INTERVIEWER) | [`VendorsController.get`](../../apps/api/src/vendors/vendors.controller.ts#L158)     |
| PUT    | `/api/vendors/{id}`                  | ADMIN, PROGRAMMER                       | [`VendorsController.update`](../../apps/api/src/vendors/vendors.controller.ts#L164)  |
| DELETE | `/api/vendors/{id}`                  | ADMIN, PROGRAMMER                       | [`VendorsController.remove`](../../apps/api/src/vendors/vendors.controller.ts#L183)  |
| POST   | `/api/vendors/{id}/rotate-secret`    | ADMIN, PROGRAMMER                       | [`VendorsController.rotate`](../../apps/api/src/vendors/vendors.controller.ts#L191)  |
| POST   | `/api/vendors/{id}/redirect-preview` | Signed-in (any role except INTERVIEWER) | [`VendorsController.preview`](../../apps/api/src/vendors/vendors.controller.ts#L200) |

### Respondent interview (public)

Backend: `apps/api/src/interview` · Frontend: `apps/runtime/src/App.tsx`, `packages/survey-renderer/src/index.tsx`

| Method | Endpoint                         | Who can call it            | Handler (file:line)                                                                        |
| ------ | -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| POST   | `/api/public/s/{surveyId}/start` | Public · rate limit 30/min | [`InterviewController.start`](../../apps/api/src/interview/interview.controller.ts#L42)    |
| POST   | `/api/public/r/{token}/language` | Public                     | [`InterviewController.language`](../../apps/api/src/interview/interview.controller.ts#L66) |
| GET    | `/api/public/r/{token}`          | Public                     | [`InterviewController.state`](../../apps/api/src/interview/interview.controller.ts#L71)    |
| POST   | `/api/public/r/{token}/answers`  | Public                     | [`InterviewController.submit`](../../apps/api/src/interview/interview.controller.ts#L77)   |
| POST   | `/api/public/r/{token}/back`     | Public                     | [`InterviewController.back`](../../apps/api/src/interview/interview.controller.ts#L84)     |

### Redirect logs, callbacks, redirect defaults, vendor API, webhooks

Backend: `apps/api/src/integrations` · Frontend: `apps/studio/components/VendorEditor.tsx`, `apps/studio/components/RedirectRules.tsx`, `apps/studio/components/Webhooks.tsx`, `apps/studio/app/settings/page.tsx`

| Method | Endpoint                                 | Who can call it                         | Handler (file:line)                                                                                            |
| ------ | ---------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/vendors/{id}/callbacks`            | Signed-in (any role except INTERVIEWER) | [`IntegrationsController.callbacks`](../../apps/api/src/integrations/integrations.controller.ts#L31)           |
| POST   | `/api/callbacks/{id}/replay`             | ADMIN, PROGRAMMER                       | [`IntegrationsController.replay`](../../apps/api/src/integrations/integrations.controller.ts#L39)              |
| GET    | `/api/vendors/{id}/redirect-events`      | Signed-in (any role except INTERVIEWER) | [`IntegrationsController.events`](../../apps/api/src/integrations/integrations.controller.ts#L54)              |
| GET    | `/api/projects/{id}/redirect-defaults`   | Signed-in (any role except INTERVIEWER) | [`IntegrationsController.projectDefaults`](../../apps/api/src/integrations/integrations.controller.ts#L62)     |
| PUT    | `/api/projects/{id}/redirect-defaults`   | ADMIN, PROGRAMMER                       | [`IntegrationsController.saveProjectDefaults`](../../apps/api/src/integrations/integrations.controller.ts#L70) |
| GET    | `/api/organization/redirect-defaults`    | Signed-in (any role except INTERVIEWER) | [`IntegrationsController.orgDefaults`](../../apps/api/src/integrations/integrations.controller.ts#L80)         |
| PUT    | `/api/organization/redirect-defaults`    | Signed-in (any role except INTERVIEWER) | [`IntegrationsController.saveOrgDefaults`](../../apps/api/src/integrations/integrations.controller.ts#L86)     |
| GET    | `/api/v1/vendor/outcomes`                | Public                                  | [`VendorApiController.outcomes`](../../apps/api/src/integrations/vendor-api.controller.ts#L62)                 |
| GET    | `/api/v1/vendor/outcomes/{uid}`          | Public                                  | [`VendorApiController.outcome`](../../apps/api/src/integrations/vendor-api.controller.ts#L80)                  |
| GET    | `/api/webhook-events`                    | ADMIN                                   | [`WebhooksController.events`](../../apps/api/src/integrations/webhooks.controller.ts#L55)                      |
| GET    | `/api/webhooks`                          | ADMIN                                   | [`WebhooksController.list`](../../apps/api/src/integrations/webhooks.controller.ts#L60)                        |
| POST   | `/api/webhooks`                          | ADMIN                                   | [`WebhooksController.create`](../../apps/api/src/integrations/webhooks.controller.ts#L72)                      |
| PATCH  | `/api/webhooks/{id}`                     | ADMIN                                   | [`WebhooksController.update`](../../apps/api/src/integrations/webhooks.controller.ts#L92)                      |
| POST   | `/api/webhooks/{id}/rotate-secret`       | ADMIN                                   | [`WebhooksController.rotate`](../../apps/api/src/integrations/webhooks.controller.ts#L104)                     |
| DELETE | `/api/webhooks/{id}`                     | ADMIN                                   | [`WebhooksController.remove`](../../apps/api/src/integrations/webhooks.controller.ts#L114)                     |
| POST   | `/api/webhooks/{id}/test`                | ADMIN                                   | [`WebhooksController.test`](../../apps/api/src/integrations/webhooks.controller.ts#L121)                       |
| GET    | `/api/webhooks/{id}/deliveries`          | ADMIN                                   | [`WebhooksController.deliveries`](../../apps/api/src/integrations/webhooks.controller.ts#L129)                 |
| POST   | `/api/webhook-deliveries/{id}/redeliver` | ADMIN                                   | [`WebhooksController.redeliver`](../../apps/api/src/integrations/webhooks.controller.ts#L150)                  |

### AI architect, file import and change sets

Backend: `apps/api/src/changesets` · Frontend: `apps/studio/components/Assist.tsx`

| Method | Endpoint                       | Who can call it                         | Handler (file:line)                                                                           |
| ------ | ------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/api/ai/status`               | Signed-in (any role except INTERVIEWER) | [`ChangeSetsController.aiStatus`](../../apps/api/src/changesets/changesets.controller.ts#L52) |
| GET    | `/api/imports/template.xlsx`   | Signed-in (any role except INTERVIEWER) | [`ChangeSetsController.template`](../../apps/api/src/changesets/changesets.controller.ts#L57) |
| POST   | `/api/surveys/{id}/ai/propose` | ADMIN, PROGRAMMER · rate limit 20/min   | [`ChangeSetsController.propose`](../../apps/api/src/changesets/changesets.controller.ts#L71)  |
| POST   | `/api/surveys/{id}/import`     | ADMIN, PROGRAMMER · rate limit 30/min   | [`ChangeSetsController.import`](../../apps/api/src/changesets/changesets.controller.ts#L92)   |
| POST   | `/api/surveys/{id}/changesets` | ADMIN, PROGRAMMER                       | [`ChangeSetsController.manual`](../../apps/api/src/changesets/changesets.controller.ts#L131)  |
| GET    | `/api/surveys/{id}/changesets` | Signed-in (any role except INTERVIEWER) | [`ChangeSetsController.list`](../../apps/api/src/changesets/changesets.controller.ts#L139)    |
| GET    | `/api/changesets/{id}`         | Signed-in (any role except INTERVIEWER) | [`ChangeSetsController.get`](../../apps/api/src/changesets/changesets.controller.ts#L144)     |
| POST   | `/api/changesets/{id}/apply`   | ADMIN, PROGRAMMER                       | [`ChangeSetsController.apply`](../../apps/api/src/changesets/changesets.controller.ts#L150)   |
| POST   | `/api/changesets/{id}/reject`  | ADMIN, PROGRAMMER                       | [`ChangeSetsController.reject`](../../apps/api/src/changesets/changesets.controller.ts#L156)  |

### Organization AI settings and usage

Backend: `apps/api/src/ai` · Frontend: `apps/studio/app/settings/page.tsx`

| Method | Endpoint                     | Who can call it                         | Handler (file:line)                                                                        |
| ------ | ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/organization/ai`       | Signed-in (any role except INTERVIEWER) | [`AiSettingsController.get`](../../apps/api/src/ai/ai-settings.controller.ts#L36)          |
| PUT    | `/api/organization/ai`       | Signed-in (any role except INTERVIEWER) | [`AiSettingsController.save`](../../apps/api/src/ai/ai-settings.controller.ts#L47)         |
| GET    | `/api/organization/ai/usage` | Signed-in (any role except INTERVIEWER) | [`AiSettingsController.usageSummary`](../../apps/api/src/ai/ai-settings.controller.ts#L66) |

### QA laboratory and saved test cases

Backend: `apps/api/src/qa` · Frontend: `apps/studio/components/QaLab.tsx`, `apps/studio/components/TestCases.tsx`

| Method | Endpoint                                | Who can call it                         | Handler (file:line)                                                                |
| ------ | --------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| POST   | `/api/surveys/{id}/qa/run`              | ADMIN, PROGRAMMER · rate limit 30/min   | [`QaController.run`](../../apps/api/src/qa/qa.controller.ts#L39)                   |
| GET    | `/api/surveys/{id}/qa/runs`             | Signed-in (any role except INTERVIEWER) | [`QaController.list`](../../apps/api/src/qa/qa.controller.ts#L44)                  |
| GET    | `/api/qa/runs/{runId}`                  | Signed-in (any role except INTERVIEWER) | [`QaController.get`](../../apps/api/src/qa/qa.controller.ts#L55)                   |
| GET    | `/api/surveys/{id}/test-cases`          | Signed-in (any role except INTERVIEWER) | [`TestCasesController.list`](../../apps/api/src/qa/test-cases.controller.ts#L28)   |
| POST   | `/api/surveys/{id}/test-cases`          | ADMIN, PROGRAMMER                       | [`TestCasesController.create`](../../apps/api/src/qa/test-cases.controller.ts#L36) |
| PUT    | `/api/surveys/{id}/test-cases/{caseId}` | ADMIN, PROGRAMMER                       | [`TestCasesController.update`](../../apps/api/src/qa/test-cases.controller.ts#L50) |
| DELETE | `/api/surveys/{id}/test-cases/{caseId}` | ADMIN, PROGRAMMER                       | [`TestCasesController.remove`](../../apps/api/src/qa/test-cases.controller.ts#L61) |
| POST   | `/api/surveys/{id}/test-cases/run`      | ADMIN, PROGRAMMER                       | [`TestCasesController.run`](../../apps/api/src/qa/test-cases.controller.ts#L70)    |

### Data quality review, fieldwork and fraud blocks

Backend: `apps/api/src/quality` · Frontend: `apps/studio/components/Quality.tsx`

| Method | Endpoint                              | Who can call it                         | Handler (file:line)                                                                    |
| ------ | ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/api/surveys/{id}/quality`           | Signed-in (any role except INTERVIEWER) | [`QualityController.queue`](../../apps/api/src/quality/quality.controller.ts#L24)      |
| POST   | `/api/surveys/{id}/quality/decisions` | ADMIN, PROGRAMMER                       | [`QualityController.decide`](../../apps/api/src/quality/quality.controller.ts#L33)     |
| GET    | `/api/surveys/{id}/fieldwork`         | Signed-in (any role except INTERVIEWER) | [`QualityController.fieldwork`](../../apps/api/src/quality/quality.controller.ts#L39)  |
| GET    | `/api/quality/blocks`                 | ADMIN                                   | [`FraudBlocksController.list`](../../apps/api/src/quality/quality.controller.ts#L51)   |
| DELETE | `/api/quality/blocks/{blockId}`       | ADMIN                                   | [`FraudBlocksController.remove`](../../apps/api/src/quality/quality.controller.ts#L57) |

### Photos and recordings (captures) and transcripts

Backend: `apps/api/src/captures` · Frontend: `apps/studio/components/Quality.tsx`, `apps/runtime/src/App.tsx`, `apps/capi/src/api.ts`

| Method | Endpoint                                | Who can call it                         | Handler (file:line)                                                                          |
| ------ | --------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/api/public/r/{token}/captures`        | Public · rate limit 20/min              | [`CaptureController.respondentPhoto`](../../apps/api/src/captures/capture.controller.ts#L61) |
| POST   | `/api/capi/captures`                    | INTERVIEWER · rate limit 120/min        | [`CaptureController.device`](../../apps/api/src/captures/capture.controller.ts#L73)          |
| GET    | `/api/captures/{id}`                    | Signed-in (any role except INTERVIEWER) | [`CaptureController.open`](../../apps/api/src/captures/capture.controller.ts#L81)            |
| GET    | `/api/surveys/{id}/captures`            | Signed-in (any role except INTERVIEWER) | [`CaptureController.summary`](../../apps/api/src/captures/capture.controller.ts#L92)         |
| POST   | `/api/surveys/{id}/captures/transcribe` | ADMIN, PROGRAMMER                       | [`CaptureController.transcribe`](../../apps/api/src/captures/capture.controller.ts#L103)     |
| POST   | `/api/surveys/{id}/captures/erase`      | ADMIN                                   | [`CaptureController.erase`](../../apps/api/src/captures/capture.controller.ts#L114)          |

### CAPI interviewer assignments and the offline app API

Backend: `apps/api/src/capi` · Frontend: `apps/studio/components/CapiAssignments.tsx`, `apps/capi/src/api.ts`

| Method | Endpoint                                            | Who can call it                         | Handler (file:line)                                                                    |
| ------ | --------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/api/surveys/{id}/capi/assignments`                | Signed-in (any role except INTERVIEWER) | [`CapiAssignmentsController.list`](../../apps/api/src/capi/capi.controller.ts#L84)     |
| POST   | `/api/surveys/{id}/capi/assignments`                | ADMIN, PROGRAMMER                       | [`CapiAssignmentsController.assign`](../../apps/api/src/capi/capi.controller.ts#L90)   |
| DELETE | `/api/surveys/{id}/capi/assignments/{assignmentId}` | ADMIN, PROGRAMMER                       | [`CapiAssignmentsController.unassign`](../../apps/api/src/capi/capi.controller.ts#L98) |
| GET    | `/api/capi/package`                                 | INTERVIEWER                             | [`CapiAppController.package`](../../apps/api/src/capi/capi.controller.ts#L110)         |
| POST   | `/api/capi/sync`                                    | INTERVIEWER · rate limit 60/min         | [`CapiAppController.sync`](../../apps/api/src/capi/capi.controller.ts#L117)            |

### Supervisor dashboard, back-checks and appeals

Backend: `apps/api/src/fieldwork` · Frontend: `apps/studio/components/Supervisor.tsx`, `apps/capi/src/App.tsx`

| Method | Endpoint                                 | Who can call it                         | Handler (file:line)                                                                          |
| ------ | ---------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/api/surveys/{id}/supervisor`           | Signed-in (any role except INTERVIEWER) | [`FieldworkController.supervisor`](../../apps/api/src/fieldwork/fieldwork.controller.ts#L30) |
| GET    | `/api/surveys/{id}/backchecks`           | Signed-in (any role except INTERVIEWER) | [`FieldworkController.backChecks`](../../apps/api/src/fieldwork/fieldwork.controller.ts#L35) |
| POST   | `/api/surveys/{id}/backchecks/sample`    | ADMIN, PROGRAMMER                       | [`FieldworkController.sample`](../../apps/api/src/fieldwork/fieldwork.controller.ts#L41)     |
| PUT    | `/api/surveys/{id}/backchecks/{checkId}` | ADMIN, PROGRAMMER                       | [`FieldworkController.record`](../../apps/api/src/fieldwork/fieldwork.controller.ts#L47)     |
| GET    | `/api/surveys/{id}/appeals`              | Signed-in (any role except INTERVIEWER) | [`FieldworkController.appeals`](../../apps/api/src/fieldwork/fieldwork.controller.ts#L52)    |
| PUT    | `/api/surveys/{id}/appeals/{appealId}`   | ADMIN, PROGRAMMER                       | [`FieldworkController.decide`](../../apps/api/src/fieldwork/fieldwork.controller.ts#L58)     |
| GET    | `/api/capi/interviews`                   | INTERVIEWER                             | [`CapiAppealsController.mine`](../../apps/api/src/fieldwork/fieldwork.controller.ts#L71)     |
| POST   | `/api/capi/appeals`                      | INTERVIEWER                             | [`CapiAppealsController.appeal`](../../apps/api/src/fieldwork/fieldwork.controller.ts#L76)   |

### CATI phone interviewing, calling rules and dialer

Backend: `apps/api/src/cati` · Frontend: `apps/studio/app/calls/page.tsx`, `apps/studio/components/CatiCalls.tsx`

| Method | Endpoint                              | Who can call it                | Handler (file:line)                                                                     |
| ------ | ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| POST   | `/api/surveys/{id}/cati/cases`        | ADMIN, PROGRAMMER              | [`CatiController.add`](../../apps/api/src/cati/cati.controller.ts#L112)                 |
| POST   | `/api/surveys/{id}/cati/cases/upload` | ADMIN, PROGRAMMER              | [`CatiController.upload`](../../apps/api/src/cati/cati.controller.ts#L120)              |
| GET    | `/api/surveys/{id}/cati/summary`      | ADMIN, PROGRAMMER, VIEWER      | [`CatiController.summary`](../../apps/api/src/cati/cati.controller.ts#L133)             |
| GET    | `/api/surveys/{id}/cati/cases`        | ADMIN, PROGRAMMER, VIEWER      | [`CatiController.list`](../../apps/api/src/cati/cati.controller.ts#L139)                |
| POST   | `/api/cati/cases/{id}/reopen`         | ADMIN, PROGRAMMER              | [`CatiController.reopen`](../../apps/api/src/cati/cati.controller.ts#L146)              |
| POST   | `/api/surveys/{id}/cati/erase-phones` | ADMIN                          | [`CatiController.erase`](../../apps/api/src/cati/cati.controller.ts#L153)               |
| GET    | `/api/surveys/{id}/cati/hours`        | ADMIN, PROGRAMMER, VIEWER      | [`CatiController.hours`](../../apps/api/src/cati/cati.controller.ts#L161)               |
| PUT    | `/api/surveys/{id}/cati/hours`        | ADMIN, PROGRAMMER              | [`CatiController.setHours`](../../apps/api/src/cati/cati.controller.ts#L167)            |
| GET    | `/api/cati/do-not-call`               | ADMIN, PROGRAMMER              | [`CatiController.dnc`](../../apps/api/src/cati/cati.controller.ts#L174)                 |
| POST   | `/api/cati/do-not-call`               | ADMIN, PROGRAMMER              | [`CatiController.addDnc`](../../apps/api/src/cati/cati.controller.ts#L181)              |
| POST   | `/api/cati/do-not-call/upload`        | ADMIN, PROGRAMMER              | [`CatiController.uploadDnc`](../../apps/api/src/cati/cati.controller.ts#L190)           |
| DELETE | `/api/cati/do-not-call/{id}`          | ADMIN                          | [`CatiController.removeDnc`](../../apps/api/src/cati/cati.controller.ts#L199)           |
| GET    | `/api/cati/dispositions`              | ADMIN, PROGRAMMER, INTERVIEWER | [`CatiController.dispositions`](../../apps/api/src/cati/cati.controller.ts#L207)        |
| GET    | `/api/cati/surveys`                   | ADMIN, PROGRAMMER, INTERVIEWER | [`CatiController.surveys`](../../apps/api/src/cati/cati.controller.ts#L213)             |
| POST   | `/api/cati/surveys/{id}/next`         | ADMIN, PROGRAMMER, INTERVIEWER | [`CatiController.next`](../../apps/api/src/cati/cati.controller.ts#L220)                |
| POST   | `/api/cati/cases/{id}/interview`      | ADMIN, PROGRAMMER, INTERVIEWER | [`CatiController.interview`](../../apps/api/src/cati/cati.controller.ts#L227)           |
| POST   | `/api/cati/cases/{id}/disposition`    | ADMIN, PROGRAMMER, INTERVIEWER | [`CatiController.dispose`](../../apps/api/src/cati/cati.controller.ts#L234)             |
| POST   | `/api/cati/cases/{id}/release`        | ADMIN, PROGRAMMER, INTERVIEWER | [`CatiController.release`](../../apps/api/src/cati/cati.controller.ts#L245)             |
| GET    | `/api/cati/me`                        | ADMIN, PROGRAMMER, INTERVIEWER | [`TelephonyController.me`](../../apps/api/src/cati/telephony.controller.ts#L25)         |
| PUT    | `/api/cati/me/phone`                  | ADMIN, PROGRAMMER, INTERVIEWER | [`TelephonyController.setPhone`](../../apps/api/src/cati/telephony.controller.ts#L31)   |
| GET    | `/api/surveys/{id}/cati/dialer`       | ADMIN, PROGRAMMER, VIEWER      | [`TelephonyController.dialer`](../../apps/api/src/cati/telephony.controller.ts#L37)     |
| PUT    | `/api/surveys/{id}/cati/dialer`       | ADMIN, PROGRAMMER              | [`TelephonyController.setDialer`](../../apps/api/src/cati/telephony.controller.ts#L43)  |
| POST   | `/api/cati/cases/{id}/dial`           | ADMIN, PROGRAMMER, INTERVIEWER | [`TelephonyController.dial`](../../apps/api/src/cati/telephony.controller.ts#L50)       |
| GET    | `/api/cati/cases/{id}/dial`           | ADMIN, PROGRAMMER, INTERVIEWER | [`TelephonyController.latest`](../../apps/api/src/cati/telephony.controller.ts#L56)     |
| POST   | `/api/cati/dials/{id}/hangup`         | ADMIN, PROGRAMMER, INTERVIEWER | [`TelephonyController.hangUp`](../../apps/api/src/cati/telephony.controller.ts#L63)     |
| POST   | `/api/telephony/twilio/answer`        | Public                         | [`TelephonyController.answer`](../../apps/api/src/cati/telephony.controller.ts#L83)     |
| POST   | `/api/telephony/twilio/notice`        | Public                         | [`TelephonyController.notice`](../../apps/api/src/cati/telephony.controller.ts#L93)     |
| POST   | `/api/telephony/twilio/bridged`       | Public                         | [`TelephonyController.bridged`](../../apps/api/src/cati/telephony.controller.ts#L103)   |
| POST   | `/api/telephony/twilio/status`        | Public                         | [`TelephonyController.status`](../../apps/api/src/cati/telephony.controller.ts#L111)    |
| POST   | `/api/telephony/twilio/recording`     | Public                         | [`TelephonyController.recording`](../../apps/api/src/cati/telephony.controller.ts#L119) |

### Analysis, saved reports, dashboards and research assistant

Backend: `apps/api/src/analysis` · Frontend: `apps/studio/components/Analysis.tsx`, `apps/studio/components/ChoiceResults.tsx`, `apps/studio/components/ResearchAssistant.tsx`

| Method | Endpoint                                                    | Who can call it                               | Handler (file:line)                                                                            |
| ------ | ----------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| POST   | `/api/surveys/{id}/analysis/assistant/tables`               | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.assistantTables`](../../apps/api/src/analysis/analysis.controller.ts#L40) |
| POST   | `/api/surveys/{id}/analysis/assistant`                      | ADMIN, PROGRAMMER, VIEWER · rate limit 10/min | [`AnalysisController.ask`](../../apps/api/src/analysis/analysis.controller.ts#L51)             |
| GET    | `/api/surveys/{id}/analysis/variables`                      | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.variables`](../../apps/api/src/analysis/analysis.controller.ts#L57)       |
| POST   | `/api/surveys/{id}/analysis/frequencies`                    | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.frequencies`](../../apps/api/src/analysis/analysis.controller.ts#L64)     |
| POST   | `/api/surveys/{id}/analysis/dashboard`                      | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.dashboard`](../../apps/api/src/analysis/analysis.controller.ts#L73)       |
| POST   | `/api/surveys/{id}/analysis/crosstab`                       | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.crosstab`](../../apps/api/src/analysis/analysis.controller.ts#L82)        |
| POST   | `/api/surveys/{id}/analysis/choice/{questionId}`            | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.choice`](../../apps/api/src/analysis/analysis.controller.ts#L89)          |
| GET    | `/api/surveys/{id}/analysis/choice/{questionId}/design.csv` | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.design`](../../apps/api/src/analysis/analysis.controller.ts#L96)          |
| POST   | `/api/surveys/{id}/analysis/weights`                        | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.weights`](../../apps/api/src/analysis/analysis.controller.ts#L111)        |
| GET    | `/api/surveys/{id}/reports`                                 | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.list`](../../apps/api/src/analysis/analysis.controller.ts#L118)           |
| POST   | `/api/surveys/{id}/reports`                                 | ADMIN, PROGRAMMER                             | [`AnalysisController.create`](../../apps/api/src/analysis/analysis.controller.ts#L124)         |
| GET    | `/api/reports/{id}`                                         | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.get`](../../apps/api/src/analysis/analysis.controller.ts#L131)            |
| PUT    | `/api/reports/{id}`                                         | ADMIN, PROGRAMMER                             | [`AnalysisController.update`](../../apps/api/src/analysis/analysis.controller.ts#L137)         |
| DELETE | `/api/reports/{id}`                                         | ADMIN, PROGRAMMER                             | [`AnalysisController.remove`](../../apps/api/src/analysis/analysis.controller.ts#L146)         |
| POST   | `/api/reports/{id}/run`                                     | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.run`](../../apps/api/src/analysis/analysis.controller.ts#L153)            |
| GET    | `/api/reports/{id}/export.xlsx`                             | ADMIN, PROGRAMMER, VIEWER                     | [`AnalysisController.export`](../../apps/api/src/analysis/analysis.controller.ts#L160)         |

### Home dashboard and global search

Backend: `apps/api/src/dashboard` · Frontend: `apps/studio/app/page.tsx`, `apps/studio/components/neon/GlobalSearch.tsx`

| Method | Endpoint                | Who can call it           | Handler (file:line)                                                                       |
| ------ | ----------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/api/dashboard`        | ADMIN, PROGRAMMER, VIEWER | [`DashboardController.summary`](../../apps/api/src/dashboard/dashboard.controller.ts#L90) |
| GET    | `/api/dashboard/search` | ADMIN, PROGRAMMER, VIEWER | [`DashboardController.search`](../../apps/api/src/dashboard/dashboard.controller.ts#L201) |

### Survey media (images, video, audio)

Backend: `apps/api/src/media` · Frontend: `apps/studio/components/MediaLibrary.tsx`, `packages/survey-renderer/src/index.tsx`

| Method | Endpoint                  | Who can call it                         | Handler (file:line)                                                          |
| ------ | ------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/surveys/{id}/media` | Signed-in (any role except INTERVIEWER) | [`MediaController.list`](../../apps/api/src/media/media.controller.ts#L30)   |
| POST   | `/api/surveys/{id}/media` | ADMIN, PROGRAMMER                       | [`MediaController.upload`](../../apps/api/src/media/media.controller.ts#L37) |
| DELETE | `/api/media/{id}`         | ADMIN, PROGRAMMER                       | [`MediaController.remove`](../../apps/api/src/media/media.controller.ts#L45) |
| GET    | `/api/public/media/{id}`  | Public                                  | [`MediaController.serve`](../../apps/api/src/media/media.controller.ts#L57)  |

### Background jobs and file downloads

Backend: `apps/api/src/jobs` · Frontend: `apps/studio/components/ExportJobs.tsx`, `apps/studio/components/QaLab.tsx`, `apps/studio/lib/api.ts`

| Method | Endpoint                        | Who can call it                         | Handler (file:line)                                                          |
| ------ | ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| POST   | `/api/surveys/{id}/jobs/export` | Signed-in (any role except INTERVIEWER) | [`JobsController.export`](../../apps/api/src/jobs/jobs.controller.ts#L80)    |
| POST   | `/api/surveys/{id}/jobs/qa`     | ADMIN, PROGRAMMER · rate limit 30/min   | [`JobsController.qa`](../../apps/api/src/jobs/jobs.controller.ts#L96)        |
| POST   | `/api/surveys/{id}/jobs/ai`     | ADMIN, PROGRAMMER · rate limit 20/min   | [`JobsController.ai`](../../apps/api/src/jobs/jobs.controller.ts#L113)       |
| GET    | `/api/surveys/{id}/jobs`        | Signed-in (any role except INTERVIEWER) | [`JobsController.list`](../../apps/api/src/jobs/jobs.controller.ts#L158)     |
| GET    | `/api/jobs/{id}`                | Signed-in (any role except INTERVIEWER) | [`JobsController.get`](../../apps/api/src/jobs/jobs.controller.ts#L163)      |
| POST   | `/api/jobs/{id}/cancel`         | Signed-in (any role except INTERVIEWER) | [`JobsController.cancel`](../../apps/api/src/jobs/jobs.controller.ts#L168)   |
| GET    | `/api/files/{id}`               | Signed-in (any role except INTERVIEWER) | [`JobsController.download`](../../apps/api/src/jobs/jobs.controller.ts#L174) |

### Question bank and templates

Backend: `apps/api/src/library` · Frontend: `apps/studio/app/library/page.tsx`, `apps/studio/components/QuestionBank.tsx`, `apps/studio/components/neon/CreateSurvey.tsx`

| Method | Endpoint                 | Who can call it                         | Handler (file:line)                                                                   |
| ------ | ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/api/library/templates` | Signed-in (any role except INTERVIEWER) | [`LibraryController.templates`](../../apps/api/src/library/library.controller.ts#L49) |
| GET    | `/api/library`           | Signed-in (any role except INTERVIEWER) | [`LibraryController.list`](../../apps/api/src/library/library.controller.ts#L57)      |
| POST   | `/api/library`           | ADMIN, PROGRAMMER                       | [`LibraryController.create`](../../apps/api/src/library/library.controller.ts#L72)    |
| PUT    | `/api/library/{id}`      | ADMIN, PROGRAMMER                       | [`LibraryController.update`](../../apps/api/src/library/library.controller.ts#L92)    |
| DELETE | `/api/library/{id}`      | ADMIN, PROGRAMMER                       | [`LibraryController.remove`](../../apps/api/src/library/library.controller.ts#L106)   |

### API keys and audit log

Backend: `apps/api/src/enterprise` · Frontend: `apps/studio/components/ApiKeys.tsx`, `apps/studio/app/settings/audit/page.tsx`

| Method | Endpoint                | Who can call it   | Handler (file:line)                                                                         |
| ------ | ----------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/api-keys`         | ADMIN, PROGRAMMER | [`ApiKeysController.list`](../../apps/api/src/enterprise/api-keys.controller.ts#L46)        |
| POST   | `/api/api-keys`         | ADMIN, PROGRAMMER | [`ApiKeysController.create`](../../apps/api/src/enterprise/api-keys.controller.ts#L56)      |
| DELETE | `/api/api-keys/{id}`    | ADMIN, PROGRAMMER | [`ApiKeysController.revoke`](../../apps/api/src/enterprise/api-keys.controller.ts#L79)      |
| GET    | `/api/audit`            | ADMIN             | [`AuditLogController.list`](../../apps/api/src/enterprise/audit-log.controller.ts#L60)      |
| GET    | `/api/audit/actions`    | ADMIN             | [`AuditLogController.actions`](../../apps/api/src/enterprise/audit-log.controller.ts#L84)   |
| GET    | `/api/audit/export.csv` | ADMIN             | [`AuditLogController.export`](../../apps/api/src/enterprise/audit-log.controller.ts#L94)    |
| GET    | `/api/audit/security`   | ADMIN             | [`AuditLogController.security`](../../apps/api/src/enterprise/audit-log.controller.ts#L129) |

### Plan, usage and billing

Backend: `apps/api/src/plans` · Frontend: `apps/studio/components/Identity.tsx`

| Method | Endpoint                | Who can call it | Handler (file:line)                                                                |
| ------ | ----------------------- | --------------- | ---------------------------------------------------------------------------------- |
| GET    | `/api/billing`          | ADMIN           | [`BillingController.summary`](../../apps/api/src/plans/billing.controller.ts#L19)  |
| POST   | `/api/billing/checkout` | ADMIN           | [`BillingController.checkout`](../../apps/api/src/plans/billing.controller.ts#L26) |
| POST   | `/api/billing/portal`   | ADMIN           | [`BillingController.portal`](../../apps/api/src/plans/billing.controller.ts#L33)   |
| POST   | `/api/billing/webhook`  | Public          | [`BillingController.webhook`](../../apps/api/src/plans/billing.controller.ts#L42)  |

### SCIM 2.0 provisioning

Backend: `apps/api/src/scim` · Frontend: `apps/studio/components/Identity.tsx` (token only); the rest is called by your identity provider

| Method | Endpoint                             | Who can call it           | Handler (file:line)                                                                  |
| ------ | ------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/plan`                          | ADMIN, PROGRAMMER, VIEWER | [`ScimAdminController.plan`](../../apps/api/src/scim/scim-admin.controller.ts#L21)   |
| GET    | `/api/scim/token`                    | ADMIN                     | [`ScimAdminController.status`](../../apps/api/src/scim/scim-admin.controller.ts#L27) |
| POST   | `/api/scim/token`                    | ADMIN                     | [`ScimAdminController.create`](../../apps/api/src/scim/scim-admin.controller.ts#L42) |
| DELETE | `/api/scim/token`                    | ADMIN                     | [`ScimAdminController.revoke`](../../apps/api/src/scim/scim-admin.controller.ts#L55) |
| GET    | `/api/scim/v2/ServiceProviderConfig` | Public                    | [`ScimController.config`](../../apps/api/src/scim/scim.controller.ts#L110)           |
| GET    | `/api/scim/v2/ResourceTypes`         | Public                    | [`ScimController.resourceTypes`](../../apps/api/src/scim/scim.controller.ts#L127)    |
| GET    | `/api/scim/v2/Schemas`               | Public                    | [`ScimController.schemas`](../../apps/api/src/scim/scim.controller.ts#L144)          |
| GET    | `/api/scim/v2/Users`                 | Public                    | [`ScimController.list`](../../apps/api/src/scim/scim.controller.ts#L175)             |
| GET    | `/api/scim/v2/Users/{id}`            | Public                    | [`ScimController.get`](../../apps/api/src/scim/scim.controller.ts#L210)              |
| POST   | `/api/scim/v2/Users`                 | Public                    | [`ScimController.create`](../../apps/api/src/scim/scim.controller.ts#L215)           |
| PUT    | `/api/scim/v2/Users/{id}`            | Public                    | [`ScimController.replace`](../../apps/api/src/scim/scim.controller.ts#L242)          |
| PATCH  | `/api/scim/v2/Users/{id}`            | Public                    | [`ScimController.patch`](../../apps/api/src/scim/scim.controller.ts#L257)            |
| DELETE | `/api/scim/v2/Users/{id}`            | Public                    | [`ScimController.remove`](../../apps/api/src/scim/scim.controller.ts#L301)           |

### Contacts, email and SMS invitations, unsubscribe

Backend: `apps/api/src/distribution` · Frontend: `apps/studio/components/EmailInvitations.tsx`

| Method | Endpoint                                             | Who can call it                         | Handler (file:line)                                                                                       |
| ------ | ---------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET    | `/api/surveys/{id}/contacts`                         | Signed-in (any role except INTERVIEWER) | [`DistributionController.contacts`](../../apps/api/src/distribution/distribution.controller.ts#L30)       |
| POST   | `/api/surveys/{id}/contacts/import`                  | ADMIN, PROGRAMMER                       | [`DistributionController.importContacts`](../../apps/api/src/distribution/distribution.controller.ts#L36) |
| DELETE | `/api/surveys/{id}/contacts`                         | ADMIN, PROGRAMMER                       | [`DistributionController.deleteContacts`](../../apps/api/src/distribution/distribution.controller.ts#L42) |
| GET    | `/api/surveys/{id}/distributions`                    | Signed-in (any role except INTERVIEWER) | [`DistributionController.waves`](../../apps/api/src/distribution/distribution.controller.ts#L47)          |
| POST   | `/api/surveys/{id}/distributions`                    | ADMIN, PROGRAMMER                       | [`DistributionController.create`](../../apps/api/src/distribution/distribution.controller.ts#L53)         |
| POST   | `/api/surveys/{id}/distributions/{waveId}/cancel`    | ADMIN, PROGRAMMER                       | [`DistributionController.cancel`](../../apps/api/src/distribution/distribution.controller.ts#L60)         |
| GET    | `/api/surveys/{id}/distributions/{waveId}/links.csv` | ADMIN, PROGRAMMER                       | [`DistributionController.links`](../../apps/api/src/distribution/distribution.controller.ts#L66)          |
| GET    | `/api/public/unsubscribe/{uid}`                      | Public                                  | [`UnsubscribeController.form`](../../apps/api/src/distribution/distribution.controller.ts#L88)            |
| POST   | `/api/public/unsubscribe/{uid}`                      | Public · rate limit 30/min              | [`UnsubscribeController.unsubscribe`](../../apps/api/src/distribution/distribution.controller.ts#L101)    |

### Automation rules, runs and notifications

Backend: `apps/api/src/automation` · Frontend: `apps/studio/app/automation/page.tsx`, `apps/studio/components/NotificationBell.tsx`

| Method | Endpoint                             | Who can call it                         | Handler (file:line)                                                                             |
| ------ | ------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/api/automation/vocabulary`         | Signed-in (any role except INTERVIEWER) | [`AutomationController.vocabulary`](../../apps/api/src/automation/automation.controller.ts#L13) |
| GET    | `/api/automation/surveys`            | Signed-in (any role except INTERVIEWER) | [`AutomationController.surveys`](../../apps/api/src/automation/automation.controller.ts#L19)    |
| GET    | `/api/automation/rules`              | Signed-in (any role except INTERVIEWER) | [`AutomationController.list`](../../apps/api/src/automation/automation.controller.ts#L24)       |
| POST   | `/api/automation/rules`              | ADMIN, PROGRAMMER                       | [`AutomationController.create`](../../apps/api/src/automation/automation.controller.ts#L30)     |
| PATCH  | `/api/automation/rules/{id}`         | ADMIN, PROGRAMMER                       | [`AutomationController.update`](../../apps/api/src/automation/automation.controller.ts#L36)     |
| DELETE | `/api/automation/rules/{id}`         | ADMIN, PROGRAMMER                       | [`AutomationController.remove`](../../apps/api/src/automation/automation.controller.ts#L43)     |
| POST   | `/api/automation/rules/{id}/dry-run` | ADMIN, PROGRAMMER                       | [`AutomationController.dryRun`](../../apps/api/src/automation/automation.controller.ts#L50)     |
| GET    | `/api/automation/runs`               | Signed-in (any role except INTERVIEWER) | [`AutomationController.runs`](../../apps/api/src/automation/automation.controller.ts#L55)       |
| POST   | `/api/automation/runs/{id}/approve`  | ADMIN                                   | [`AutomationController.approve`](../../apps/api/src/automation/automation.controller.ts#L63)    |
| POST   | `/api/automation/runs/{id}/reject`   | ADMIN                                   | [`AutomationController.reject`](../../apps/api/src/automation/automation.controller.ts#L70)     |
| GET    | `/api/notifications`                 | Signed-in (any role except INTERVIEWER) | [`NotificationsController.list`](../../apps/api/src/automation/automation.controller.ts#L81)    |
| POST   | `/api/notifications/read-all`        | Signed-in (any role except INTERVIEWER) | [`NotificationsController.readAll`](../../apps/api/src/automation/automation.controller.ts#L87) |
| POST   | `/api/notifications/{id}/read`       | Signed-in (any role except INTERVIEWER) | [`NotificationsController.read`](../../apps/api/src/automation/automation.controller.ts#L93)    |

### Data residency and retention

Backend: `apps/api/src/governance` · Frontend: `apps/studio/components/DataGovernance.tsx`

| Method | Endpoint                       | Who can call it | Handler (file:line)                                                                         |
| ------ | ------------------------------ | --------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/organization/governance` | ADMIN           | [`GovernanceController.get`](../../apps/api/src/governance/governance.controller.ts#L13)    |
| PUT    | `/api/organization/governance` | ADMIN           | [`GovernanceController.update`](../../apps/api/src/governance/governance.controller.ts#L18) |
