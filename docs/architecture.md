# ZAPX architecture (Milestones 1 to 9)

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
  studio's respondent-data reads (not system paths, and not other tables yet; see ADR 0012). It only
  applies when the API's database role is not a superuser; check `GET /api/audit/security`.
- Rate limits on login, sign-up and respondent endpoints.
- Survey text and piped answers are rendered as text, never HTML.
- Exports neutralize spreadsheet formulas in respondent text.
- Dynamic return URLs must match the vendor's allowed hosts (no open redirects).

## Known limits

- Background files are stored on a local disk shared by the API and the worker. The S3 store is
  designed for but not built; jobs are polled from PostgreSQL (fine for hundreds an hour).
- AI proposals return a full definition, so very long questionnaires may need to be imported in parts.
- The Claude provider has been tested with a scripted fake; it needs an API key to be exercised live.
- Grid questions are single choice per row; MaxDiff, conjoint, ranking and media questions come later.
- Back navigation is optional per survey and re-shows the previous visible page.
- The fieldwork dashboard and review queue read response rows in the API process; very large
  surveys need SQL aggregates or a reporting store.
- CAPI quotas are only known at sync, so the field can exceed a quota (kept as quota full).
- The CAPI app is a web app: no audio, photo or GPS capture, and no device management yet.
- Row-level security covers `Response` for studio reads only, and is bypassed by the local
  `docker compose` database role (a superuser). Other tables rely on application filters.
- API keys are role-scoped only (no per-endpoint scopes or IP allow lists).
- CATI has no dialer, call recording, time-zone calling windows or do-not-call list.
- Analysis is unweighted, reads rows in the API process (up to 200,000 interviews) and has no
  nets, banner books, charts or scheduled delivery yet.
- SSO is OpenID Connect only (no SAML) and has been tested against a mock provider, not a real one.
  SCIM covers users, not groups. Plans have no billing or self-service changes.
- Webhooks are organization-wide (no per-project webhooks). Deliveries are kept for
  `WEBHOOK_DELIVERY_RETENTION_DAYS` (30).
- Re-entry with the same UID resumes an unfinished interview. With unsigned links, anyone who knows a
  UID can do this, so vendors handling sensitive studies should use signed entry links.
