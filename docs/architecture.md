# ZAPX architecture (Milestones 1 to 4)

The full plan, including the module map and roadmap, is in the project's
"ZAPX architecture and first milestone" document. This file records what the code does today and
the rules every later module must follow.

## Core rules

1. **One survey definition.** `packages/survey-schema` defines the questionnaire format. Studio,
   API, runtime, QA, and later AI, translation and CAPI read and write this one format. Do not add a
   second questionnaire model.
2. **One logic engine.** `packages/logic-engine` evaluates conditions, validations, terminations and
   quotas. The server, the studio preview and (later) the offline app all call the same functions.
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

## Decisions, contracts and operations

- Architecture decisions: [adr/](adr/README.md)
- Vendor API contract: [api/openapi.yaml](api/openapi.yaml)
- Database operations (migrations, pooling, backups): [operations/database.md](operations/database.md)
- Security checks and accepted exceptions: [security.md](security.md)

## Security notes

- Session cookie is httpOnly, SameSite=Lax; mutating requests with the cookie also require the
  `x-zapx-csrf` header. API clients can use `Authorization: Bearer`.
- Every studio query is scoped by `tenantId` from the session. Postgres row-level security is
  planned before external customers are onboarded.
- Rate limits on login, sign-up and respondent endpoints.
- Survey text and piped answers are rendered as text, never HTML.
- Exports neutralize spreadsheet formulas in respondent text.
- Dynamic return URLs must match the vendor's allowed hosts (no open redirects).

## Known limits

- QA runs and AI proposals run inside the request (up to 2,000 respondents; AI calls can take a
  minute). They move to background jobs when volumes grow.
- AI proposals return a full definition, so very long questionnaires may need to be imported in parts.
- The Claude provider has been tested with a scripted fake; it needs an API key to be exercised live.
- Grid questions are single choice per row; MaxDiff, conjoint, ranking and media questions come later.
- Back navigation is optional per survey and re-shows the previous visible page.
- Exports are generated synchronously; background export jobs come with larger data volumes.
- Re-entry with the same UID resumes an unfinished interview. With unsigned links, anyone who knows a
  UID can do this, so vendors handling sensitive studies should use signed entry links.
