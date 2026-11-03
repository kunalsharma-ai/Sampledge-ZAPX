# 0028: Integrations are set up in the CRM

Status: Accepted (2026-11-03)

## Context

Every third-party service (Claude, IPinfo, Deepgram, Twilio, Stripe, S3) was switched on with
environment variables or the Secrets Manager JSON. Changing a key meant a developer, a redeploy and,
on AWS, a task restart. The owner asked for all of it to be done from inside the CRM.

## Decision

1. **One table, one row per integration** (`PlatformIntegration`): an on/off switch, non-secret
   fields as JSON, and the secret fields as one JSON object sealed with SecretBox (AES-256-GCM,
   `SECRETS_KEY`). The browser only ever learns whether a secret is set and its last four characters.
2. **The CRM wins, the environment is the fallback.** For each field the saved value is used, else its
   environment variable, else a default (Twilio's callback address defaults to `STUDIO_URL/api`).
   Until an integration is saved in the CRM its switch also comes from the environment, so existing
   deployments keep working unchanged. Clearing a field or "Use server settings instead" falls back.
3. **No restart.** Each process keeps the rows in memory and re-reads them every
   `INTEGRATIONS_REFRESH_MS` (15 s), and at once after a save in that process. Providers (AI gateway,
   network reputation, transcription, dialer, billing, file store) rebuild their client when a
   fingerprint of their settings changes. `integration(key)` stays synchronous and cheap.
4. **Who:** administrators of the platform operator organization (`Tenant.platformOperator`), signed
   in, never through an API key. The first organization becomes the operator; `cli/set-operator.js`
   hands it over. Customer organizations keep their own SSO, SCIM, webhooks, API keys and AI limits on
   their settings page.
5. **Audit:** every save, test and reset is recorded with the fields that changed, never the values.
6. **Test connection** makes one read-only call per provider (list a model, look up 8.8.8.8, read the
   account, read each Stripe price, HeadBucket) at the provider's fixed address from the environment.
   The address is never taken from the browser, so the test cannot be used to reach other hosts.

## What stays in the environment

Settings that protect or run the server itself: `JWT_SECRET`, `SECRETS_KEY` (it encrypts the keys
above, so it cannot live next to them), the database, public addresses and HTTPS, the CDN secret and
proxy hops, worker switches, size limits and retention, sign-up, and the AWS resources in Terraform.
The provider base URLs (`*_API_BASE`, `S3_ENDPOINT`) stay there too; they exist only for tests.

## Consequences

- Terraform's `app_secret_keys` now defaults to `JWT_SECRET` and `SECRETS_KEY`; the provider keys
  no longer have to exist in Secrets Manager for the tasks to start.
- Rotating `SECRETS_KEY` makes the saved keys unreadable: the log says so and the admin enters them
  again. (Re-encryption under a new key is future work, as for the other sealed secrets.)
- Switching file storage between the server disk and S3 does not move files; the page warns.
- A change can take up to 15 seconds to reach other servers and the worker.
