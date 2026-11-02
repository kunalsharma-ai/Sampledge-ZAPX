# 0019: Production readiness: S3, SAML, billing, AWS and the PROJEXA check

Status: Accepted (Milestone 13). Supersedes the "no S3 adapter" limit of 0013, the "OIDC only" and
"no billing" parts of 0014, and makes 0005's AWS mapping concrete.

## Context

ZAPX is feature complete for its first release, but several pieces were seams only: files had to
share a disk, enterprises that use SAML could not sign in, plans could only be changed by an
operator, the AWS mapping in ADR 0005 was a table rather than infrastructure, and the PROJEXA
integration had been built from documentation and a mock. PROJEXA itself is not deployed yet.

## Decision

- **S3 file store** behind the existing `FileStore` seam, selected by `FILE_STORE=s3`. Objects are
  private, written with SSE-KMS (or SSE-S3 when no key is given), and the AWS SDK takes credentials
  from the standard chain (the ECS task role), never from ZAPX settings. Keys stay ZAPX-made and are
  checked before any request. The bucket (Terraform) adds versioning with 30-day expiry of old
  versions, a TLS-only policy and blocked public access.
- **SAML 2.0** next to OpenID Connect, one protocol per organization, with `@node-saml/node-saml`.
  SP-initiated only: the AuthnRequest ID is stored (`SsoRequest`, 10 minutes) and passed as
  RelayState, so the ACS needs no cookie (the IdP's cross-site POST would not carry a SameSite
  cookie) and each request is answered once. Assertions must be signed by a configured certificate
  (several allowed for rotation); audience, timestamps and InResponseTo are checked by the library,
  the assertion issuer by ZAPX (the library checks it only for logout). Transient name IDs are
  refused because they cannot identify a returning person. Accounts link and provision exactly as
  for OpenID Connect (ADR 0014), with the subject stored as `saml:<NameID>`.
- **Billing with Stripe**, optional (`BILLING=stripe`). Stripe Checkout and the customer portal do all
  payment handling; ZAPX keeps plan limits in code and maps plans to Stripe prices
  (`STRIPE_PRICES`). Webhooks are verified over the raw body, applied once (`BillingEvent`), and
  every subscription event is answered by reading the subscription back from Stripe, so ordering
  and retries do not matter. `past_due` keeps the plan while Stripe retries; ended subscriptions fall
  back to `BILLING_FALLBACK_PLAN`. Implemented with `fetch` against Stripe's REST API rather than
  the SDK: three calls do not justify a dependency, and the base URL can point at a fake in tests.
- **AWS as Terraform** (`infra/terraform`): VPC over two zones with NAT, ECS Fargate services for the
  API, the worker and the studio behind an ALB, RDS PostgreSQL 16 (encrypted, Multi-AZ, managed
  master password, forced TLS, 14-day backups, deletion protection), S3 + CloudFront for the
  respondent runtime and the CAPI app with `/api/*` routed to the ALB, one KMS key per environment,
  Secrets Manager for app secrets (values put in by an operator, never in Terraform state), CloudWatch
  logs and alarms. The API reads the database password from the RDS secret as `DB_*` parts
  (`database-url.ts`). Releases run `infra/scripts/deploy-aws.sh`: images, then the migration task,
  then the services, then the static apps.
- **Trust at the edge.** CloudFront sends a shared secret header to the ALB; only those requests
  reach the respondent API origin, and only they are trusted for the viewer's address and country
  (`EDGE_SHARED_SECRET`). On every other request those headers are removed, so a respondent cannot
  pick their own country or address for the fraud checks.
- **PROJEXA connection check** (`scripts/projexa-check.mjs`) instead of claiming the integration
  works: it drives one test respondent through both systems' public APIs and fails loudly on the
  first broken step. Run against PROJEXA's code locally it passed; it must be run again against the
  deployed PROJEXA.

## Consequences

- Nothing in this milestone has run against the real services yet: S3 against a fake S3 server
  with the real SDK, SAML against a test IdP, Stripe against a fake API, Terraform through
  `terraform validate` and plan tests with a mocked provider, PROJEXA against its code on this
  machine. Each guide says what to try first on a staging environment.
- Docker images are still the full workspace (no `pnpm deploy` slimming): the build could not be
  run here without a Docker daemon, and changing it untested would risk the release path.
- No SAML single logout, encrypted assertions or signed AuthnRequests; no seat- or usage-based
  billing; no WAF, Valkey or SQS (not needed at current volume, ADR 0005).
- Moving existing local files to S3 is a manual `aws s3 sync`.
