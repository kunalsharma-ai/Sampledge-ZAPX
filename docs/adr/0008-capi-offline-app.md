# 0008: Offline CAPI app with server-side replay

Status: Accepted (Milestone 5)

## Context

Face-to-face interviewers work where connections are poor. They need the questionnaire, routing and
validation on the device, and the data must reach ZAPX exactly once, with the same rules as online
interviews. A device can be lost, have a wrong clock, run an old version or be tampered with.

## Decision

- A separate app, `apps/capi`: an installable web app (Vite + React) with a service worker for the
  app shell and IndexedDB for survey packages and interviews. It runs `@zapx/logic-engine` and
  `@zapx/survey-renderer`, the same code as the hosted runtime and the studio preview. No native app
  yet; the same packages can be wrapped later (Capacitor or React Native) if device features need it.
- A new role, `INTERVIEWER`, is deny-by-default in the API guard: it reaches only endpoints that name
  it (`/api/capi/*` and `/api/auth/me`), never projects, surveys, data or settings.
- Programmers assign interviewers per survey. `GET /api/capi/package` returns the live version of each
  active assignment (definition and presentation).
- `POST /api/capi/sync` takes up to 100 interviews (the app sends 10 per request). For each one the
  server:
  1. stores it at most once, keyed by the device-generated `clientId` (UUID); a retry returns
     `already_synced`, and a `clientId` belonging to someone else is rejected;
  2. replays the answers against the published version the interview was recorded on, page by page,
     and decides the outcome itself (complete, terminate, quality_fail, partial when broken off);
  3. keeps answers that do not fit the version as `technical_error` with the raw answers, so nothing
     an interviewer recorded is lost;
  4. counts quotas atomically at sync; a complete that arrives after its quota filled is kept as
     `quota_full` with reason `quota_full_at_sync:<quota>` (offline interviewers cannot see live
     quotas, and the server never overfills);
  5. scores quality with the same rules as online completes;
  6. clamps device times (no future dates, no more than 180 days back).
- An interview recorded under an assignment that later ended still syncs; one for a survey the
  interviewer was never assigned is rejected.

## Consequences

- Quotas can be exceeded in the field; the data shows which interviews arrived over quota, and the
  client decides whether to keep them.
- The session is the normal 12-hour cookie. An interviewer offline for longer signs in again before
  syncing; interviews stay on the device meanwhile, bound to the interviewer who recorded them.
- Media capture (audio, photos, GPS) and device management are not part of this milestone.
