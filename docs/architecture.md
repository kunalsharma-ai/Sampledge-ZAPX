# ZAPX architecture (Milestone 1)

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
5. The vendor redirect is resolved by `RedirectService` (static, dynamic or hybrid).

## Swappable redirect service

The interview flow depends on the abstract `RedirectService`
(`apps/api/src/vendors/redirect.service.ts`). `LocalRedirectService` is today's implementation. If
Sampledge builds a shared redirect service for PROJEXA and the marketplace, ZAPX switches by
providing a different implementation; nothing else changes.

## Security notes

- Session cookie is httpOnly, SameSite=Lax; mutating requests with the cookie also require the
  `x-zapx-csrf` header. API clients can use `Authorization: Bearer`.
- Every studio query is scoped by `tenantId` from the session. Postgres row-level security is
  planned before external customers are onboarded.
- Rate limits on login, sign-up and respondent endpoints.
- Survey text and piped answers are rendered as text, never HTML.
- Exports neutralize spreadsheet formulas in respondent text.
- Dynamic return URLs must match the vendor's allowed hosts (no open redirects).

## Known limits of Milestone 1

- Grid questions are single choice per row; MaxDiff, conjoint, ranking and media questions come later.
- One language per survey.
- Back navigation is optional per survey and re-shows the previous visible page.
- Exports are generated synchronously; background export jobs come with larger data volumes.
- Re-entry with the same UID resumes an unfinished interview. With unsigned links, anyone who knows a
  UID can do this, so vendors handling sensitive studies should use signed entry links.
