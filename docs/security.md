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

## Reporting

Report vulnerabilities privately to the maintainer; do not open a public issue.
