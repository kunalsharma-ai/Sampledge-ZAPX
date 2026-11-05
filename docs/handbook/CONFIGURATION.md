# Configuration and environment variables

Every setting ZAPX reads, where it is read, whether you must set it, and a placeholder value. No real
secret appears here; replace every `<…>` placeholder with your own value.

## Where settings come from

| Program              | Reads settings from                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API and worker       | process environment, validated once by the Zod schema in `apps/api/src/config.ts` (`config()`). Locally the root `.env` is loaded by `dotenv` in `apps/api/package.json` scripts, or by `set -a; . ./.env; set +a` before `node apps/api/dist/main.js` |
| Database tools       | `packages/db/package.json` scripts load `../../.env` (`DATABASE_URL`)                                                                                                                                                                                  |
| Studio               | `ZAPX_API_URL` at **build time** for the `/api` rewrite (`apps/studio/next.config.mjs`)                                                                                                                                                                |
| Runtime and CAPI app | `ZAPX_API_URL` for the Vite dev/preview proxy only (`vite.config.ts`); nginx config in production                                                                                                                                                      |
| Docker compose       | the `x-api-env` block in `docker-compose.yml` (with `${VAR:-default}` fallbacks from your shell)                                                                                                                                                       |
| AWS                  | `app_environment` in `infra/terraform/ecs.tf` (plain values) and the Secrets Manager secret `zapx-<env>/app` (keys in `app_secret_keys`)                                                                                                               |

If a value is invalid the API refuses to start with `Invalid configuration: NAME: message; …`.
Start from `.env.example` (`cp .env.example .env`).

## Integrations set in the CRM _(PR #38, unmerged)_

From PR #38 the provider settings below no longer have to be environment variables. An administrator
of the organization that runs the installation (or the super admin) enters them in the studio under
**Settings → Integrations** (`/settings/integrations`), presses **Test**, and saves
([ADR 0035](../adr/0035-integrations-in-the-crm.md)). They are stored in the `PlatformIntegration`
table, secrets sealed with `SECRETS_KEY`.

The on/off switch in the CRM replaces the environment switch once the integration has been saved
there (`switchedOn = row ? row.enabled : envEnabled(config)` in `apps/api/src/platform/integrations.ts`).

| Integration (key)       | Environment switch it replaces       | Fields, with the variable each falls back to                                                                                                                               |
| ----------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude AI (`anthropic`) | `ANTHROPIC_API_KEY` + `AI_MODEL` set | `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_MODEL_ARCHITECT`, `AI_MODEL_TRANSLATE`, `AI_MODEL_INSIGHTS`, `AI_PRICING`                                                             |
| IPinfo (`ipinfo`)       | `NETWORK_REPUTATION=ipinfo`          | `IPINFO_TOKEN`                                                                                                                                                             |
| Deepgram (`deepgram`)   | `TRANSCRIPTION=deepgram`             | `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`                                                                                                                                       |
| Twilio (`twilio`)       | `TELEPHONY=twilio`                   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_CALLER_ID`, `TELEPHONY_WEBHOOK_BASE` (SMS uses the same account; `SMS_PROVIDER` and `SMS_FROM` stay in the environment) |
| Stripe (`stripe`)       | `BILLING=stripe`                     | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICES`, `STRIPE_API_VERSION`, `BILLING_FALLBACK_PLAN`                                                               |
| File storage (`s3`)     | `FILE_STORE=s3`                      | `S3_BUCKET`, `S3_REGION`, `S3_PREFIX`, `S3_KMS_KEY_ID`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                                                                       |

Rules: a value saved in the CRM **wins**; a field left empty there falls back to the environment
variable; **Reset** (`DELETE`) removes the saved row so the environment applies again. Each API and
worker process re-reads the saved values every `INTEGRATIONS_REFRESH_MS` (default 15 000 ms). The
field list comes from `INTEGRATIONS` in `apps/api/src/platform/integrations.ts`.
SendGrid (`EMAIL_PROVIDER`, `SENDGRID_API_KEY`), SSO, `JWT_SECRET`, `SECRETS_KEY` and the database stay
in the environment. The start-up checks in the next section still apply to whatever is set in the
environment.

## Production safety checks

With `NODE_ENV=production` the API also refuses to start when (`config.ts`, `superRefine`):
`COOKIE_SECURE` is not `true`; `JWT_SECRET` contains an example value (`dev-only-secret`,
`change-me`, `changeme`, `test-secret`); `SECRETS_KEY` is missing, equals `JWT_SECRET` or is an
example; `CALLBACK_ALLOW_PRIVATE_HOSTS=true`; or `SSO_ALLOW_INSECURE_ISSUER=true`.

Provider switches are checked too: turning a provider on without its credentials stops start-up
(for example `TELEPHONY=twilio` without `TWILIO_AUTH_TOKEN`).

## API and worker variables (`apps/api/src/config.ts`)

"Required" means the API will not start without it. Defaults are the code's defaults.

### Core

| Variable                                                                                       | Purpose                                                                                            | Required                        | Default                    | Example placeholder                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                                                                                 | PostgreSQL connection for Prisma. Add `?connection_limit=10&pool_timeout=20`                       | yes (or the `DB_*` parts below) | —                          | `postgresql://${DB_USER}:${DB_PASSWORD}@<host>:5432/zapx` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSLMODE`, `DB_CONNECTION_LIMIT` | build `DATABASE_URL` when it is unset (`apps/api/src/database-url.ts`; used on AWS)                | only without `DATABASE_URL`     | port 5432, name `zapx`     | `DB_HOST=<rds-endpoint>`                                  |
| `JWT_SECRET`                                                                                   | signs sessions; development fallback for `SIGNING_KEYS_SECRET` and `SecretBox`                     | yes, 32+ characters             | —                          | `<openssl rand -hex 32>`                                  |
| `SECRETS_KEY`                                                                                  | encrypts stored secrets (vendor partner secret, SSO client secret, webhook secrets, phone numbers) | yes in production, 32+ chars    | falls back to `JWT_SECRET` | `<openssl rand -base64 32>`                               |
| `SIGNING_KEYS_SECRET`                                                                          | derives the keys for test links, network/device hashes and SSO state (S5)                          | yes in production, 32+ chars    | falls back to `JWT_SECRET` | `<openssl rand -hex 32>`                                  |
| `THROTTLE_STORE`                                                                               | rate-limit counters: `database` (shared by all API processes) or `memory` (S4)                     | no                              | `database` in production   | `database`                                                |
| `NODE_ENV`                                                                                     | `production` turns on the safety checks                                                            | no                              | `development`              | `production`                                              |
| `API_PORT`                                                                                     | HTTP port                                                                                          | no                              | `4000`                     | `4000`                                                    |
| `RUNTIME_BASE_URL`                                                                             | public address of the respondent runtime, used to build survey links                               | no                              | `http://localhost:5173`    | `https://take.<your-domain>`                              |
| `CAPI_APP_URL`                                                                                 | address of the CAPI app, shown in the studio                                                       | no                              | `http://localhost:5174`    | `https://field.<your-domain>`                             |
| `STUDIO_URL`                                                                                   | public studio address; SSO callback is `${STUDIO_URL}/api/auth/sso/callback`                       | no                              | `http://localhost:3000`    | `https://zapx.<your-domain>`                              |
| `COOKIE_SECURE`                                                                                | send the session cookie only over https                                                            | `true` in production            | `false`                    | `true`                                                    |
| `ALLOW_SIGNUP`                                                                                 | allow self-service sign-up (creates a new organization)                                            | no                              | off unless `true`          | `false`                                                   |
| `DEFAULT_PLAN`                                                                                 | plan for organizations created by sign-up                                                          | no                              | `enterprise`               | `free`                                                    |
| `INTEGRATIONS_REFRESH_MS` _(PR #38)_                                                           | how often each process re-reads Settings → Integrations (1 000–600 000 ms)                         | no, default `15000`             |
| `MOBILE_MIN_VERSION` _(PR #40)_                                                                | oldest mobile app version allowed to sign in, e.g. `1.2.0`; older apps are asked to update         | no, unset = any                 |
| `DATA_REGION` _(PR #34)_                                                                       | region this deployment declares it keeps data in; compared with each organization's region         | no                              | empty                      | `eu`                                                      |

### Sign-in protection and proxies

| Variable                     | Purpose                                                                                     | Default | Example                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------- | --------------------------- |
| `LOGIN_RATE_PER_MINUTE`      | sign-in attempts per minute per address                                                     | `10`    | `10`                        |
| `SIGNUP_RATE_PER_MINUTE`     | sign-ups per minute per address                                                             | `5`     | `5`                         |
| `LOGIN_MAX_FAILURES`         | wrong passwords in a row before the account locks                                           | `10`    | `10`                        |
| `LOGIN_LOCK_MINUTES`         | lock length                                                                                 | `15`    | `15`                        |
| `PASSWORD_RESET_HOURS`       | hours a password reset link works (1–168) _(branch `security-fixes`)_                       | `24`    | `24`                        |
| `SSO_ALLOW_INSECURE_ISSUER`  | allow http/private identity providers (development and tests only; refused in production)   | off     | `false`                     |
| `TRUST_PROXY_HOPS`           | proxies in front of the API that add `X-Forwarded-For`                                      | `1`     | `1`                         |
| `EDGE_SHARED_SECRET`         | secret the CDN sends as `X-Zapx-Edge`; only then viewer address/country headers are trusted | unset   | `<openssl rand -hex 32>`    |
| `EDGE_CLIENT_ADDRESS_HEADER` | header with the viewer address                                                              | empty   | `cloudfront-viewer-address` |
| `GEO_COUNTRY_HEADER`         | header with the respondent's country (fraud check)                                          | empty   | `cloudfront-viewer-country` |

### AI

| Variable                                                                   | Purpose                                                                 | Default       | Example                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------- | ------------------------------------- |
| `AI_PROVIDER`                                                              | provider; only `anthropic` exists                                       | `anthropic`   | `anthropic`                           |
| `ANTHROPIC_API_KEY`                                                        | turns AI on (without it AI endpoints answer 503, everything else works) | unset         | `<anthropic-api-key>`                 |
| `AI_MODEL`                                                                 | default model for every AI task (no model is built into the code)       | unset         | `<model id, e.g. claude-opus-5-5>`    |
| `AI_MODEL_ARCHITECT`, `AI_MODEL_TRANSLATE`, `AI_MODEL_INSIGHTS` _(PR #33)_ | model per task, overriding `AI_MODEL`                                   | unset         | `<model id>`                          |
| `AI_PRICING`                                                               | JSON price list (USD per million tokens) for cost tracking              | `{}`          | `{"<model>":{"input":4,"output":20}}` |
| `AI_MAX_RETRIES`, `AI_TIMEOUT_MS`                                          | provider retries and timeout                                            | `2`, `600000` |                                       |
| `AI_BREAKER_FAILURES`, `AI_BREAKER_OPEN_MS`                                | circuit breaker                                                         | `5`, `60000`  |                                       |
| `AI_DEFAULT_RPM`, `AI_DEFAULT_RPD`                                         | per-organization rate limits when it has no own AI policy               | `10`, `500`   |                                       |

### Interviews, uploads and quality

| Variable                                           | Purpose                                                        | Default                           |
| -------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| `ABANDON_AFTER_MINUTES`                            | idle interviews become `partial` after this                    | `1440`                            |
| `UPLOAD_MAX_MB`                                    | questionnaire file upload limit                                | `15`                              |
| `MEDIA_MAX_MB`                                     | survey media upload limit (images 10, audio 25 are fixed caps) | `100`                             |
| `CAPTURE_MAX_MB`                                   | CAPI recording limit (photos fixed at 15)                      | `100`                             |
| `CAPTURE_RETENTION_DAYS`                           | delete photos/recordings after this many days (`0` = keep)     | `0`                               |
| `NETWORK_REPUTATION`                               | `off` or `ipinfo`                                              | `off`                             |
| `IPINFO_TOKEN`                                     | IPinfo token (required with `ipinfo`)                          | empty                             |
| `IPINFO_API_BASE`, `NETWORK_REPUTATION_TIMEOUT_MS` | endpoint and timeout                                           | `https://ipinfo.io`, `2000`       |
| `TRANSCRIPTION`                                    | `off` or `deepgram`                                            | `off`                             |
| `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`               | required with `deepgram`                                       | empty                             |
| `DEEPGRAM_API_BASE`, `TRANSCRIPTION_TIMEOUT_S`     | endpoint and timeout                                           | `https://api.deepgram.com`, `600` |

### Phone, email and SMS

| Variable                                                                                                                       | Purpose                                                               | Default                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------ |
| `TELEPHONY`                                                                                                                    | `off` or `twilio` (CATI dialer)                                       | `off`                                      |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_CALLER_ID` (E.164), `TELEPHONY_WEBHOOK_BASE` (public API URL ending `/api`) | required with `twilio`                                                | empty                                      |
| `TWILIO_API_BASE`, `TELEPHONY_RING_SECONDS`                                                                                    | endpoint and ring time                                                | `https://api.twilio.com`, `30`             |
| `EMAIL_PROVIDER` _(PR #32)_                                                                                                    | `off` or `sendgrid`                                                   | `off`                                      |
| `SENDGRID_API_KEY`, `EMAIL_FROM` _(PR #32)_                                                                                    | required with `sendgrid` (`EMAIL_FROM` must be a verified sender)     | empty                                      |
| `SENDGRID_API_BASE`, `EMAIL_FROM_NAME` _(PR #32)_                                                                              | endpoint and sender name                                              | `https://api.sendgrid.com`, `ZAPX surveys` |
| `SMS_PROVIDER` _(PR #34)_                                                                                                      | `off` or `twilio` (uses the Twilio SID and token above)               | `off`                                      |
| `SMS_FROM` _(PR #34)_                                                                                                          | E.164 number or Messaging Service SID (`MG…`), required with `twilio` | empty                                      |

### Background work, files and callbacks

| Variable                                                 | Purpose                                                                                   | Default             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------- |
| `JOB_WORKER`                                             | run the job loop in this process (`off` when the worker process runs)                     | `on`                |
| `JOB_POLL_MS`                                            | job loop interval                                                                         | `2000`              |
| `CALLBACK_WORKER`                                        | run callbacks/webhooks loop in this process                                               | `on`                |
| `CALLBACK_POLL_MS`, `CALLBACK_TIMEOUT_MS`                | interval and per-request timeout                                                          | `5000`, `10000`     |
| `CALLBACK_ALLOW_PRIVATE_HOSTS`                           | let callbacks/webhooks reach localhost/private networks (dev only; refused in production) | off                 |
| `FILE_STORE`                                             | `local` or `s3`                                                                           | `local`             |
| `FILES_DIR`                                              | local file folder (shared by API and worker)                                              | `.data/files`       |
| `S3_BUCKET`                                              | bucket (required with `s3`)                                                               | unset               |
| `S3_REGION`, `S3_PREFIX`, `S3_KMS_KEY_ID`, `S3_ENDPOINT` | region, key prefix, SSE-KMS key, test endpoint                                            | `eu-west-1`, unset… |
| `EXPORT_SYNC_MAX_ROWS`                                   | larger exports must run as background jobs                                                | `10000`             |
| `EXPORT_FILE_TTL_HOURS`                                  | export files are deleted after                                                            | `72`                |
| `JOB_RETENTION_DAYS`, `WEBHOOK_DELIVERY_RETENTION_DAYS`  | housekeeping retention                                                                    | `30`, `30`          |

S3 credentials are not ZAPX settings: the AWS SDK uses its normal chain (the ECS task role on AWS,
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` elsewhere).

### Billing

| Variable                                                         | Purpose                                                 | Default                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| `BILLING`                                                        | `off` or `stripe`                                       | `off`                                   |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                     | required with `stripe`                                  | unset                                   |
| `STRIPE_PRICES`                                                  | JSON plan → price, required with `stripe`               | `{}` (`{"team":"price_<id>"}`)          |
| `STRIPE_API_VERSION`, `STRIPE_API_BASE`, `BILLING_FALLBACK_PLAN` | API version pin, test endpoint, plan after cancellation | unset, `https://api.stripe.com`, `free` |

## Other variables

| Variable                                                                                                                                 | Used by                                                                                                          | Purpose                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ZAPX_API_URL`                                                                                                                           | `apps/studio/next.config.mjs`, `apps/runtime/vite.config.ts`, `apps/capi/vite.config.ts`, `Dockerfile` build arg | where the front ends proxy `/api` (default `http://localhost:4000`; `http://api:4000` in Docker)                       |
| `SEED_EMAIL`, `SEED_PASSWORD`                                                                                                            | `packages/db/src/seed.ts`                                                                                        | seed account                                                                                                           |
| `PW_CHROMIUM_PATH`                                                                                                                       | `e2e/playwright.config.ts`                                                                                       | use a specific Chromium                                                                                                |
| `E2E_REUSE`                                                                                                                              | mentioned in `e2e/playwright.config.ts` comment                                                                  | **Needs Verification:** the config always uses `reuseExistingServer: true`, so this variable appears to have no effect |
| `PROJEXA_URL`, `PROJEXA_EMAIL`, `PROJEXA_PASSWORD`, `ZAPX_API_URL`, `ZAPX_RUNTIME_URL`, `ZAPX_EMAIL`, `ZAPX_PASSWORD`, `CHECK_TIMEOUT_S` | `scripts/projexa-check.mjs`                                                                                      | PROJEXA end-to-end check                                                                                               |
| `KEEP`                                                                                                                                   | `infra/scripts/backup.sh`                                                                                        | number of backups kept (14)                                                                                            |
| `ENVIRONMENT`                                                                                                                            | `infra/scripts/deploy-aws.sh`                                                                                    | `staging` or `production`                                                                                              |

## Gaps found

- `.env.example` does not list `AI_MODEL_INSIGHTS`, `DATA_REGION`, `SMS_PROVIDER`, `SMS_FROM`,
  `SENDGRID_API_BASE`, `IPINFO_API_BASE`, `DEEPGRAM_API_BASE`, `TWILIO_API_BASE`,
  `TELEPHONY_RING_SECONDS`, `TRANSCRIPTION_TIMEOUT_S`, `NETWORK_REPUTATION_TIMEOUT_MS`,
  `AI_TIMEOUT_MS`, `STRIPE_API_BASE`. They all have safe defaults, so nothing breaks, but they are
  easy to miss.
- **Fixed on branch `security-fixes`:** on AWS, `app_secret_keys` (`infra/terraform/variables.tf`)
  included `TWILIO_AUTH_TOKEN` but the example secret JSON in `infra/terraform/README.md` did not,
  and `SENDGRID_API_KEY` had no secret slot. Both now match (and a test checks it). Every key in
  `app_secret_keys` must exist in the secret, empty if unused, or the tasks fail to start. With PR #38
  the list itself is unchanged (`variables.tf` still lists all nine keys), but the Terraform README
  now says provider keys can be entered in the CRM instead. **Needs Verification:** if you leave the
  provider keys out of the secret, also remove them from `app_secret_keys`, or the tasks fail to start.
- `ANTHROPIC_API_BASE` _(PR #38)_ exists only for tests (an Anthropic-compatible stand-in); leave it
  at its default.

## Super admin automation _(PR #41, unmerged; [ADR 0036](../adr/0036-super-admin.md))_

| Variable                 | Default | What it does                                                                 |
| ------------------------ | ------- | ---------------------------------------------------------------------------- |
| `PLATFORM_AUTOMATION`    | `on`    | Check the super admin's automation rules in this API process                 |
| `PLATFORM_AUTOMATION_MS` | `60000` | How often (ms). Several processes are safe: each firing is claimed only once |

The first super admin is made with `node apps/api/dist/cli/set-super-admin.js <email>` (the member must
belong to the organization that runs the installation; see `set-operator.js`). Remove with `--remove`.

## Mobile app settings _(PR #40, unmerged)_

The mobile app has no environment file. The member types the server address (the studio address)
on the sign-in screen. Build settings are in `apps/mobile/app.json` (name, icons, bundle id
`com.sampledge.zapx`) and `apps/mobile/eas.json` (EAS build profiles). Store accounts and signing keys
are not in the repository; see [docs/operations/mobile-release.md](../operations/mobile-release.md).
On the server, `MOBILE_MIN_VERSION` sets the oldest app version allowed.
