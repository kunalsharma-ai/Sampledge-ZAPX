# SAMPLEDGE ZAPX

AI-native survey programming, QA, hosting and fieldwork platform.

**Milestone 1 (Foundation)** is a working vertical slice that proves the core architecture end to
end: a programmer builds a survey, passes an automatic logic check, publishes it, and respondents take
it through vendor links with redirects, quotas and data export.

**Milestone 2 (AI programming and QA)** adds the AI Survey Architect, questionnaire file import,
reviewable change sets, and the QA Laboratory.

**Milestone 3 (experience, languages, devices)** adds the Experience Studio (themes), the Global
Language Studio (translations with AI assistance and human review) and device rules.

**Milestone 4 (foundation hardening)** adds the separable Redirect & Vendor Integration module
(eight outcomes, vendor/country/project/organization rules, signed callbacks with retries, redirect
and delivery logs, an authenticated vendor API), a PROJEXA adapter built on PROJEXA's documented
contract (not yet tested against a live PROJEXA), the AI gateway (per-task models, permissions,
limits, cost tracking, redaction), soft delete, Docker images and a full `docker compose` stack,
and the governance set: ESLint, Prettier, ADRs, CodeQL, Dependabot and a dependency audit in CI.

**Milestone 5 (data quality and face-to-face interviewing)** adds quality scoring of every complete
with reasons, a review queue where people accept or reject flagged completes (releasing quotas and
telling vendors), optional in-survey quality rejects, a fieldwork dashboard, team management with an
interviewer role, and the offline CAPI interviewer app with server-checked sync.

**Milestone 6 (enterprise access and API)** adds project-level access (members who only see assigned
projects), role changes that apply at once, organization API keys, signed outbound webhooks, an audit
log viewer with CSV export, and PostgreSQL row-level security on respondent data for the studio's
reads.

## What works today

| Area                  | What you can do                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts              | Sign up an organization, sign in, add team members as admin, programmer or viewer                                                                                                                                                                                                                                                                                                                                                          |
| Projects              | Create projects; each holds surveys and sample vendors                                                                                                                                                                                                                                                                                                                                                                                     |
| Survey Studio         | Build surveys in a structured editor or as JSON; live logic check; in-browser preview on desktop or mobile width                                                                                                                                                                                                                                                                                                                           |
| Question types        | Single choice, multiple choice (exclusive and anchored options), open text, numeric, single-choice grid, information screens                                                                                                                                                                                                                                                                                                               |
| Logic                 | Page and question conditions (including same-page "Other, specify"), custom validations, piping `{{Q1}}`, option and row randomization with anchors, terminations, quotas                                                                                                                                                                                                                                                                  |
| Logic check           | Undefined variables, forward references, impossible conditions, unreachable pages, unknown answer codes, duplicate ids and codes, bad ranges, broken piping                                                                                                                                                                                                                                                                                |
| Publishing            | Immutable published versions; every response records the exact version answered                                                                                                                                                                                                                                                                                                                                                            |
| Vendors and redirects | Static, dynamic and hybrid redirects per vendor; status words; placeholders; Sampledge platform preset; redirect preview (QA)                                                                                                                                                                                                                                                                                                              |
| Link security         | Optional HMAC-signed entry links with expiry; duplicate UID protection; signed redirects; dynamic return URLs limited to allowed hosts                                                                                                                                                                                                                                                                                                     |
| Fieldwork control     | Live, paused and closed status; test links that never count toward quotas                                                                                                                                                                                                                                                                                                                                                                  |
| Quotas                | Atomic counting at completion, so quotas cannot overfill under concurrent traffic                                                                                                                                                                                                                                                                                                                                                          |
| Data                  | CSV and Excel export (codes, one column per option or grid row, codebook sheet, spreadsheet formula-injection protection)                                                                                                                                                                                                                                                                                                                  |
| Audit                 | Append-only audit trail of logins, edits, publishes, vendor changes, links, exports, QA runs and change-set decisions                                                                                                                                                                                                                                                                                                                      |
| AI Survey Architect   | Build or edit a survey from a typed or dictated instruction plus an optional brief or questionnaire (Word, PDF, text). The AI's answer is validated by the same schema and logic check as a manual edit, with one automatic repair round, and lists the assumptions a programmer should confirm. Needs `ANTHROPIC_API_KEY`                                                                                                                 |
| File import           | The ZAPX Excel/CSV template is imported deterministically with a confidence score and issues per row (download it from the studio). Word, PDF and text questionnaires are read by the AI. Files are checked by content, not just extension, and limited in size                                                                                                                                                                            |
| Change sets           | AI output, imports and pasted definitions become proposals with a structured diff, data-impact warning, logic check and a 200-respondent QA preview. A programmer applies or rejects them; applying fails if the draft changed since the proposal was made                                                                                                                                                                                 |
| QA Laboratory         | Simulate up to 2,000 synthetic respondents per run on the draft or live version: outcome mix, coverage of pages, questions, options, branches and outcomes, and defects (never shown, constant conditions, impossible completes, stuck pages) with an example respondent. Runs are deterministic per seed, saved, and never touch responses or quotas                                                                                      |
| Experience Studio     | Theme presets, brand colours, logo, font, corner radius, spacing, progress style, button labels and motion (always off for respondents who ask for reduced motion), with contrast warnings and a live preview at desktop, tablet and phone width. Presentation only: it cannot change questions, codes or logic                                                                                                                            |
| Languages             | Add any number of languages; translate by hand or with AI (marked "AI, to review"); every text shows missing, outdated, AI or reviewed status, and broken `{{piping}}` is flagged. A language is offered to respondents only when enabled, and publishing is blocked until every enabled language is complete and reviewed. Validation messages, buttons and end messages are translated too                                               |
| Respondent language   | Chosen from the link (`&lang=fr`), else the browser's language, else the source; respondents can switch mid-survey without losing answers. Answer codes are identical in every language                                                                                                                                                                                                                                                    |
| Devices               | Each interview records desktop, tablet or phone. Surveys can exclude device types (screened out before a response is created, redirected as terminate). Grids show as cards or a scrolling table on narrow screens. Language and device are in the exports                                                                                                                                                                                 |
| Outcomes              | Eight outcomes shared with PROJEXA: complete, terminate, quota full, quality fail, security reject, duplicate, partial (abandoned, after 24 h by default) and technical error                                                                                                                                                                                                                                                              |
| Redirect rules        | Per vendor, per vendor and country, per project, per project and country, and per organization; the most specific wins. Redirect QA by country shows which rule applies                                                                                                                                                                                                                                                                    |
| Callbacks             | Signed server-to-server callbacks per vendor and outcome, queued in an outbox: retried with backoff, dead-lettered, retried by hand from the studio, never sent twice and never for test respondents                                                                                                                                                                                                                                       |
| Logs                  | Redirect log (every outcome redirect and the rule that produced it) and callback delivery log per vendor                                                                                                                                                                                                                                                                                                                                   |
| Vendor API            | `GET /api/v1/vendor/outcomes` for reconciliation, authenticated with HMAC signatures ([contract](docs/api/openapi.yaml))                                                                                                                                                                                                                                                                                                                   |
| PROJEXA               | PROJEXA vendors: respondents return to PROJEXA's `/r/{status}?token=` and outcomes are confirmed with PROJEXA's signed S2S call. Built from PROJEXA's documentation and tested against a mock, **not yet against a live PROJEXA**                                                                                                                                                                                                          |
| AI governance         | Organization AI settings: on/off per task, requests per minute and day, monthly budget, PII redaction; usage and estimated cost per task and model; circuit breaker; every call audited                                                                                                                                                                                                                                                    |
| Data quality          | Every complete gets a 0–100 score with reasons: hard and relative speeding, straightlining, gibberish or very short open answers, open answers copied from another respondent, several completes from one network (keyed hash, the address is never stored), and survey-specific checks in the logic language (e.g. attention checks). Settings are part of the survey and published with it                                               |
| Review queue          | Completes below the review threshold wait for a person, with the reasons and the open answers. Accept, or reject: the complete becomes quality fail, its quota place is released, the vendor is told, and the decision is audited. Optional automatic quality fail inside the survey below a second threshold                                                                                                                              |
| Fieldwork dashboard   | Starts, completes, incidence, median length of interview, average quality and pending reviews, per vendor and per interviewer, and where unfinished interviews stopped. Length of interview, mode, interviewer, score, flags and review state are in the exports                                                                                                                                                                           |
| Team                  | Administrators add team members as admin, programmer, viewer or interviewer (Settings → Team). Interviewers can only use the CAPI app                                                                                                                                                                                                                                                                                                      |
| CAPI (face to face)   | Assign interviewers to a survey. The interviewer app (installable, works offline) downloads the live version, runs interviews with the same engine, saves after every page, lets an interview be resumed or ended early, and syncs when online. The server re-checks every interview against its version, counts quotas (interviews arriving after a quota filled are kept as quota full), scores quality and never stores an upload twice |
| Project access        | Programmers and viewers can be limited to assigned projects (Settings → Team, then Project access on each project). Everything outside their projects is hidden, including data and exports. Role and access changes apply immediately                                                                                                                                                                                                     |
| API keys              | Create keys for scripts and integrations (shown once, stored hashed, optional expiry, revoke at once). A key acts as its creator with at most programmer rights and sees the same projects; its changes are audited as "via API key" ([guide](docs/modules/access-and-api-keys.md))                                                                                                                                                        |
| Webhooks              | Signed JSON events to your endpoint: response finished, review decided, survey published, survey status changed. Retries with backoff, delivery log, test event, redeliver, secret rotation. No answers in payloads ([guide](docs/modules/webhooks.md))                                                                                                                                                                                    |
| Audit log viewer      | Settings → Audit log: filter the organization's audit trail by action, entity, member and time; page through it and download CSV                                                                                                                                                                                                                                                                                                           |
| Row-level security    | PostgreSQL policy on respondent data: the studio's reads of responses, exports, review queue and fieldwork run scoped to the organization in the database too. Applies when the API's database role is not a superuser ([details](docs/adr/0012-row-level-security.md))                                                                                                                                                                    |
| Deletion              | Projects, surveys and vendors are soft-deleted: they disappear and their links stop working, history is kept                                                                                                                                                                                                                                                                                                                               |

Not yet built (later milestones): voice-over and transcription, rich media and custom animations, CATI, audio/photo/GPS capture in CAPI, advanced fraud detection (device fingerprinting, AI open-end review), analytics dashboards beyond fieldwork, SSO/SCIM and billing. See
[docs/architecture.md](docs/architecture.md).

## Repository layout

```
apps/
  api/        NestJS modular monolith (REST API under /api)
  studio/     Next.js studio for programmers, PMs and admins (port 3000)
  runtime/    Respondent-facing survey runtime, Vite + React (port 5173)
  capi/       Offline interviewer (CAPI) app, Vite + React, installable (port 5174)
packages/
  survey-schema/    Canonical survey definition (Zod) – the single source of truth
  logic-engine/     Expression language, routing, validation, static analysis
  survey-renderer/  Question components shared by runtime and studio preview
  redirect-core/    Redirect & Vendor Integration core (no framework; extractable)
  quality-core/     Data quality checks, score and fieldwork metrics (no framework)
  db/               Prisma schema, migrations and seed
e2e/          Playwright acceptance tests through the real UI
docs/         Architecture, ADRs, module docs, API contract, operations, examples
infra/        nginx config, backup and restore scripts
```

## Running locally

Requirements: Node 22, pnpm 10, PostgreSQL 16 (or Docker).

**Everything in containers** (no Node needed): `docker compose up --build`, then open
http://localhost:3000 (studio), http://localhost:5173 (respondent runtime) and
http://localhost:5174 (interviewer app).

**For development:**

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres   # or point DATABASE_URL at your own Postgres
pnpm build
pnpm db:migrate
pnpm db:seed          # creates admin@zapx.local / zapx-admin-123
```

Then start the three apps (each in its own terminal, or `pnpm dev` for all):

```bash
set -a; . ./.env; set +a
node apps/api/dist/main.js               # API on :4000
pnpm --filter @zapx/studio start         # Studio on :3000
pnpm --filter @zapx/runtime preview      # Respondent runtime on :5173
pnpm --filter @zapx/capi preview         # Interviewer (CAPI) app on :5174
```

Open http://localhost:3000, sign in, create a project, add a vendor (try **+ Sampledge preset**),
create a survey, paste [docs/examples/demo-screener.json](docs/examples/demo-screener.json) into the
JSON tab, publish, and generate a link under **Links & status**. To try face-to-face interviewing,
add a team member with the interviewer role (Settings → Team), assign them under the survey's
**Interviewers** tab, and sign in as them at http://localhost:5174.

To enable AI, set `ANTHROPIC_API_KEY` and `AI_MODEL` in `.env` (`.env.example` suggests
`claude-opus-5-5`; `AI_MODEL_ARCHITECT` and `AI_MODEL_TRANSLATE` override it per task) and restart
the API. No model id is built into the code. Without a key the AI panel says AI is not configured
and every other feature, including template import and the QA lab, works as normal. Voice dictation
uses the browser's speech recognition (Chrome, Edge, Safari).

## Tests and quality checks

Every check runs on your own machine with one command. GitHub Actions is not required:

```bash
pnpm check              # install, format, lint, build, typecheck, migrations, tests, audit, e2e, Docker images
pnpm check --quick      # format, lint, build, typecheck and unit/API tests only (a few minutes)
pnpm check --no-docker  # everything except the Docker image build
```

It needs a database at `DATABASE_URL` (from `.env`) and, for the last step, Docker; without Docker
the image build is skipped with a note. Run `pnpm check` before merging a pull request.

The same steps are in [.github/workflows/ci.yml](.github/workflows/ci.yml) and run automatically on
pull requests if GitHub Actions is enabled for the repository, together with CodeQL. Nothing depends
on that. See [ADR 0006](docs/adr/0006-engineering-governance.md).

## Survey links and redirects

Vendors send respondents to:

```
https://<runtime-host>/s/<surveyId>?vid=<VENDOR_CODE>&uid=<RESPONDENT_ID>[&cc=US][&rurl=<return url>][&exp=..&sig=..]
```

At the end ZAPX redirects according to the vendor's mode:

- **Static** – fixed URL per status, e.g. the Sampledge preset
  `https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]` with status words
  `complete`, `terminate`, `overquota`, `security`.
- **Dynamic** – the vendor passes a return URL on the entry link (`rurl` by default). It is only
  used if its host is on the vendor's allowed list. `[STATUS]` is appended if missing.
- **Hybrid** – dynamic when a valid return URL was passed, otherwise static.

Placeholders: `[UID] [VID] [CC] [STATUS] [RID] [param:name]`. Signed entry links use
`sig = HMAC-SHA256(secret, sorted query string without sig)`. Rule precedence, callbacks, signing,
the vendor API and the PROJEXA adapter are documented in
[docs/modules/redirects.md](docs/modules/redirects.md).
