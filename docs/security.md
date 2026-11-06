# Security

## Automated checks

`pnpm check` runs the secret scan and the dependency audit with every other gate on your machine
([ADR 0009](adr/0009-local-quality-gates.md)). The secret scan also runs before every commit and
push ([repository protections](operations/github-security.md)). When GitHub Actions is enabled, CI
also runs:

- CodeQL `security-extended` on every pull request and weekly.
- `pnpm audit --prod --audit-level high` fails the build on high or critical advisories.
- Dependabot weekly for npm, GitHub Actions and Docker base images.
- GitHub secret scanning (enable in repository settings › Code security).

## Accepted exceptions

| Advisory                       | Package                         | Why accepted                                                                          | Exit                                  |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| GHSA-g3hv-75wg-m249 (moderate) | minimatch 3 and 5, from exceljs | Matches only exceljs's own fixed glob patterns, never user input; fixes break its API | exceljs release with archiver upgrade |

zod was upgraded to 4 in Milestone 20, which closed GHSA-mrhx-c7xc-m3w5.

Floors for transitive packages (`postcss`, `sharp`, `path-to-regexp`, `multer`, `uuid`) are set as overrides
in `pnpm-workspace.yaml`.

## Secrets

- Never in code or in the repository. Locally `.env` (git-ignored); on AWS Secrets Manager.
- Required in production: `JWT_SECRET`, `SECRETS_KEY`, `SIGNING_KEYS_SECRET` (the API refuses to start without them).
- Partner secrets that SampCode must read back (PROJEXA client secret) are encrypted at rest with
  AES-256-GCM (`SecretBox`); the next step is KMS envelope encryption. Vendor shared secrets are
  stored as generated, returned only to admins (programmers and viewers do not receive it), and
  can be rotated from the studio.
- Passwords: members change their own (current password required, other sessions signed out);
  administrators create one-time reset links; "forgot password" emails one when email is set up.
  Reset tokens are stored only as SHA-256 hashes and expire after `PASSWORD_RESET_HOURS`.

## Access and personal data (Milestone 5)

- The `INTERVIEWER` role is deny-by-default: the API guard lets it reach only endpoints that name it
  (`/api/capi/*`, `/api/auth/me`). Tests assert it cannot read projects, surveys or exports.
- CAPI uploads are tied to the signed-in interviewer and to surveys they were assigned; a device id
  is a random UUID per installation, not a hardware id.
- Respondent network addresses are not stored. The same-network quality check keeps
  `HMAC(key, tenantId:address)` truncated to 128 bits; the key is derived from `JWT_SECRET`.
- Open-answer fingerprints are SHA-256 of normalized text and compared only within one survey.
- Interviews on a CAPI device live in that browser's IndexedDB until synced. Devices should use the
  operating system's screen lock and storage encryption; remote wipe needs device management (not
  part of SampCode yet).

## Access, keys and tenant isolation (Milestone 6)

- Members with assigned project access get 404 for anything outside their projects; the Milestone 6
  tests walk every route family (projects, surveys, vendors, logs, exports, quality) as such a member.
- The guard reads the member's role and access from the database on every request, so demotions and
  removals from a project take effect immediately.
- API keys: only the SHA-256 hash of the secret is stored; comparison is constant time; keys never
  exceed their creator's current role or programmer, cannot reach admin endpoints and cannot manage
  keys. Use is recorded (`lastUsedAt`, `viaApiKey` in audit events).
- Webhook secrets are sealed with `SecretBox` (AES-256-GCM, key from `SECRETS_KEY`); requests are
  signed with HMAC-SHA256 over timestamp and body; endpoints must be https and public (SSRF guard).
  Payloads contain no answers.
- Row-level security: `Response` has a forced RLS policy keyed on `app.tenant_id`, which the
  tenant-scoped client sets for studio reads of respondent data. When the setting is absent the
  policy allows all rows (system paths), so it is a second line of defence, not complete database
  isolation. It is not applied at all if the API connects as a superuser or a `BYPASSRLS` role; the
  API logs a warning at start-up and reports the state at `GET /api/audit/security`.

## Identity, provisioning and plans (Milestone 8)

- Single sign-on uses OpenID Connect with PKCE, `state` and `nonce`; ID tokens are verified against
  the provider's published keys (issuer, audience, expiry, nonce). The flow state is a signed,
  httpOnly cookie valid for 10 minutes. After sign-in only same-site relative paths are followed.
- Provider addresses must be https and public unless `SSO_ALLOW_INSECURE_ISSUER=true` (refused in
  production). Client secrets are sealed with `SecretBox` and never returned by the API.
- A provider can only sign people into its own organization's email domains; an email that belongs
  to another organization is refused, and just-in-time provisioning never creates admins.
- When SSO is required, admins keep password sign-in as the way back in. Protect admin passwords.
- Disabled members are refused on every request (sessions and their API keys stop at once).
- SCIM tokens are stored as SHA-256 hashes, shown once, scoped to one organization, and rotatable;
  SCIM can create admins if the directory says so, so treat the token like an admin password.
- SSO has been tested only against a mock provider; see ADR 0014.

## Production readiness (Milestone 13)

- **SAML:** assertions must be signed by a configured certificate; SampCode checks the issuer, the
  audience, the timestamps (60 s skew) and that the response answers a request it made in the last
  10 minutes. Each request is deleted when its response is checked, so responses cannot be replayed.
  IdP-initiated sign-in and transient name IDs are refused. Verification details are logged, not
  shown to the person.
- **Stripe webhooks** are verified with HMAC-SHA256 over the exact bytes received (5 minute
  tolerance), applied once, and never trusted for state: SampCode re-reads the subscription from Stripe.
  The secret key never reaches the browser; card details never reach SampCode.
- **S3:** private bucket, public access blocked, TLS-only bucket policy, SSE-KMS with a key per
  environment, IAM limited to Put/Get/Delete on that bucket. Storage keys are generated by SampCode and
  validated before use.
- **Edge trust:** with `EDGE_SHARED_SECRET` set, the viewer address and country headers are dropped
  from any request that does not carry the CDN's secret (constant-time comparison), so they cannot
  be forged by calling the API directly. The ALB forwards the respondent origin only with the header.
- **AWS secrets** live in Secrets Manager (app secret) and the RDS-managed secret (database
  password); Terraform creates the secret but never holds its values (except `edge_shared_secret`,
  which CloudFront needs, so treat the Terraform state as secret).

## Third-party lookups (Milestone 16 onwards)

- **Network reputation** (`NETWORK_REPUTATION=ipinfo`, off by default) sends each online
  respondent's public address to IPinfo over HTTPS with a bearer token. Private, loopback and
  link-local addresses are never sent. SampCode stores only the words in the answer, never the address.
- **Transcription** (`TRANSCRIPTION=deepgram`, off by default) sends an interview recording to
  Deepgram over HTTPS only when an admin or programmer asks, after a confirmation. The transcript is
  stored with the recording, has the same access, and is deleted with it.

## Security hardening (Milestone 20)

Details and reasons: [ADR 0026](adr/0026-security-hardening.md).

- **Outbound requests to customer addresses** (callbacks, webhooks, OIDC) go through
  `common/net-guard.ts`: private, loopback, link-local and metadata addresses are refused in every
  spelling (including IPv6 forms that embed IPv4), and the check happens when the socket connects,
  so DNS rebinding cannot slip past it. Redirects are not followed.
- **Sign-in:** 10 attempts per minute per address (`LOGIN_RATE_PER_MINUTE`), and an account locks
  for 15 minutes after 10 wrong passwords in a row (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`);
  locks are audited (`auth.locked`). On AWS, WAF also limits `/api/auth/` to 100 requests per 5
  minutes per address. Common and patterned passwords are refused when accounts are created.
- **Sessions:** HS256 only; sign-out revokes the session on the server; `POST /api/auth/logout-all`
  ends every session of the member. Disabled members are still refused on every request.
- **After SSO** only paths on this site are followed (no control characters, no `//`, no `\`).
- **Production start-up** fails with `COOKIE_SECURE=false`, an example `JWT_SECRET` or
  `SECRETS_KEY`, or `SECRETS_KEY` equal to `JWT_SECRET`.
- **Headers:** API: `Content-Security-Policy: default-src 'none'`, `X-Frame-Options: DENY`,
  `Cross-Origin-Resource-Policy: same-origin` (survey media: cross-origin), COOP,
  `Permissions-Policy`, HSTS over https. Studio, runtime and CAPI app: CSP, HSTS, COOP and
  Permissions-Policy from Next.js, nginx (`infra/nginx/*-headers.conf`) and CloudFront response
  headers policies. The runtime may be framed by customers' sites; the studio and CAPI app may not.
- **Secrets in git:** `scripts/secret-scan.mjs` in `pnpm check` and the pre-commit and pre-push
  hooks; `.gitignore` covers env files, keys and Terraform state.

## Reporting

See [SECURITY.md](../SECURITY.md): report privately; do not open a public issue.
