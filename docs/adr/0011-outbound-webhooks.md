# 0011: Signed outbound webhooks

Status: Accepted (Milestone 6)

## Context

Clients and partners want to react to fieldwork without polling: start incentive payouts when a
complete is accepted, sync statuses into a PM tool, or alert when a survey is paused. Vendor
callbacks (ADR 0003) already deliver per-vendor outcomes; webhooks are the organization-wide,
integration-facing counterpart.

## Decision

- Admins register endpoints per organization with a list of events: `response.finished`,
  `response.review_decided`, `survey.published`, `survey.status_changed`. A `webhook.test` event can be
  sent by hand.
- Events go into an outbox table (`WebhookDelivery`) and are delivered by the same background worker
  as vendor callbacks, claimed with `FOR UPDATE SKIP LOCKED`, through the same `HttpDelivery` (SSRF
  guard, no redirects followed, timeout). Retries use the redirect-core retry policy (6 attempts,
  exponential backoff with jitter); 2xx is delivered, 408/429/5xx/network errors are retried, other
  4xx fail at once. Failed deliveries can be redelivered from the studio.
- Each request is a JSON POST with `X-Zapx-Event`, `X-Zapx-Delivery` (the event id, for receiver
  deduplication) and `X-Zapx-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. The
  signing secret is shown once, stored sealed with `SecretBox` (it must be readable to sign) and can
  be rotated.
- Payloads carry ids, statuses, mode, vendor code, respondent uid, quality score and review state.
  They never carry answers. Test respondents never produce events.
- A complete later rejected in review sends `response.review_decided`, not a second
  `response.finished`. Delivery is at least once and not ordered; receivers deduplicate by delivery id
  and order by `createdAt`.
- Endpoints must be `https://` unless `CALLBACK_ALLOW_PRIVATE_HOSTS` is on (development only).

## Consequences

- Integrators verify signatures and deduplicate; docs/modules/webhooks.md has the recipe.
- Webhook problems never affect interviews: queuing errors are logged, not thrown.
- No per-project webhooks or event filters beyond the event type yet; delivery rows are kept (no
  retention job yet).
