# Troubleshooting manual

Each problem below follows the same shape: **symptom**, **likely causes**, **files to check**,
**commands and logs**, **steps**, **fix** and **how to confirm it is fixed**. Start with
[First checks](#first-checks): they answer most questions in a minute.

Commands assume you are in the repository root with `.env` loaded (`set -a; . ./.env; set +a`) where
`psql "$DATABASE_URL"` is used.

## First checks

```bash
curl -s http://localhost:4000/api/health          # {"ok":true} = API up and database reachable
docker compose ps                                  # which containers run (if you use Docker)
docker compose logs --tail 100 api worker          # API and worker logs
psql "$DATABASE_URL" -c 'select 1'                 # database reachable from your shell
git branch --show-current && git log -1 --oneline  # which code you are actually running
```

`GET /api/health` (`apps/api/src/health.controller.ts`) runs `SELECT 1`, so a 500 there means the
database, not the API, is the problem. On AWS the same URL is the container and load-balancer health
check (`infra/terraform/ecs.tf`, `infra/terraform/edge.tf`).

Where logs go:

| Where you run it              | API / worker logs                                                          | Studio / runtime / CAPI                     |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm dev`                    | the terminal (Nest `Logger`, context `ZAPX`)                               | the terminal, plus the browser console      |
| `docker compose up`           | `docker compose logs -f api worker`                                        | `docker compose logs -f studio`; browser    |
| AWS (after `terraform apply`) | CloudWatch log groups `/zapx/<env>/api`, `/zapx/<env>/worker`, `…/migrate` | `/zapx/<env>/studio`; runtime/CAPI = S3+CDN |

There is no request log and no log level setting; the API logs startup, worker activity and errors.
In the browser, open DevTools → Network and look at the failing `/api/...` call: its JSON body holds
the API's `message`.

## Quick index

| Symptom                                               | Section                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| API exits at once with `Invalid configuration: …`     | [1. App does not start](#1-app-does-not-start)                       |
| `EADDRINUSE`, port already used                       | [1. App does not start](#1-app-does-not-start)                       |
| Studio page blank, "Something went wrong", 404 pages  | [2. Frontend errors](#2-frontend-errors)                             |
| 500 Internal server error                             | [3. Backend errors](#3-backend-errors)                               |
| 400 / 403 / 404 / 409 / 422 / 429 from the API        | [4. API failures](#4-api-failures)                                   |
| `Can't reach database server`, P1001, migrations fail | [5. Database connection](#5-database-connection)                     |
| Login fails, keeps returning to login, locked account | [6. Authentication](#6-authentication)                               |
| Saved but not shown, answers missing, wrong counts    | [7. Data not saving or displaying](#7-data-not-saving-or-displaying) |
| Export never finishes, download 404, upload rejected  | [8. File upload and download](#8-file-upload-and-download)           |
| Vendor callbacks or webhooks not arriving             | [9. Background work](#9-background-work-jobs-callbacks-webhooks)     |
| Docker build or AWS release fails                     | [10. Server and deployment](#10-server-and-deployment)               |
| Slow pages, timeouts                                  | [11. Performance](#11-performance)                                   |

---

## 1. App does not start

### 1a. API stops with `Invalid configuration: …`

- **Likely causes:** a required variable is missing or invalid. `config()` in
  `apps/api/src/config.ts` validates every variable with Zod and throws
  `Invalid configuration: <name>: <reason>`. Common ones: `DATABASE_URL` empty, `JWT_SECRET` shorter
  than 32 characters, and, with `NODE_ENV=production`, `COOKIE_SECURE` not `true`, `SECRETS_KEY`
  missing or equal to `JWT_SECRET` or the example value, `CALLBACK_ALLOW_PRIVATE_HOSTS=true`,
  `SSO_ALLOW_INSECURE_ISSUER=true`, or `FILE_STORE=s3` without `S3_BUCKET`.
- **Files:** `.env`, `.env.example`, `apps/api/src/config.ts` (the `superRefine` near the end lists
  the production rules), [CONFIGURATION.md](CONFIGURATION.md).
- **Commands:** `node apps/api/dist/main.js` prints the message and exits with code 1.
- **Steps:** read the variable name before the colon; compare `.env` with `.env.example`.
- **Fix:** set the variable. For a fresh machine `cp .env.example .env` is enough for development.
  Generate secrets with `openssl rand -hex 32` (never reuse the example values in production).
- **Confirm:** the log shows `API listening on http://localhost:4000/api` and
  `curl -s localhost:4000/api/health` returns `{"ok":true}`.

### 1b. `Cannot find module …/dist/main.js` or `@zapx/<package>` not found

- **Causes:** the API runs compiled JavaScript (`apps/api` scripts `dev`/`start` use `dist/`), and
  the shared packages (`packages/*`) must be built first. A fresh clone or a branch switch leaves
  `dist/` missing or stale. The Prisma client must also be generated.
- **Files:** `turbo.json`, `apps/api/package.json`, `packages/db/package.json`.
- **Commands / fix:**
  ```bash
  pnpm install --frozen-lockfile
  pnpm build            # builds every package and app in dependency order (turbo)
  ```
- **Confirm:** `ls apps/api/dist/main.js` exists and the API starts.

Note: `apps/api`'s `dev` script compiles once and then runs; it does **not** watch files. After an
API code change, stop it and run it again (or run `pnpm --filter @zapx/api build` and restart).

### 1c. `EADDRINUSE: address already in use :::4000` (or 3000, 5173, 5174)

- **Cause:** an older process still holds the port. Runtime and CAPI use `--strictPort`, so Vite
  refuses instead of choosing another port.
- **Commands:** `lsof -i :4000` or `ss -ltnp | grep 4000`; then `kill <pid>`. With Docker,
  `docker compose ps` shows whether a container has the port.
- **Confirm:** the app starts and its URL answers.

### 1d. Wrong Node or pnpm version

- **Cause:** the repo needs Node 22+ (`package.json` `engines`) and pnpm 10.28
  (`packageManager`). Older versions fail at install with syntax or lockfile errors.
- **Commands:** `node -v`, `pnpm -v`; `corepack enable && corepack prepare pnpm@10.28.0 --activate`.
- **Confirm:** `pnpm install --frozen-lockfile` finishes without errors.

---

## 2. Frontend errors

### 2a. Studio shows errors on every page or "Not signed in"

- **Causes:** the studio calls the API through its own `/api` rewrite
  (`apps/studio/next.config.mjs`, target `ZAPX_API_URL`, default `http://localhost:4000`). If the API
  is down or `ZAPX_API_URL` points elsewhere, every call fails.
- **Files:** `apps/studio/next.config.mjs`, `apps/studio/lib/api.ts` (the fetch helper that adds
  the `x-zapx-csrf: 1` header).
- **Commands:** browser DevTools → Network: a 500/502 on `/api/...` with no JSON body means the proxy
  could not reach the API. `curl -s localhost:3000/api/health` should equal
  `curl -s localhost:4000/api/health`.
- **Fix:** start the API; set `ZAPX_API_URL` before `next build` / `next start` when the API is
  elsewhere. In Docker the studio uses `http://api:4000` (set in `docker-compose.yml`).
- **Confirm:** `/api/health` through port 3000 returns `{"ok":true}`.

### 2b. A page renders but a section is empty or shows an error banner

- **Causes:** the API answered 403 (role) or 404 (project not assigned to this member; see
  `apps/api/src/projects/access.service.ts`). The page then shows its error state.
- **Steps:** in Network, find the call and read `message`. `Your role cannot do this` = role; a 404
  on a project that exists = project access (Settings → Members → assign the project).
- **Confirm:** reload after the change; the call returns 200.

### 2c. Runtime (respondent page) shows "This survey is not available." or a blank page

- **Causes:** the survey is not LIVE (paused or never published), the link is wrong, a signed link's
  signature (`sig`, `exp`) is invalid or expired, or the runtime cannot reach the API
  (`apps/runtime/vite.config.ts` proxies `/api` in dev and preview; in Docker nginx
  `infra/nginx/runtime.conf` does).
- **Files:** `apps/runtime/src/`, `apps/api/src/interview/interview.controller.ts`,
  `apps/api/src/interview/interview.service.ts` (`start`).
- **Commands:**
  ```bash
  # the status the runtime sees (replace the id)
  curl -s -b cookie.txt -H 'x-zapx-csrf: 1' localhost:4000/api/surveys/<surveyId>/status
  ```
  A survey that has no live version shows `This survey is not available.`; a paused survey answers
  `409 This survey is not live` when a respondent submits a page (`interview.service.ts`).
- **Fix:** publish or resume the survey in the studio; regenerate the link on the **Links** tab.
- **Confirm:** a test link opens the first question.

### 2d. CAPI app shows old screens after a release

- **Cause:** the CAPI app is an offline PWA with a service worker (`apps/capi`). Devices keep the
  cached version until the new service worker takes over.
- **Fix:** on the device, close all CAPI tabs and reopen; as a last resort clear site data **only
  after** all interviews are synced (unsynced interviews live in the browser's storage).
- **Confirm:** the version or new screen appears. **Needs Verification:** whether the CAPI app shows
  its version number on screen.

### 2e. Hydration warnings or a theme flash in the studio

- `apps/studio/app/layout.tsx` injects a theme boot script and sets `suppressHydrationWarning` on
  `<html>`. A warning on `<html>` attributes is expected; warnings elsewhere usually come from code
  that reads `window` or `Date.now()` during render. Move that code into `useEffect`.

---

## 3. Backend errors

### 3a. 500 `Internal server error`

- **Causes:** an exception that is not an `HttpException` (a bug, a Prisma error, a third-party
  call). Nest hides the details from the client and logs the stack.
- **Files:** the controller for the route (find it in the route table in
  [API_DOCUMENTATION.md](API_DOCUMENTATION.md)), its service, and `apps/api/src/common/`.
- **Commands:** reproduce with curl, then read the API log at the same moment:
  `docker compose logs --tail 200 api` or the terminal running the API.
- **Steps:** the stack trace names the file and line. Prisma errors carry a code: `P2002` unique
  violation, `P2025` record not found, `P2003` foreign key. Write a failing test in the module's
  `*.spec.ts` before fixing.
- **Fix:** handle the case in the service and throw the right `HttpException` (see the error table
  in [ARCHITECTURE.md](ARCHITECTURE.md)).
- **Confirm:** `pnpm --filter @zapx/api test` passes and the curl call returns the expected status.

### 3b. Errors only in the worker

- The worker (`apps/api/src/worker.ts`, `dist/worker.js`) runs jobs, vendor callbacks, webhooks,
  distribution, automation and housekeeping. Its log lines come from `JobWorker` and
  `CallbackWorker`. See [9. Background work](#9-background-work-jobs-callbacks-webhooks).

### 3c. AI features fail ("AI is not configured", budget reached, timeouts)

- **Causes:** no `ANTHROPIC_API_KEY` (and, on PR #28, no key in Settings → Integrations), the
  tenant's AI budget is used up, the circuit breaker is open after `AI_BREAKER_FAILURES` errors
  (it stays open `AI_BREAKER_OPEN_MS`), or a call exceeded `AI_TIMEOUT_MS`.
- **Files:** `apps/api/src/ai/` (gateway, budgets, breaker), [docs/modules/ai-gateway.md](../modules/ai-gateway.md).
- **Fix:** set the key; raise the budget in Settings → AI; wait for the breaker.
- **Confirm:** an AI draft job reaches `SUCCEEDED`.

---

## 4. API failures

| Status | Typical `message`                                          | Cause                                                                       | Fix                                                            |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 400    | `Invalid request` with `issues[]`                          | body failed the Zod schema in `parseBody`                                   | read `issues[].path`; fix the request                          |
| 401    | `Not signed in`, `Session expired`                         | no cookie/token, token older than 12 h, "sign out everywhere"               | sign in again                                                  |
| 401    | `Invalid API key`, `This API key was revoked/has expired`  | wrong, revoked or expired key, or its creator was disabled                  | create a new key (Settings → API keys)                         |
| 403    | `Missing CSRF header`                                      | cookie request without `x-zapx-csrf: 1`                                     | add the header (the studio does this; curl must too)           |
| 403    | `Your role cannot do this`                                 | the route's `@Roles(...)` excludes the role; INTERVIEWER is deny-by-default | change the member's role or use another account                |
| 404    | `Not found` on something that exists                       | project not assigned to this member (`AccessService`)                       | assign the project                                             |
| 409    | stale draft, duplicate vendor code or email                | someone saved first, or the value is taken                                  | reload, merge, retry; choose another code                      |
| 422    | `{message, errors:[{questionId,message}]}`                 | respondent answer failed validation (`InterviewValidationError`)            | expected behaviour; the runtime shows the messages             |
| 429    | `ThrottlerException: Too Many Requests` / `ACCOUNT_LOCKED` | rate limit (600/min default, lower per route) or login lockout              | wait a minute; see [6c](#6c-account-locked-429-account_locked) |

Reproducing a studio call with curl (local only, demo accounts from the seed):

```bash
curl -s -c cookie.txt -H 'content-type: application/json' \
  -d '{"email":"<admin-email>","password":"<password>"}' localhost:4000/api/auth/login
curl -s -b cookie.txt -H 'x-zapx-csrf: 1' localhost:4000/api/auth/me
```

Vendor API (`/api/v1/vendor/...`) failures: the signature is HMAC-SHA256 over
`${timestamp}.GET.${path}` with the vendor's secret, and the timestamp must be within ±300 seconds.
Check the clock on the calling machine and that the path includes the query string exactly as sent.
Code: `apps/api/src/integrations/vendor-api.controller.ts`.

---

## 5. Database connection

### 5a. `Can't reach database server at …` (Prisma P1001) or health returns 500

- **Causes:** PostgreSQL not running, wrong host/port in `DATABASE_URL`, or (on AWS) the parts
  `DB_HOST`, `DB_USER`, `DB_PASSWORD` not reaching the task. `apps/api/src/database-url.ts` builds
  `DATABASE_URL` from those parts only when `DATABASE_URL` itself is empty.
- **Commands:**
  ```bash
  docker compose up -d postgres && docker compose ps postgres
  psql "$DATABASE_URL" -c 'select version()'
  pg_isready -h localhost -p 5432
  ```
- **Fix:** start PostgreSQL 16; correct the URL. Inside Docker the host is `postgres`, outside it is
  `localhost`.
- **Confirm:** `curl -s localhost:4000/api/health` returns `{"ok":true}`.

### 5b. `The table "public.X" does not exist` or a column is missing

- **Cause:** migrations were not applied after pulling or switching branches. Each PR in the stack
  adds migrations (`packages/db/prisma/migrations/`).
- **Commands / fix:** `pnpm db:migrate` (runs `prisma migrate deploy`), then restart the API.
- **Check:** `psql "$DATABASE_URL" -c 'select migration_name, finished_at from _prisma_migrations order by started_at desc limit 5'`.
- **Confirm:** the error is gone and `pnpm --filter @zapx/api test` passes.

Switching **back** to an older branch leaves newer tables in place; Prisma does not undo migrations.
For a clean local database: `dropdb zapx && createdb zapx && pnpm db:migrate && pnpm db:seed`
(local only, it deletes everything).

### 5c. Migration fails (`P3009 failed migrations`, `P3018`)

- **Cause:** a migration failed half-way, usually because existing data breaks a new constraint.
- **Commands:** `pnpm --filter @zapx/db exec prisma migrate status`.
- **Fix:** fix the data or the migration SQL, then
  `pnpm --filter @zapx/db exec prisma migrate resolve --rolled-back <migration_name>` and run
  `pnpm db:migrate` again. On production take a backup first (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- **Confirm:** `prisma migrate status` reports "Database schema is up to date".

### 5d. Rows "disappear" for one tenant (Response, Capture)

- **Cause:** row-level security (`zapx_tenant_isolation`, ADR 0012) hides rows whose `tenantId` does
  not match the session setting the API sets per request. Queries run outside that path (for
  example a raw query in new code) see nothing, or everything if run as a superuser.
- **Files:** [DATABASE.md](DATABASE.md#5-indexes-unique-rules-and-database-level-security),
  `apps/api/src/common/prisma.service.ts`.
- **Steps:** compare the result as the app user and as a superuser.
- **Fix:** run queries on these tables through `PrismaService.forTenant(tenantId)`, which wraps each
  query in a transaction that first runs `set_config('app.tenant_id', …)`.

### 5e. `too many connections`

- **Cause:** each API, worker and test process opens its own Prisma pool. Set
  `DB_CONNECTION_LIMIT` (AWS parts) or `?connection_limit=N` in `DATABASE_URL`.
- **Commands:** `psql "$DATABASE_URL" -c 'select count(*), application_name from pg_stat_activity group by 2'`.

---

## 6. Authentication

### 6a. Login succeeds but the studio sends you back to the login page

- **Causes:** `COOKIE_SECURE=true` on plain `http://` (the browser drops the `zapx_token` cookie),
  the studio and API on different origins (the cookie is first-party only through the `/api`
  rewrite), or the session was revoked ("sign out everywhere", `sessionsRevokedAt`).
- **Files:** `apps/api/src/auth/session.ts`, `apps/api/src/auth/auth.guard.ts`, `.env`.
- **Steps:** DevTools → Application → Cookies: is `zapx_token` present after login?
- **Fix:** locally leave `COOKIE_SECURE` unset; always open the studio on its own address
  (`http://localhost:3000`), not the API's.
- **Confirm:** `GET /api/auth/me` returns 200 and the dashboard opens.

### 6b. `Email or password is incorrect` for a user that exists

- Check the email exactly (stored as given at creation). The login checks the password even for
  unknown emails (dummy hash) so the message is the same either way.
- There is **no password reset or change route** in the API: `apps/api/src/auth/auth.controller.ts`
  has only `login`, `register`, `logout`, `logout-all`, and `PATCH /api/users/:id` changes only
  `role`, `projectScope` and `disabled`. A forgotten password today needs a new hash written to the
  database by someone with database access, for example with a one-off script:
  ```bash
  cd apps/api && node -e "require('bcryptjs').hash(process.argv[1],10).then(console.log)" '<new-password>'
  # then: UPDATE "User" SET "passwordHash" = '<hash>' WHERE email = '<email>';
  ```
  The API hashes with `bcryptjs`, cost 10. This gap is listed in [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

### 6c. Account locked (429 `ACCOUNT_LOCKED`)

- **Cause:** `LOGIN_MAX_FAILURES` (default 10) wrong passwords in a row lock the account for
  `LOGIN_LOCK_MINUTES` (default 15). Code: `apps/api/src/auth/auth.controller.ts` `login` and
  `recordFailure`.
- **Fix:** wait for the lock to end. There is no unlock button or endpoint in the code. To unlock
  sooner, clear the lock in the database (this changes data; do it deliberately):
  ```sql
  UPDATE "User" SET "failedLogins" = 0, "lockedUntil" = NULL WHERE email = '<email>';
  ```
- **Confirm:** the next correct password signs in.

### 6d. `Your organization signs in with single sign-on` (403 `SSO_REQUIRED`)

- The tenant enforces SSO for that role (`SsoService.passwordBlocked`). Use "Sign in with SSO". If
  the IdP is broken, an ADMIN can still sign in with a password **if** the SSO settings allow admin
  passwords; see [docs/modules/sso-scim-plans.md](../modules/sso-scim-plans.md).

### 6e. SSO callback fails

- **Causes:** `STUDIO_URL` does not match the address registered at the IdP (callback is
  `${STUDIO_URL}/api/auth/sso/callback`), clock skew, a wrong issuer or certificate, or an
  `http://` issuer while `SSO_ALLOW_INSECURE_ISSUER` is false.
- **Files:** `apps/api/src/auth/sso.service.ts`, `apps/api/src/auth/sso.controller.ts`.
- **Commands:** API log at the time of the callback.

### 6f. Many 429s during automated tests

- `LOGIN_RATE_PER_MINUTE` and `SIGNUP_RATE_PER_MINUTE` limit sign-ins per address. Raise them only
  in the test environment's `.env`.

---

## 7. Data not saving or displaying

### 7a. Questionnaire edits are lost or "saved by someone else" (409)

- **Cause:** drafts are saved with optimistic locking. Two tabs or two people editing the same draft
  get a 409 on the older one. Code: `apps/api/src/surveys/` (draft save).
- **Fix:** reload, re-apply the change. Keep one editor tab per survey.
- **Confirm:** the save returns 200 and the version number goes up.

### 7b. Published survey does not show the latest edits

- **Cause:** respondents see the **published version**, not the draft. Edits to the draft need
  another **Publish**.
- **Steps:** survey **Versions** or **Status** shows the live version number.

### 7c. Answers or completes missing in reports

- **Causes:** test responses (links with `test=1` and a valid `tsig`) are kept apart from real data;
  responses removed by data cleaning or quality review; weighting or filters in the report; RLS
  (see 5d); or the response is still in progress.
- **Commands:**
  ```sql
  SELECT status, "isTest", "reviewState", count(*) FROM "Response"
  WHERE "surveyId" = '<id>' GROUP BY 1, 2, 3 ORDER BY 1;
  ```
  `status` is one of `IN_PROGRESS`, `COMPLETE`, `TERMINATE`, `QUOTA_FULL`, `QUALITY_FAIL`,
  `SECURITY_REJECT`, `DUPLICATE`, `PARTIAL`. A complete moved to `QUALITY_FAIL` by review no longer
  counts as a complete. Run this as a database superuser or through `forTenant` (see 5d).
- **Confirm:** counts in SQL match the report once filters are cleared.

### 7d. Quotas show full or wrong

- Quota counts are kept in quota rows updated during `complete`. Code:
  `apps/api/src/quotas/`. Compare the counter with
  `SELECT count(*) FROM "Response" WHERE status='COMPLETE' AND …` for the quota's condition.

### 7e. A respondent finishes but is not redirected, or goes to the wrong place

- **Causes:** the vendor has no URL for that status (the API returns `redirectUrl: null`, as in the
  terminate example in [API_DOCUMENTATION.md](API_DOCUMENTATION.md)), the dynamic mode expects a
  parameter that the entry link did not carry, or a country redirect overrides the default.
- **Files:** `apps/api/src/integrations/redirect.service.ts`, `packages/redirect-core/`.
- **Steps:** studio → Vendors → the vendor → **Redirect QA** (preview) and **Redirect log**.
- **Confirm:** a test link reaches the expected URL for complete, terminate and over-quota.

---

## 8. File upload and download

### 8a. Export job stays QUEUED

- **Cause:** no job worker is running. In `docker-compose.yml` the `api` service has
  `JOB_WORKER=off`; the separate `worker` service runs jobs. With `pnpm dev` the API runs the
  worker itself unless `JOB_WORKER=off` is in `.env`.
- **Commands:**
  ```sql
  SELECT id, type, status, attempts, error, "runAfter", "lockedUntil" FROM "Job" ORDER BY "createdAt" DESC LIMIT 10;
  ```
  `docker compose ps worker`; `docker compose logs --tail 100 worker`.
- **Fix:** start the worker (`docker compose up -d worker` or `node apps/api/dist/worker.js`).
- **Confirm:** the job moves to `RUNNING` then `SUCCEEDED` within a few seconds (poll `JOB_POLL_MS`,
  default 2 s).

### 8b. Job FAILED with `The job stopped unexpectedly several times.`

- The worker died mid-run more than `maxAttempts` times (out of memory on a large export is the usual
  reason). Check worker memory and logs; split the export by date or variables.

### 8c. Download link returns 404

- **Causes:** export files are deleted after `EXPORT_FILE_TTL_HOURS`; `FILES_DIR` is relative
  (default `.data/files`) and resolved from the **current directory** of the process
  (`apps/api/src/jobs/file-store.ts`), so an API started from another folder than the worker looks in
  another place; with `FILE_STORE=s3` the bucket, prefix or IAM role is wrong.
- **Fix:** set `FILES_DIR` to an absolute path shared by API and worker, or use S3; re-run the export.
- **Confirm:** `GET /api/files/<id>` returns the file.

### 8d. Upload rejected (413, `File too large`, wrong type)

- **Limits:** media `MEDIA_MAX_MB` (default 100), document import `UPLOAD_MAX_MB` (default 15), CAPI
  photos a fixed limit in `apps/api/src/captures/capture.controller.ts`, JSON bodies 100 kB
  (`apps/api/src/bootstrap.ts`).
- **On AWS** the WAF may also block large bodies (count mode first; `waf_count_only_rules`).
- **Fix:** raise the variable within its allowed range (see [CONFIGURATION.md](CONFIGURATION.md)).

### 8e. S3 errors (`AccessDenied`, `NoSuchBucket`)

- Check `S3_BUCKET`, `S3_REGION`, `S3_PREFIX`, `S3_KMS_KEY_ID` and that the task role can use the KMS
  key. S3 was only tested against a fake S3, so this is listed in
  [go-live.md](../operations/go-live.md) as a staging check.

---

## 9. Background work: jobs, callbacks, webhooks

### 9a. Vendor callbacks (S2S) not received

- **Causes:** no `CALLBACK_WORKER` running, the receiver answers 4xx (state `FAILED`, no retry),
  repeated timeouts (`DEAD` after `maxAttempts`), or the URL points to a private address while
  `CALLBACK_ALLOW_PRIVATE_HOSTS=false`.
- **Commands:**
  ```sql
  SELECT state, "lastHttpStatus", "lastError", attempts, "nextAttemptAt", url
  FROM "OutboundCallback" ORDER BY "createdAt" DESC LIMIT 20;
  ```
- **Studio:** Vendors → the vendor → callback log (`GET /api/vendors/:id/callbacks`); **Replay**
  (`POST /api/callbacks/:id/replay`).
- **Confirm:** state `DELIVERED` and `deliveredAt` set.

### 9b. Webhooks not received

- Same pattern with `WebhookDelivery`; studio Settings → Webhooks → deliveries
  (`GET /api/webhooks/:id/deliveries`), **Send test** (`POST /api/webhooks/:id/test`) and
  **Redeliver** (`POST /api/webhook-deliveries/:id/redeliver`). Receivers must check the signature
  ([docs/adr/0011-outbound-webhooks.md](../adr/0011-outbound-webhooks.md)).

### 9c. Work runs twice or not at all with several API instances

- Jobs and deliveries are claimed with `FOR UPDATE SKIP LOCKED`, so several workers are safe. If
  `JOB_WORKER` and `CALLBACK_WORKER` are `off` everywhere, nothing runs. Exactly as on AWS: API tasks
  `off`, one worker task `on`.

---

## 10. Server and deployment

### 10a. `docker compose build` fails

- **Causes:** Docker not running, low disk, network to npm. The `Dockerfile` has targets `api`,
  `migrate`, `worker`, `studio`, `runtime`, `capi`.
- **Commands:** `docker compose build api 2>&1 | tail -50`; `docker system df`.
- **Fix:** free space (`docker builder prune`), retry.

### 10b. `docker compose up` starts but the API container restarts

- `docker compose logs api`: usually the `migrate` service failed first (look at
  `docker compose logs migrate`) or the configuration check (1a).

### 10c. `infra/scripts/deploy-aws.sh` stops

| Message                                                      | Meaning and fix                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `set ENVIRONMENT (staging or production)`                    | run `ENVIRONMENT=staging infra/scripts/deploy-aws.sh`                                                              |
| `The working tree has changes; commit them first…`           | commit or stash; the image tag is the commit                                                                       |
| `Migrations failed (exit N); the services were not changed.` | read CloudWatch `/zapx/<env>/migrate`; fix; release again                                                          |
| `aws ecs wait services-stable` times out                     | new tasks fail health checks; read `/zapx/<env>/api`; ECS rolls back by itself                                     |
| Tasks stop with `ResourceInitializationError … secret`       | a key in `app_secret_keys` is missing in the app secret JSON (see [CONFIGURATION.md](CONFIGURATION.md#gaps-found)) |

The script has **not yet been run against AWS** (its own header says so). Expect first-run fixes on
staging. More in [DEPLOYMENT.md](DEPLOYMENT.md).

### 10d. Respondents see the old runtime after a release

- Hashed assets are cached for a year, entry files (`index.html`, `sw.js`,
  `manifest.webmanifest`) are invalidated on CloudFront by the script. Check the invalidation
  finished: `aws cloudfront list-invalidations --distribution-id <id>`.

### 10e. Respondent country or IP is wrong behind the CDN

- `EDGE_SHARED_SECRET` must match the `x-zapx-edge` header CloudFront adds; otherwise
  `edgeTrust` (`apps/api/src/bootstrap.ts`) drops the address and country headers. Also check
  `TRUST_PROXY_HOPS`.

---

## 11. Performance

### 11a. Slow studio pages or API calls

- **Steps:**
  1. Find the slow call in DevTools → Network (Timing).
  2. Time it with curl: `curl -s -o /dev/null -w '%{time_total}\n' -b cookie.txt -H 'x-zapx-csrf: 1' localhost:4000/api/...`.
  3. In PostgreSQL find slow queries:
     ```sql
     SELECT pid, now() - query_start AS running, left(query, 120) FROM pg_stat_activity
     WHERE state <> 'idle' ORDER BY running DESC;
     ```
     Run `EXPLAIN ANALYZE` on the query; a `Seq Scan` on a large table means a missing index (add it
     in `schema.prisma` with `@@index`, then a migration).
- **Known heavy areas:** analysis and crosstabs on large surveys (`apps/api/src/analysis/`,
  `packages/analysis-core/`), exports (run as jobs), dashboard aggregates.

### 11b. Many 429s under load

- The global limit is 600 requests per minute per address **per API process** (memory store,
  `ThrottlerModule.forRoot` in `apps/api/src/app.module.ts`). Interview centres behind one address
  share the limit; on AWS the WAF rate limit (`waf_rate_limit`) applies too.

### 11c. Worker falls behind

- Look at queued work: `SELECT type, count(*) FROM "Job" WHERE status='QUEUED' GROUP BY type;`.
  Add a worker process (safe, see 9c) or lower the work per job.

---

## When you are stuck

1. Reproduce the problem with the smallest curl call or test.
2. Search the code for the exact error text: `grep -rn "<message>" apps packages --include=*.ts`.
3. Read the module guide in `docs/modules/` and the ADR named in the file's comments.
4. Write a failing test in the closest `*.spec.ts`, fix, run `pnpm check --quick`.
