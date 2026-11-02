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

Fraud signals (Milestone 12, [ADR 0018](../adr/0018-fraud-detection-and-capi-capture.md)):

| Flag                  | When                                                                                     | Points  |
| --------------------- | ---------------------------------------------------------------------------------------- | ------- |
| `automation`          | The browser reports that automation software controls it (`navigator.webdriver`)         | 60      |
| `honeypot`            | The hidden field (invisible, not read by screen readers, not in the tab order) is filled | 60      |
| `no_interaction`      | Two or more pages answered with no keyboard, mouse or touch input                        | 30      |
| `open_pasted`         | An open answer was pasted in                                                             | 10 each |
| `same_device`         | Another complete of this survey came from what looks like the same device                | 25      |
| `geo_mismatch`        | The edge network's country is not one of the expected countries                          | 30      |
| `blocked_device`      | The device is on the organization's block list                                           | 60      |
| `blocked_network`     | The network is on the organization's block list                                          | 40      |
| `gps_missing`         | CAPI: the survey requires a location and none was recorded                               | 30      |
| `gps_moved`           | CAPI: the interview ended more than 1 km from where it started                           | 15      |
| `interviewer_overlap` | CAPI: the interviewer recorded another interview at the same time (over 1 minute)        | 40      |

These are signals for a reviewer, not proof. Two identical laptops look like one device; a VPN
changes the country; some people paste answers they wrote elsewhere.

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
| `fraud`               | true    | Browser signals, same device and the block list (Milestone 12).    |
| `countries`           | []      | Expected countries (ISO two-letter); empty uses the vendor's `cc`. |
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

## Block list

When rejecting, tick **also block their device and network**. The response's device and network
hashes are added to the organization's block list (`POST .../quality/decisions` with
`"block": true`). Later completes from them, in any survey, get `blocked_device` or
`blocked_network` and go to review. Administrators see the list under Quality & fieldwork, with the
interview each entry came from, and can unblock (`GET /api/quality/blocks`,
`DELETE /api/quality/blocks/:id`). Blocking never refuses entry: shared networks would lock out
innocent people.

## Country check

Set `GEO_COUNTRY_HEADER` to the header your edge network adds (`cloudfront-viewer-country`,
`cf-ipcountry`). Only do this when respondents can reach the API through that edge alone;
otherwise anyone could send the header. Without it there is no country check. The country (two
letters) is stored with the response as `geoCountry`.

## Privacy

- Network: `HMAC(key, tenantId + ":" + address)`, key derived from `JWT_SECRET`. The address is not
  stored. Rotating `JWT_SECRET` resets same-network detection.
- Open answers: fingerprints are SHA-256 of normalized text, compared only within one survey.
- Device: `HMAC(key, tenantId + user agent + traits)` of coarse browser traits (screen, time zone,
  languages, platform, cores, memory, touch points). The traits are not stored. No canvas, audio or
  font fingerprinting.
- Browser signals: only counts and question ids (pages without input, honeypot hits, which open
  answers were pasted). No keystrokes or text.
