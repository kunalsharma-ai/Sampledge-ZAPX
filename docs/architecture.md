# ZAPX architecture (Milestones 1 to 20 and PRs #27–#46)

The full plan, including the module map and roadmap, is in the project's
"ZAPX architecture and first milestone" document. This file records what the code does today and
the rules every later module must follow.

## Core rules

1. **One survey definition.** `packages/survey-schema` defines the questionnaire format. Studio,
   API, runtime, QA, and later AI, translation and CAPI read and write this one format. Do not add a
   second questionnaire model.
2. **One logic engine.** `packages/logic-engine` evaluates conditions, validations, terminations and
   quotas. The server, the studio preview and the offline CAPI app all call the same functions.
   Expressions are parsed and interpreted, never `eval`-ed.
3. **Presentation never changes logic.** Themes, translations and device layouts (later) are layers
   keyed by question id. They must not change ids, answer codes or routing.
4. **Published versions are immutable.** Each response stores the version it answered.
5. **The server is authoritative.** The respondent runtime renders what the API returns. Routing,
   validation, quotas and redirects are decided on the server.
6. **AI proposes, people approve** (from Milestone 2). AI output becomes a change set validated by
   the same schema and logic check as a manual edit.

## AI and imports: proposals, never direct edits (Milestone 2)

Anything that is not a person's own edit reaches a draft through a **change set**
(`apps/api/src/changesets`). A change set stores the full proposed definition, the draft it was based
on (id and `updatedAt`), a structured diff (`diffSurveys` in the logic engine), the schema and logic
check, a 200-respondent QA preview, the assumptions to confirm, and who produced it (model id or
importer version). Applying is a programmer action, recorded in the audit trail, and is a
compare-and-swap on the draft's `updatedAt`, so a stale proposal can never overwrite newer work.

The AI Survey Architect (`apps/api/src/ai`) depends on the abstract `AiProvider`.
`ClaudeAiProvider` uses the Anthropic SDK with structured outputs, adaptive thinking, streaming and
server-side fallbacks; `UnconfiguredAiProvider` answers 503 when no key is set; tests use a scripted
fake. `ArchitectService` validates every answer with `parseSurveyDefinition` and `analyzeSurvey`,
and gives the model one repair round with the exact problems. Uploaded documents and the current
draft are sent as delimited data, and the system prompt tells the model not to follow instructions
inside them; even so, the human review step is the real safeguard.

File intake (`apps/api/src/imports`): files are classified by extension and content (zip/PDF magic
bytes, no binary in text). The ZAPX template (XLSX/CSV) is parsed deterministically with per-row
confidence. DOCX is converted to plain text with mammoth; PDFs go to the model as documents.

## QA Laboratory (Milestone 2)

`simulateSurvey` (logic engine) runs synthetic respondents through the same routing, validation,
termination and quota functions as live interviews. Answers are generated deterministically from a
seed, favour options chosen least so far, and use boundary values taken from the literals in
conditions. The report lists outcome counts, coverage items with hit counts, and defects with an
example respondent. The API stores each run (`QaRun`) with the version it tested.

## Presentation layer: themes, languages, devices (Milestone 3)

Each `SurveyVersion` has a `presentation` document next to its `definition`
(`presentationSchema` in `packages/survey-schema`): `theme`, `devices` and `languages`. It is
versioned and frozen with the definition at publish, so a published version always looks the same.
It never contains logic.

- **Themes** become CSS custom properties through `themeCss` in `packages/survey-renderer`, shared by
  the runtime and studio preview. Values are schema-validated (hex colours, fixed font stacks,
  numeric radius), so a theme cannot inject CSS. Logos are small PNG/JPEG/WebP data URLs; SVG is
  rejected because it can carry script. No web fonts are loaded. The narrow layout uses a container
  query, so the studio's phone-width preview matches a real phone.
- **Translations** are maps from stable text keys (`q.Q1.text`, `q.Q1.opt.2`, `ui.next`, ...) to
  `{ text, source, status }`. `localizeDefinition` overlays them on the definition at run time;
  ids, codes and conditions are untouched, so the logic engine, piping, QA and exports work the same
  in every language. `source` records what was translated, so an edit to the source marks the
  translation outdated. AI translations are stored as `machine` and an enabled language blocks
  publishing until every text is current and `reviewed` by a person. System messages
  (validation errors, buttons, end messages) are keys too (`SYSTEM_MESSAGES` in the logic engine).
- **Devices**: the runtime sends two coarse hints (touch support, short screen side) with the user
  agent; `classifyDevice` returns desktop, tablet or mobile. Only that type is stored. A device that
  is not allowed is screened out before a response is created, so the respondent can retry on an
  allowed device with the same link.

## Request flow for a respondent

1. Vendor link `/s/:surveyId?vid&uid…` loads the runtime, which posts the query to
   `POST /api/public/s/:surveyId/start`.
2. The API checks the vendor, the signature (if required), survey status and duplicate UIDs, creates
   a `Response` bound to the live `SurveyVersion`, and returns a random session token. Only the
   token's SHA-256 is stored. The runtime replaces the URL with `/r/:token`.
3. Each page is posted to `POST /api/public/r/:token/answers`. The API validates answers, applies
   terminations and quota checks, and moves to the next visible page.
4. On completion, quota counters are incremented atomically (`count < target` in the same
   transaction), so concurrent completes cannot overfill a quota.
5. The vendor redirect is resolved by `RedirectService`, recorded in the redirect log, and the
   vendor's callback (if any) is queued in the outbox.

## Redirect & Vendor Integration (Milestone 4)

Redirects, callbacks, the redirect log and the vendor API form one separable module: pure logic in
`packages/redirect-core`, database access only in `RedirectRepository`, and the rest of ZAPX sees
only the abstract `RedirectService`. Direct vendors are resolved by ZAPX with the precedence
vendor + country > vendor > project + country > project > organization; PROJEXA vendors follow
PROJEXA's documented survey-platform contract (not yet verified against a live PROJEXA). Outcome
callbacks go through a PostgreSQL outbox with retries, a dead letter and manual replay. Details:
[modules/redirects.md](modules/redirects.md), [ADR 0003](adr/0003-redirect-and-vendor-integration.md).

## AI gateway (Milestone 4)

Every AI call goes through `AiGateway`: model per task from configuration, tenant permissions, rate
limits and a monthly budget, a circuit breaker, PII redaction for briefs and documents, and a usage
and cost ledger with audit events. Details: [modules/ai-gateway.md](modules/ai-gateway.md),
[ADR 0004](adr/0004-ai-gateway.md).

## Data quality (Milestone 5)

`packages/quality-core` scores every complete (speeding, straightlining, open-end quality, copied
answers, same network, survey-specific checks) into a 0 to 100 score with reasons. Settings are part
of the versioned definition. Low scores wait in a review queue where a person accepts or rejects;
rejecting releases the quota place and tells the vendor `quality_fail`. Optionally, very low scores
end as `quality_fail` inside the survey. Details: [modules/data-quality.md](modules/data-quality.md),
[ADR 0007](adr/0007-data-quality.md).

## CAPI: offline interviewing (Milestone 5)

`apps/capi` is an installable web app for interviewers: it downloads assigned surveys, runs
interviews offline with the shared engine and renderer, keeps everything in IndexedDB and syncs when
online. The server replays every uploaded interview against its published version and decides the
outcome, quotas and quality itself; uploads are idempotent by a device-generated id. Interviewers
have their own role and cannot reach the studio API. Details: [modules/capi.md](modules/capi.md),
[ADR 0008](adr/0008-capi-offline-app.md).

## Enterprise access and integration (Milestone 6)

- **Project-level access.** Members are programmers or viewers with access to all projects or only
  assigned ones; `AccessService` is the single source of the project, survey and vendor filters, and
  the guard reads the member fresh on every request. [ADR 0010](adr/0010-project-access-and-api-keys.md)
- **API keys.** Hashed bearer keys that act as their creator with at most programmer rights.
- **Webhooks.** Signed JSON events from an outbox, delivered by the callback worker with the same
  retries and SSRF guard. Payloads never carry answers. [ADR 0011](adr/0011-outbound-webhooks.md)
- **Audit log viewer** with filters, paging and CSV export.
- **Row-level security** on `Response`, applied to the studio's respondent-data reads through a
  tenant-scoped Prisma client. [ADR 0012](adr/0012-row-level-security.md)

Details: [modules/access-and-api-keys.md](modules/access-and-api-keys.md),
[modules/webhooks.md](modules/webhooks.md).

## Background jobs and files (Milestone 7)

- **Job queue in PostgreSQL.** Exports, QA runs above 2,000 respondents and AI drafts are queued in
  `Job` and claimed with `SKIP LOCKED` under a renewable lease, so a crashed worker's job is picked up
  again. Jobs run as their creator, reloaded from the database, through the same services as the
  HTTP endpoints. [ADR 0013](adr/0013-background-jobs-and-file-storage.md)
- **File store.** `FileStore` with a local-disk implementation; `StoredFile` keeps owner, survey,
  SHA-256 and expiry. Downloads re-check access and are audited.
- **Worker process.** `dist/worker.js` runs jobs, vendor callbacks and webhooks without the HTTP
  server; by default the API runs them in-process. Hourly housekeeping removes expired files, old
  jobs and old webhook deliveries.

Details: [modules/jobs-and-files.md](modules/jobs-and-files.md).

## Identity, provisioning and plans (Milestone 8)

- **Single sign-on** with OpenID Connect (PKCE, nonce, JWKS-verified ID tokens), one provider per
  organization chosen by email domain, optional just-in-time accounts and "require SSO".
- **SCIM 2.0** user provisioning with a per-organization token; deleting a user disables them.
- **Disabled members** are refused on every request.
- **Plans** (`plans.ts`) limit team members, interviewers, live surveys and monthly completes, and
  gate SSO and SCIM. Operators set plans with `dist/cli/set-plan.js`; there is no billing.
  [ADR 0014](adr/0014-sso-scim-and-plans.md)

Details: [modules/sso-scim-plans.md](modules/sso-scim-plans.md).

## Phone interviewing (Milestone 9)

- **CATI call lists** with encrypted phone numbers, a shared queue (callbacks first, `SKIP LOCKED`
  claims with a 30-minute lease), dispositions with retry rules and maximum attempts.
- Interviews run on the same engine and runtime with mode `CATI`; finished interviews close their
  case automatically. Dialing is manual (`tel:` links). [ADR 0015](adr/0015-cati-call-lists.md)

Details: [modules/cati.md](modules/cati.md).

## Analysis (Milestone 10)

- **`@zapx/analysis-core`** (pure): variables from the definition (grid rows as `Q_row`, system
  variables from the data), frequencies, and crosstabs with column significance letters (pooled
  two-proportion z-test, Welch's test for means; low bases and multiple choice banners not tested).
- **`AnalysisService`** reads response rows through the tenant-scoped client in pages of 5,000, up
  to 200,000 per analysis. **Saved reports** (`Report`) store a validated config and are rerun on
  the latest data; Excel exports hold aggregates only. Unweighted. [ADR 0016](adr/0016-analysis-and-reports.md)

Details: [modules/analytics.md](modules/analytics.md).

## Rich media and question types (Milestone 11)

- New types `scale` (with NPS), `ranking`, `sum` and slider `numeric`, in the schema and logic
  engine (`RANK.2`, `SPEND.1` in expressions), simulation, translations, exports and analysis.
- **Media** (`MediaAsset`): uploaded per survey, type detected from content, stored in the
  `FileStore`, served at `/api/public/media/:id` (cacheable, byte ranges). Publishing checks every
  referenced file; files in use cannot be deleted. The CAPI app caches media for offline use.
- Read aloud uses the device's speech voices. [ADR 0017](adr/0017-rich-media-and-question-types.md)

Details: [modules/rich-media.md](modules/rich-media.md).

## Fraud detection and face-to-face capture (Milestone 12)

- **Fraud signals** are quality flags in `@zapx/quality-core` (`FraudInput`): browser signals the
  runtime sends with each page (`Response.signals`: honeypot, pages without input, pasted open
  answers), `navigator.webdriver`, a keyed device hash (`Response.deviceHash`), the edge network's
  country (`GEO_COUNTRY_HEADER`), and the organization's `FraudBlock` list.
- **Captures** (`Capture`): photo answers and CAPI recordings, private (`GET /api/captures/:id`,
  audited), under row-level security, in the `FileStore`. CAPI uploads files before the interview
  and the sync links them; `CAPTURE_RETENTION_DAYS` and per-survey erasure delete them.
- **CAPI** stores the start and end location and the recording consent in `Response.location`; the
  sync checks for overlapping interviews by the same interviewer. [ADR 0018](adr/0018-fraud-detection-and-capi-capture.md)

## Production readiness (Milestone 13)

- **Files** go to S3 with `FILE_STORE=s3` (`S3FileStore`, SSE-KMS); local disk stays the default.
- **SAML 2.0** sign-in (`SamlService`) beside OpenID Connect, sharing account linking, domains,
  just-in-time roles and enforcement; requests are stored in `SsoRequest` and answered once.
- **Billing** (`BillingService`, optional): Stripe Checkout and portal; signed webhooks re-read the
  subscription and set `Tenant.plan`. [Guide](modules/billing.md)
- **AWS** in `infra/terraform` with `infra/scripts/deploy-aws.sh`; the API builds `DATABASE_URL`
  from the RDS secret and trusts viewer address and country only from CloudFront
  (`EDGE_SHARED_SECRET`). [Guide](../infra/terraform/README.md)
- **PROJEXA check** `scripts/projexa-check.mjs`. [ADR 0019](adr/0019-production-readiness.md)

## Edge protection, scaling and backups (Milestone 14)

- **AWS WAF** in front of CloudFront (runtime, CAPI app) and the load balancer (studio, API). Managed
  rules start in count mode (`waf_mode = "count"`); the per-address rate rule always blocks.
- **Autoscaling** owns the API and studio task counts; **AWS Backup** covers RDS and the files bucket.
  [ADR 0020](adr/0020-edge-protection-scaling-backups.md), [go-live checklist](operations/go-live.md)

## Weighting (Milestone 15)

- Rim weighting (raking) is a pure function in `@zapx/analysis-core`, computed per run and saved
  with the report configuration, never stored per interview. Tables keep the unweighted base and use
  the effective base for significance. [ADR 0021](adr/0021-weighting.md)

## Provider adapters (Milestones 16 to 19)

Each is an interface with one first provider, off by default, tested against a local stand-in:

| Milestone | Adapter                     | Setting                     | What it does                                                     | ADR                                    |
| --------- | --------------------------- | --------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| 16        | `NetworkReputationProvider` | `NETWORK_REPUTATION=ipinfo` | Flags VPN, proxy, Tor and data-centre networks (words only)      | [0022](adr/0022-network-reputation.md) |
| 17        | `SpeechToTextProvider`      | `TRANSCRIPTION=deepgram`    | Transcribes interview recordings on request, as a job            | [0023](adr/0023-transcription.md)      |
| 18        | (in the CATI queue)         | survey calling hours        | Calling hours per time zone and an organization do-not-call list | [0024](adr/0024-calling-rules.md)      |
| 19        | `TelephonyProvider`         | `TELEPHONY=twilio`          | Click-to-call, hidden numbers, call recording                    | [0025](adr/0025-dialer.md)             |

## Security hardening (Milestone 20)

- One network guard (`apps/api/src/common/net-guard.ts`) for every customer-configured outbound call.
- Account lockout, `RevokedSession` (sign-out on the server), `User.sessionsRevokedAt` (sign out
  everywhere), a common-password list, security headers in `bootstrap.ts`, and production settings
  checks in `config.ts`. [ADR 0026](adr/0026-security-hardening.md)

## Passwords (security fixes after the handbook review, PR #36)

- `POST /api/auth/change-password` (current password required) signs out the member's other sessions
  and keeps this one: sessions carry their issue time in milliseconds (`iatMs`) so the new session is
  told apart from those issued earlier in the same second.
- `POST /api/users/:id/password-reset` (admins) creates a one-time link; `POST /api/auth/forgot-password`
  emails one when `EMAIL_PROVIDER` is set and always answers 204; `POST /api/auth/reset-password`
  uses it. Only a SHA-256 hash of the token is stored (`PasswordReset`); a link works once, for
  `PASSWORD_RESET_HOURS`, and a newer link voids older ones. Code: `apps/api/src/auth/password-reset.service.ts`.
- The vendor shared secret is returned only to admins and to super admins signed in with a session, never through an API key (`presentVendor`, `seesVendorSecret`; PR #43).

## Since milestone 20 (merged 2026-11-05 and 2026-11-06)

| PR  | Adds                                                                                                   | ADR                                                  |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| #27 | Quantum Design System: `@zapx/quantum` theme engine with enforced contrast                             | [0027](adr/0027-quantum-design-system.md)            |
| #29 | Neon AI theme (default), sidebar app shell, `GET /api/dashboard` home screen                           | [0028](adr/0028-neon-dashboard.md)                   |
| #30 | Loops, blocks and calculated variables compiled into ordinary pages; question bank                     | [0029](adr/0029-blueprint-core-engineering.md)       |
| #31 | Translation memory and glossary, right-to-left, URL variables, least fill, QA test cases               | [0030](adr/0030-blueprint-multilingual-and-qa.md)    |
| #32 | CAPI evidence and interview areas, supervision, appeals, email distribution                            | [0031](adr/0031-blueprint-fieldwork-and-security.md) |
| #33 | MaxDiff and conjoint (computed designs), recodes, AI research assistant, CAPI video                    | [0032](adr/0032-blueprint-research-intelligence.md)  |
| #34 | Automation rules, data residency and retention, cleaning, chart dashboards, SMS                        | [0033](adr/0033-blueprint-enterprise-scale.md)       |
| #35 | Maintainer handbook in [handbook/](handbook/README.md) (refreshed in #42)                              | —                                                    |
| #36 | Security fixes S1–S3: vendor secret for admins, password change and reset, AWS secret list             | —                                                    |
| #37 | Webcam eye tracking (experimental, opt-in)                                                             | [0034](adr/0034-webcam-eye-tracking.md)              |
| #38 | Integrations (Claude, IPinfo, Deepgram, Twilio, Stripe, S3) set in Settings → Integrations (#28)       | [0035](adr/0035-integrations-in-the-crm.md)          |
| #39 | Neon design on every studio page and the CAPI app                                                      | 0028 addendum                                        |
| #41 | Super admin console: organizations, plans, web and mobile features, live entitlements                  | [0036](adr/0036-super-admin.md)                      |
| #40 | Android and iOS app (`apps/mobile`, Expo), gated by the super admin's mobile features                  | [0037](adr/0037-mobile-app.md)                       |
| #43 | Super admins see the vendor shared secret, never through an API key                                    | —                                                    |
| #44 | Node 26 LTS, Docker `node:26-bookworm-slim` and `nginx:1.31-alpine`                                    | —                                                    |
| #45 | Security fixes S4–S9: shared rate limits, `SIGNING_KEYS_SECRET`, script nonce, more row-level security | —                                                    |
| #46 | Neon confirm dialogs instead of `window.confirm`                                                       | —                                                    |

## Decisions, contracts and operations

- Architecture decisions: [adr/](adr/README.md)
- Vendor API contract: [api/openapi.yaml](api/openapi.yaml)
- CAPI app API contract: [api/capi-openapi.yaml](api/capi-openapi.yaml)
- Database operations (migrations, pooling, backups): [operations/database.md](operations/database.md)
- Security checks and accepted exceptions: [security.md](security.md)

## Security notes

- Session cookie is httpOnly, SameSite=Lax; mutating requests with the cookie also require the
  `x-zapx-csrf` header. API clients can use `Authorization: Bearer`.
- Every studio query is scoped by `tenantId` from the session, and project, survey and vendor lookups
  also by the member's project access. Postgres row-level security on `Response` backs up the
  studio's respondent-data reads, and since PR #45 also `CatiCase`, `CatiCall`, `DoNotCall`, `Contact`,
  `Invitation`, `BackCheck` and `QualityAppeal` (not system paths; see ADR 0012). It only
  applies when the API's database role is not a superuser; check `GET /api/audit/security`.
- Rate limits on login, sign-up and respondent endpoints, shared by every API task through the
  `RateLimitBucket` table (`THROTTLE_STORE=database`, the production default; PR #45), plus
  account lockout after repeated wrong passwords.
- Passwords can be changed by their owner and reset with one-time links (see Passwords above).
- Survey text and piped answers are rendered as text, never HTML.
- Exports neutralize spreadsheet formulas in respondent text.
- Dynamic return URLs must match the vendor's allowed hosts (no open redirects).

## Known limits

- Files are on a shared local disk or in S3 (`FILE_STORE`); the S3 store is tested against a fake S3
  server, not AWS yet. Jobs are polled from PostgreSQL (fine for hundreds an hour).
- AI proposals return a full definition, so very long questionnaires may need to be imported in parts.
- The Claude provider has been tested with a scripted fake; it needs an API key to be exercised live.
- Grid questions are single choice per row. MaxDiff and conjoint exist (PR #33).
- Back navigation is optional per survey and re-shows the previous visible page.
- The fieldwork dashboard and review queue read response rows in the API process; very large
  surveys need SQL aggregates or a reporting store.
- CAPI quotas are only known at sync, so the field can exceed a quota (kept as quota full).
- The CAPI app is a web app (location, consented audio and photos since M12) with no device
  management (MDM) yet.
- Row-level security covers `Response` and `Capture` for studio reads only, and is bypassed by the local
  `docker compose` database role (a superuser). Other tables rely on application filters.
- API keys are role-scoped only (no per-endpoint scopes or IP allow lists).
- CATI has click-to-call and recording through Twilio (M19) and calling rules (M18), but no
  predictive dialing, answering-machine detection or in-browser softphone.
- Media are public by id and served by the API from the file store; no recorded voice-over.
  Transcription of recordings exists (M17); transcription of typed open answers does not.
- Analysis reads rows in the API process (up to 200,000 interviews); weighting exists (M15), but
  nets, banner books and scheduled delivery do not (chart dashboards came in PR #34).
- SSO (OpenID Connect and SAML) has been tested against test providers, not a real one; SAML has
  no single logout or encrypted assertions. SCIM covers users, not groups. Billing (Stripe) is
  tested against a fake Stripe only.
- The AWS Terraform and release script are validated and plan-tested with a mocked provider, not
  applied to an account yet. PROJEXA has been checked against its code, not a deployed PROJEXA.
- Webhooks are organization-wide (no per-project webhooks). Deliveries are kept for
  `WEBHOOK_DELIVERY_RETENTION_DAYS` (30).
- Re-entry with the same UID resumes an unfinished interview. With unsigned links, anyone who knows a
  UID can do this, so vendors handling sensitive studies should use signed entry links.
