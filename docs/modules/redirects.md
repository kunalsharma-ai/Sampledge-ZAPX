# Redirect & Vendor Integration module

Owner: maintainer (see `.github/CODEOWNERS`) · Decision: [ADR 0003](../adr/0003-redirect-and-vendor-integration.md)

## What it owns

- Where a respondent goes when the interview ends, for each of the eight outcomes.
- Server-to-server callbacks (postbacks) to sample sources, with retries and a dead letter.
- The redirect log and the callback delivery log.
- The partner-facing vendor API (`/api/v1/vendor/...`, contract in [openapi.yaml](../api/openapi.yaml)).
- Partner adapters: `DIRECT` and `PROJEXA`.

## Code

| Part        | Path                                                                                                 | Notes                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Core        | `packages/redirect-core`                                                                             | Pure TypeScript, no framework or database.                                                       |
| Service     | `apps/api/src/integrations/redirect.service.ts`                                                      | `RedirectService` is the only thing the interview flow uses.                                     |
| Data access | `apps/api/src/integrations/redirect.repository.ts`                                                   | The only class touching `RedirectEvent`, `OutboundCallback` and vendor/project/org rule columns. |
| Worker      | `apps/api/src/integrations/callback.worker.ts`                                                       | Delivers the outbox; records abandoned interviews as partial.                                    |
| Vendor API  | `apps/api/src/integrations/vendor-api.controller.ts`                                                 | HMAC-authenticated.                                                                              |
| Studio API  | `apps/api/src/integrations/integrations.controller.ts`, `apps/api/src/vendors/vendors.controller.ts` |                                                                                                  |

## Outcomes

`complete`, `terminate`, `quota_full`, `quality_fail`, `security_reject`, `duplicate`, `partial`
(no activity for `ABANDON_AFTER_MINUTES`, default 24 h), `technical_error` (an unexpected server
error ended the interview; the error id is stored as the reason).

## Direct vendors

**Precedence.** For each outcome, the URL comes from the first level that defines one:
vendor + country › vendor › project + country › project › organization. If no level defines a URL
for the outcome, the same search runs for its fallback status (duplicate → security reject;
quality fail, partial, technical error → terminate). Status words are resolved the same way and
always belong to the real outcome.

**Modes.** Static (fixed URLs), dynamic (a return URL passed on the entry link, accepted only for the
vendor's allowed hosts), hybrid (dynamic when present, else static).

**Placeholders.** `[UID] [VID] [CC] [STATUS] [RID] [param:name]`, URL-encoded on substitution.

**Signed redirects.** Optional: ZAPX appends `zts` (unix seconds) and
`zsig = hex HMAC-SHA256(vendor secret, URL up to and including zts)`.

**Signed entry links.** Optional: `sig = hex HMAC-SHA256(vendor secret, sorted query without sig)`,
optional `exp` (unix seconds).

**Callbacks.** For the outcomes the vendor selects, ZAPX sends `GET <callback URL template>` with:

| Header              | Value                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `X-Idempotency-Key` | `<responseId>:<status>`, identical on every retry                                            |
| `X-Zapx-Timestamp`  | unix seconds                                                                                 |
| `X-Zapx-Signature`  | hex HMAC-SHA256(vendor secret, `timestamp + "." + url + "." + body`) (body is empty for GET) |

Retries: 2xx is delivered; network errors, timeouts, 408, 429 and 5xx are retried after about 30 s,
1, 2, 4 … minutes (±20 % jitter, capped at 1 h) up to the vendor's attempt limit (default 6), then
dead-lettered; other 4xx fail permanently. Failed and dead callbacks can be retried from the studio.
Each outcome is queued at most once (unique idempotency key). Test respondents never trigger
callbacks. Callbacks to private or loopback addresses are blocked unless
`CALLBACK_ALLOW_PRIVATE_HOSTS=true` (development only), and redirects are not followed.

## PROJEXA vendors

Follows PROJEXA `docs/SURVEY_INTEGRATION.md`.

**Verification (Milestone 13).** `scripts/projexa-check.mjs` runs one respondent through both
systems over their public APIs: PROJEXA test entry link → ZAPX survey → back to PROJEXA's
`/r/complete` → ZAPX's signed S2S confirmation, which PROJEXA must mark verified. On 2026-11-02 it
passed all 10 steps against PROJEXA branch `claude/milestone-20-ai-copilot` (commit 9c51e45) run
locally next to ZAPX. PROJEXA has not been deployed yet, so it has **not been run against a live
PROJEXA**; run it against the real address before the first live project:

```
PROJEXA_URL=https://projexa.example PROJEXA_EMAIL=admin@... PROJEXA_PASSWORD=... \
ZAPX_API_URL=https://zapx.example/api ZAPX_RUNTIME_URL=https://take.zapx.example \
ZAPX_EMAIL=admin@... ZAPX_PASSWORD=... node scripts/projexa-check.mjs
```

It uses PROJEXA's test entry link (test sessions never count toward quotas, revenue, payout or vendor
callbacks), creates a clearly named client, vendor and project on both sides and leaves them for
inspection. The PROJEXA account must be an admin without two-step sign-in, and PROJEXA's
organization must allow the ZAPX respondent host in its redirect domains.

1. In PROJEXA, the client survey link is the ZAPX live link with `vid=<code>&uid={session_token}`.
2. At the end ZAPX sends the browser to `{base}/r/{status}?token={session_token}` (primary slugs).
3. If S2S is on and a client secret is stored, ZAPX queues
   `POST {base}/api/v1/s2s/outcome` with `{token, status, timestamp, signature}`,
   `signature = hex HMAC-SHA256(clientSecret, token + "." + status + "." + timestamp)`, a fresh
   timestamp on every attempt. 200 is delivered, 409 is a conflict (PROJEXA already holds another
   status; not retried), 401 and 404 fail permanently, 5xx and network errors are retried.
4. The client secret is write-only in the API and encrypted at rest (`SecretBox`, AES-256-GCM).

## Vendor API

Vendors can reconcile outcomes: `GET /api/v1/vendor/outcomes?since=&surveyId=&limit=` and
`GET /api/v1/vendor/outcomes/{uid}`. Authentication: `X-Zapx-Vendor` (vendor id),
`X-Zapx-Timestamp` (unix seconds, ±5 min) and
`X-Zapx-Signature = hex HMAC-SHA256(vendor secret, timestamp + "." + METHOD + "." + path?query)`.

## Configuration

`CALLBACK_WORKER`, `CALLBACK_POLL_MS`, `CALLBACK_TIMEOUT_MS`, `CALLBACK_ALLOW_PRIVATE_HOSTS`,
`ABANDON_AFTER_MINUTES`, `SECRETS_KEY` (see `.env.example`).

## Extracting it into a service

Move `packages/redirect-core` and `apps/api/src/integrations` into a new service with its own
database (the tables above), expose resolve/outcome endpoints, and give ZAPX an `HttpRedirectService`
implementing `RedirectService`. The interview flow does not change.
