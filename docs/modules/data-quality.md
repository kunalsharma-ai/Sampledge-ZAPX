# Data quality module

Owner: maintainer (see `.github/CODEOWNERS`) · Decision: [ADR 0007](../adr/0007-data-quality.md)

## What it owns

- The quality score (0 to 100) and its reasons for every complete, online and CAPI.
- In-survey quality rejects (`quality_fail` before a quota place is taken).
- The review queue: people accept or reject flagged completes.
- The fieldwork dashboard: outcomes, incidence, length of interview, drop-off, quality, per vendor and
  per interviewer.

## Code

| Part     | Path                                                               | Notes                                                             |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Core     | `packages/quality-core`                                            | Pure TypeScript: checks, score, decision, fieldwork metrics.      |
| Settings | `packages/survey-schema` (`settings.quality`, `qualitySettingsOf`) | Versioned with the survey; logic-checked by `@zapx/logic-engine`. |
| Service  | `apps/api/src/quality/quality.service.ts`                          | Median, fingerprints, network hash, review decisions, fieldwork.  |
| API      | `apps/api/src/quality/quality.controller.ts`                       | `/api/surveys/:id/quality`, `/quality/decisions`, `/fieldwork`.   |
| Studio   | `apps/studio/components/Quality.tsx`                               | Quality & fieldwork tab.                                          |

## Checks and points

| Flag              | When                                                                                  | Points     |
| ----------------- | ------------------------------------------------------------------------------------- | ---------- |
| `speeder_hard`    | Faster than `minSeconds`                                                              | 60         |
| `speeder`         | Faster than `speederRatio` × median length of earlier completes (needs 20)            | 35         |
| `straightline`    | Same column in every row of a grid with at least `straightlineMinRows` rows           | 15 each    |
| `open_gibberish`  | Repeated characters or words, keyboard runs, no vowels (Latin script)                 | 20 each    |
| `open_low_effort` | One character, punctuation only, or answers such as "ok", "idk", "n/a"                | 5 each     |
| `open_duplicate`  | The same open answer (normalized, 25+ characters) as another respondent in the survey | 25 each    |
| `same_network`    | Another complete of this survey came from the same network                            | 20         |
| `check_failed`    | A survey-specific check's condition is true (e.g. `ATTN != 3`)                        | its weight |

Score = 100 − points, never below 0. Length of interview is the time on answered pages, with each
page capped at 30 minutes; time away from a resumed interview is not counted.

## Settings (`settings.quality`)

| Setting               | Default | Meaning                                                            |
| --------------------- | ------- | ------------------------------------------------------------------ |
| `enabled`             | true    | Score completes. Off: no score, no queue, no in-survey rejects.    |
| `minSeconds`          | none    | Hard speeder floor.                                                |
| `speederRatio`        | 0.4     | Relative speeder threshold.                                        |
| `straightlineMinRows` | 5       | Grids smaller than this are not checked.                           |
| `openEnds`            | true    | Open-answer checks and fingerprints.                               |
| `sameNetwork`         | true    | Same-network check (keyed hash only).                              |
| `checks`              | []      | `{id, condition, label?, weight}` in the logic language.           |
| `reviewBelow`         | 70      | Completes below this wait for review.                              |
| `rejectBelow`         | 0       | Completes below this end as `quality_fail` in the survey; 0 = off. |

## Review decisions

`POST /api/surveys/:id/quality/decisions` with `{responseIds, decision: "accept" | "reject", note?}`
(admins and programmers). Rejecting a complete:

1. sets status `quality_fail`, reason `quality_review`, review state `rejected`, with reviewer and note;
2. releases its place in every quota it counted toward;
3. queues a `quality_fail` callback for the vendor if the vendor subscribes to that status;
4. writes `quality.reject` to the audit log.

A rejection cannot be undone. Test respondents are scored but never enter the queue and are never
compared with real respondents.

## Privacy

- Network: `HMAC(key, tenantId + ":" + address)`, key derived from `JWT_SECRET`. The address is not
  stored. Rotating `JWT_SECRET` resets same-network detection.
- Open answers: fingerprints are SHA-256 of normalized text, compared only within one survey.
