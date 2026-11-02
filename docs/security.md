# Security

## Automated checks

`pnpm check` runs the dependency audit with every other gate on your machine
([ADR 0009](adr/0009-local-quality-gates.md)). When GitHub Actions is enabled, CI also runs:

- CodeQL `security-extended` on every pull request and weekly.
- `pnpm audit --prod --audit-level high` fails the build on high or critical advisories.
- Dependabot weekly for npm, GitHub Actions and Docker base images.
- GitHub secret scanning (enable in repository settings › Code security).

## Accepted exceptions

| Advisory                   | Package | Why accepted                                                 | Mitigation                                                                            | Exit                              |
| -------------------------- | ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------- |
| GHSA-mrhx-c7xc-m3w5 (high) | zod 3   | Fixed only in zod 4, a breaking upgrade across every package | Request bodies are size-limited before validation, so a crafted collection is bounded | Migrate to zod 4 (next milestone) |

Floors for transitive packages (`postcss`, `sharp`, `path-to-regexp`, `multer`) are set as overrides
in `pnpm-workspace.yaml`.

## Secrets

- Never in code or in the repository. Locally `.env` (git-ignored); on AWS Secrets Manager.
- Required in production: `JWT_SECRET`, `SECRETS_KEY` (the API refuses to start without it).
- Partner secrets that ZAPX must read back (PROJEXA client secret) are encrypted at rest with
  AES-256-GCM (`SecretBox`); the next step is KMS envelope encryption. Vendor shared secrets are
  stored as generated and can be rotated from the studio.

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
  part of ZAPX yet).

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

## Reporting

Report vulnerabilities privately to the maintainer; do not open a public issue.
