# SAMPLEON integration

SAMPLEON is the Sampledge audience, invitation and routing engine (repository
`kunalsharma-ai/Sampleon`, design in its `docs/ECOSYSTEM_ARCHITECTURE.md`). In the ecosystem:

- **ZAPX** programs, hosts and runs the survey, records the outcome and confirms it.
- **SAMPLEON** decides who is invited and when, counts quotas, and routes a respondent onward.
- **SUPPLY360** owns the respondents; **PROJEXA** owns projects when there is one.

ZAPX keeps no respondent list, no invitation engine and no second quota service for SAMPLEON
traffic. It keeps one `SampleonAudienceRequest` row per request so the studio can show progress.

## Two workflows

|                       | PROJEXA-linked survey                                                             | Independent ZAPX survey                                   |
| --------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Who asks SAMPLEON     | PROJEXA, with the launch URL from `POST /api/surveys/{id}/sampleon/connect`       | ZAPX: `POST /api/surveys/{id}/sampleon/audience-requests` |
| `source.platform`     | `PROJEXA`                                                                         | `ZAPX` (`source.projectId` = ZAPX project id)             |
| Progress events go to | PROJEXA                                                                           | ZAPX (`POST /api/v1/sampleon/events`)                     |
| Respondent path       | card → SAMPLEON `/go` → `{runtime}/s/{survey}?vid=SAMPLEON&uid={token}` → outcome | same                                                      |

## In the studio

A survey's **Distribute** tab has a **SAMPLEON audiences** panel: **Connect to SAMPLEON** creates
the project's SAMPLEON vendor and shows the survey ID and launch link to paste into the PROJEXA
project's SAMPLEON tab; the form beside it asks SAMPLEON for an audience for this survey on its
own (description, countries, completes, incidence, LOI, reward, fieldwork dates, language,
routing); the table lists every request for the survey, PROJEXA's included, with status and
SAMPLEON completes.

## Survey-host contract

The project's `SAMPLEON` vendor (created by `connect` or the first request, integration
`SAMPLEON`) uses the PROJEXA adapter in `packages/redirect-core`: the browser goes back to
`{SAMPLEON}/r/{status}?token=…` and the outcome is confirmed by
`POST {SAMPLEON}/api/v1/s2s/outcome` with `HMAC-SHA256(outcome secret, token.status.timestamp)`,
through the callback outbox with retries. SAMPLEON counts a complete only after that confirmation
and decides any routing.

## Requests and events

`POST /api/surveys/{id}/sampleon/audience-requests` (admins and programmers):

```json
{
  "countries": ["US"],
  "requiredCompletes": 300,
  "expectedIncidence": 0.4,
  "loiMinutes": 15,
  "reward": { "points": 500 },
  "fieldwork": { "start": "2026-11-10", "end": "2026-12-10" },
  "targeting": { "naturalLanguage": "Cardiologists with at least five years of professional experience" }
}
```

`targeting.criteria` and `quotas` in SAMPLEON's format may be sent instead of, or with, the
description. SAMPLEON drafts criteria from a description; nothing is sent to respondents until a
person approves in SAMPLEON. `GET /api/surveys/{id}/sampleon` lists the requests and the launch
URL.

SAMPLEON's events are signed (`X-Sampledge-*`, client `sampleon`, `SAMPLEON_CLIENT_SECRET`) over
the raw body, deduplicated by `eventId`, and move the row through `submitted → feasibility_ready →
approved → soft_launch/live → closed`, with completes and the latest `project.quota_updated`
snapshot (by `sequence`).

## Settings

`SAMPLEON_URL`, `SAMPLEON_CLIENT_ID` (default `zapx`), `SAMPLEON_CLIENT_SECRET`,
`SAMPLEON_OUTCOME_SECRET` (see `.env.example`).

## Tests

`packages/redirect-core/src/redirect.test.ts` (adapter and signature vectors shared with
`@sampledge/contracts`), `apps/api/test/sampleon.test.ts`, and SAMPLEON's `e2e/ecosystem/run.mjs`,
which runs both workflows with ZAPX, SAMPLEON, SUPPLY360 and PROJEXA together.
