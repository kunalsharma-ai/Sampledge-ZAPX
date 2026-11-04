# ADR 0031: Blueprint phase 3, fieldwork evidence, supervision, appeals and email distribution

Status: accepted (2026-11-04)

## Context

Phase 3 of the ZAPX blueprint asks for fieldwork and security depth: CAPI geofencing, question
timestamps, signatures, barcode/QR, an interruption log, back-checks and supervisor verification, a
supervisor dashboard with a map, quality appeals, and distribution (contacts, invitations, schedules,
reminders). The blueprint forbids fake integrations and untested parity claims.

## Decision

1. **Evidence is recorded on the device and judged on the server.** The CAPI app records when each
   page was shown and for how long, and every interruption (app hidden for 2 s or more, or the new
   Pause button). Interruption time is left out of page time. The upload carries both; the server keeps
   only pages of the survey, stores them as `Response.evidence`, and checks the start location against
   the survey's interview areas itself (`checkGeofence`, shared with the app, which only warns).
2. **Interview areas are circles in the CAPI settings** (`settings.capi.geofences`, up to 50). GPS
   accuracy counts in the interviewer's favour, capped at 1 km. Outside every area, or no location while
   areas are set, adds the `outside_geofence` quality flag (penalty 30). More than 5 interruptions or
   over 15 minutes adds `interrupted` (penalty 10). Flags go to review; nothing is thrown away.
3. **Signature and barcode are question types.** A signature is stored as strokes on a 1000 x 400 grid
   (`x,y x,y;...`), validated by a strict pattern and shown back as SVG in the review queue; exports carry
   only signed 1/0. It is not a qualified electronic signature and the editor says so. A barcode is text,
   checked against an optional pattern; scanning uses the browser's `BarcodeDetector` where it exists,
   typing everywhere else.
4. **Back-checks reuse the review decision.** Supervisors draw a share of each interviewer's completes
   (cryptographic shuffle, never the same interview twice). A failed back-check calls the quality
   service's reject path, so quotas are released and webhooks fire exactly as for a reviewer's reject.
5. **Appeals reinstate through quotas.** An interviewer appeals a quality-failed interview once, from the
   app. Overturning reinstates it as a complete only if each matching quota still has room (the same
   conditional update as at sync); otherwise the supervisor is told which quota is full.
6. **The supervisor dashboard is computed, never estimated**, from synced interviews: completes vs
   assignment targets, per-interviewer productivity, median length, quality, exceptions, interruptions
   and back-check results, a 14-day completes chart, and a map. The map plots start points and areas to
   scale in SVG without map tiles, so no location is sent to a map provider.
7. **Email distribution uses ordinary links.** Invitations enter through a built-in project source
   (`ZAPX_EMAIL`) with a random `inv-` respondent id, so interviews, quotas and quality checks are the same
   as any respondent's. Contact columns become link parameters (URL variables); reserved parameters are
   refused. Waves are scheduled; the job worker sends due waves in batches of 50 and reminds only people
   whose response is not finished. Every email has a one-click unsubscribe link (RFC 8058 header and a
   page whose button, not the link itself, unsubscribes, so link scanners do not opt people out).
8. **Sending is off by default.** `EMAIL_PROVIDER=sendgrid` sends through SendGrid's v3 Mail Send API
   from `EMAIL_FROM`; with it off, waves wait and the page says so, and personal links can be
   downloaded as CSV for another tool. The SendGrid adapter is tested against a local stand-in only.
   Once PR #28 (integrations in the CRM) merges, the email keys move to that registry like the others.

## Consequences

- Five new tables (`BackCheck`, `QualityAppeal`, `Contact`, `Distribution`, `Invitation`) and one
  column (`Response.evidence`), migration `20261114000000_blueprint_p3`.
- The survey tab "Links & status" is now "Distribution".
- Not built in this phase: consented video capture (moves to P4 with the webcam work), SMS invitations,
  map tiles, per-interviewer daily targets.
- Tests: `logic-engine/src/fieldwork.test.ts`, `quality-core/src/fraud.test.ts`,
  `apps/api/test/blueprint3.test.ts` (8 tests), `e2e/tests/blueprint3.spec.ts`.
