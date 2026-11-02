# 0003 · Redirect & Vendor Integration module, and how ZAPX connects to PROJEXA

Date: 2026-11-01 · Status: Accepted

## Context

PROJEXA's master specification describes a hybrid redirect architecture (eight statuses;
project, country and vendor configuration; dynamic UID, vendor and country parameters; secure
tokens and tracking). The instruction was: inspect PROJEXA first; if an operational redirect
service exists, integrate through its contract and do not duplicate it; otherwise build a
standalone, separable module in ZAPX. Never couple to PROJEXA's database.

**What the inspection found (2026-11-01).** The repository `kunalsharma-ai/Projecxa` is accessible.
Its `main` branch contains only a README. A complete redirect engine exists on open, unmerged pull
request branches (latest `claude/milestone-9-autopilot`); it is not merged and no deployment or
endpoint is known. So there is **no operational PROJEXA redirect service** today. The branch does
document a contract for survey platforms such as ZAPX in `docs/SURVEY_INTEGRATION.md`.

## Decision

1. **ZAPX gets its own Redirect & Vendor Integration module**, for sample sources that send traffic
   to ZAPX directly. It is built for extraction:
   - `packages/redirect-core`: statuses, precedence, URL templates, signing, retry policy and partner
     adapters. No framework, database or network code.
   - `apps/api/src/integrations`: the redirect log, callback outbox and worker, vendor API, and
     `RedirectRepository` (the only class touching its tables).
   - The rest of ZAPX uses only the abstract `RedirectService`.
2. **PROJEXA is integrated through its documented contract, as an adapter** (`projexaAdapter`):
   PROJEXA's session token arrives as the respondent id; at the end ZAPX sends the browser to
   `{base}/r/{status}?token=…` and confirms the outcome with a signed
   `POST {base}/api/v1/s2s/outcome` from the outbox. For PROJEXA traffic ZAPX does **not** resolve
   vendor redirects itself: PROJEXA's engine does, so nothing is duplicated.
3. Same vocabulary as PROJEXA: the eight statuses (`partial` and `technical_error` were added to
   ZAPX), the same precedence (vendor + country > vendor > project + country > project >
   organization), the same callback headers and signing scheme, the same retry schedule.

## Status of the PROJEXA integration

**Not verified against a live PROJEXA.** The adapter is unit-tested and tested end to end against
a mock that implements the documented contract. It becomes "integrated" only after a test respondent
has gone through a running PROJEXA and back. Open questions for PROJEXA: the production base URL,
how client secrets are issued and rotated, and whether `partial` should be sent by the survey
platform or decided by PROJEXA's own session expiry.

## Consequences

- Two paths share one outbox, one log and one set of signing rules.
- If PROJEXA later exposes a redirect service for direct vendors as well, ZAPX can move those
  vendors to PROJEXA by switching their integration, without code changes elsewhere.
