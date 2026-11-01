# SAMPLEDGE ZAPX

AI-native survey programming, QA, hosting and fieldwork platform.

**Milestone 1 (Foundation)** is a working vertical slice that proves the core architecture end to
end: a programmer builds a survey, passes an automatic logic check, publishes it, and respondents take
it through vendor links with redirects, quotas and data export.

**Milestone 2 (AI programming and QA)** adds the AI Survey Architect, questionnaire file import,
reviewable change sets, and the QA Laboratory.

**Milestone 3 (experience, languages, devices)** adds the Experience Studio (themes), the Global
Language Studio (translations with AI assistance and human review) and device rules.

## What works today

| Area                  | What you can do                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts              | Sign up an organization, sign in, add team members as admin, programmer or viewer                                                                                                                                                                                                                                                                     |
| Projects              | Create projects; each holds surveys and sample vendors                                                                                                                                                                                                                                                                                                |
| Survey Studio         | Build surveys in a structured editor or as JSON; live logic check; in-browser preview on desktop or mobile width                                                                                                                                                                                                                                      |
| Question types        | Single choice, multiple choice (exclusive and anchored options), open text, numeric, single-choice grid, information screens                                                                                                                                                                                                                          |
| Logic                 | Page and question conditions (including same-page "Other, specify"), custom validations, piping `{{Q1}}`, option and row randomization with anchors, terminations, quotas                                                                                                                                                                             |
| Logic check           | Undefined variables, forward references, impossible conditions, unreachable pages, unknown answer codes, duplicate ids and codes, bad ranges, broken piping                                                                                                                                                                                           |
| Publishing            | Immutable published versions; every response records the exact version answered                                                                                                                                                                                                                                                                       |
| Vendors and redirects | Static, dynamic and hybrid redirects per vendor; status words; placeholders; Sampledge platform preset; redirect preview (QA)                                                                                                                                                                                                                         |
| Link security         | Optional HMAC-signed entry links with expiry; duplicate UID protection; signed redirects; dynamic return URLs limited to allowed hosts                                                                                                                                                                                                                |
| Fieldwork control     | Live, paused and closed status; test links that never count toward quotas                                                                                                                                                                                                                                                                             |
| Quotas                | Atomic counting at completion, so quotas cannot overfill under concurrent traffic                                                                                                                                                                                                                                                                     |
| Data                  | CSV and Excel export (codes, one column per option or grid row, codebook sheet, spreadsheet formula-injection protection)                                                                                                                                                                                                                             |
| Audit                 | Append-only audit trail of logins, edits, publishes, vendor changes, links, exports, QA runs and change-set decisions                                                                                                                                                                                                                                 |
| AI Survey Architect   | Build or edit a survey from a typed or dictated instruction plus an optional brief or questionnaire (Word, PDF, text). The AI's answer is validated by the same schema and logic check as a manual edit, with one automatic repair round, and lists the assumptions a programmer should confirm. Needs `ANTHROPIC_API_KEY`                            |
| File import           | The ZAPX Excel/CSV template is imported deterministically with a confidence score and issues per row (download it from the studio). Word, PDF and text questionnaires are read by the AI. Files are checked by content, not just extension, and limited in size                                                                                       |
| Change sets           | AI output, imports and pasted definitions become proposals with a structured diff, data-impact warning, logic check and a 200-respondent QA preview. A programmer applies or rejects them; applying fails if the draft changed since the proposal was made                                                                                            |
| QA Laboratory         | Simulate up to 2,000 synthetic respondents per run on the draft or live version: outcome mix, coverage of pages, questions, options, branches and outcomes, and defects (never shown, constant conditions, impossible completes, stuck pages) with an example respondent. Runs are deterministic per seed, saved, and never touch responses or quotas |

| Experience Studio | Theme presets, brand colours, logo, font, corner radius, spacing, progress style, button labels and motion (always off for respondents who ask for reduced motion), with contrast warnings and a live preview at desktop, tablet and phone width. Presentation only: it cannot change questions, codes or logic |
| Languages | Add any number of languages; translate by hand or with AI (marked "AI, to review"); every text shows missing, outdated, AI or reviewed status, and broken `{{piping}}` is flagged. A language is offered to respondents only when enabled, and publishing is blocked until every enabled language is complete and reviewed. Validation messages, buttons and end messages are translated too |
| Respondent language | Chosen from the link (`&lang=fr`), else the browser's language, else the source; respondents can switch mid-survey without losing answers. Answer codes are identical in every language |
| Devices | Each interview records desktop, tablet or phone. Surveys can exclude device types (screened out before a response is created, redirected as terminate). Grids show as cards or a scrolling table on narrow screens. Language and device are in the exports |

Not yet built (later milestones): voice-over and transcription, rich media and custom animations, CAPI and CATI apps, fraud scoring, analytics dashboards, SSO and billing. See
[docs/architecture.md](docs/architecture.md).

## Repository layout

```
apps/
  api/        NestJS modular monolith (REST API under /api)
  studio/     Next.js studio for programmers, PMs and admins (port 3000)
  runtime/    Respondent-facing survey runtime, Vite + React (port 5173)
packages/
  survey-schema/    Canonical survey definition (Zod) – the single source of truth
  logic-engine/     Expression language, routing, validation, static analysis
  survey-renderer/  Question components shared by runtime and studio preview
  db/               Prisma schema, migrations and seed
e2e/          Playwright acceptance test through the real UI
docs/         Architecture notes and example surveys
```

## Running locally

Requirements: Node 22, pnpm 10, PostgreSQL 16 (or Docker).

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d   # or point DATABASE_URL at your own Postgres
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
```

Open http://localhost:3000, sign in, create a project, add a vendor (try **+ Sampledge preset**),
create a survey, paste [docs/examples/demo-screener.json](docs/examples/demo-screener.json) into the
JSON tab, publish, and generate a link under **Links & status**.

To enable the AI Survey Architect, set `ANTHROPIC_API_KEY` in `.env` (and optionally `AI_MODEL`,
default `claude-opus-5-5`) and restart the API. Without a key the AI panel says AI is not configured
and every other feature, including template import and the QA lab, works as normal. Voice dictation
uses the browser's speech recognition (Chrome, Edge, Safari).

## Tests

```bash
pnpm test     # schema, logic engine, API integration tests (needs the database)
pnpm e2e      # full-stack Playwright acceptance test (starts the apps if not running)
```

CI (`.github/workflows/ci.yml`) runs build, type checks, migrations, all tests and the end-to-end test
against a PostgreSQL service on every pull request.

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
`sig = HMAC-SHA256(secret, sorted query string without sig)`; see
[apps/api/src/vendors/redirects.ts](apps/api/src/vendors/redirects.ts).
