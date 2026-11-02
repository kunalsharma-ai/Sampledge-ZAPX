# Security

## Automated checks (CI)

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

## Reporting

Report vulnerabilities privately to the maintainer; do not open a public issue.
