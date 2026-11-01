# 0006 · Engineering governance and quality gates

Date: 2026-11-01 · Status: Accepted

## Context

One primary developer with Claude now, more developers later; enterprise customers expect evidence
of secure, reviewed, tested change.

## Decision

- TypeScript `strict` and `noUncheckedIndexedAccess` everywhere (`tsconfig.base.json`).
- ESLint (typescript-eslint, react-hooks) and Prettier; both run in CI (`pnpm lint`,
  `pnpm format:check`).
- Tests: unit tests in every package, API integration tests against PostgreSQL, Playwright
  acceptance tests per milestone. All run in CI.
- Pull requests only: `main` is protected (no direct pushes, no force pushes, CI must pass).
  Required reviews are switched on when a second maintainer joins; CODEOWNERS then routes reviews
  per module.
- Security: CodeQL (security-extended) on every PR and weekly, Dependabot for npm, Actions and
  Docker, `pnpm audit --prod --audit-level high` in CI, GitHub secret scanning. Accepted audit
  exceptions are listed in `pnpm-workspace.yaml` with a reason and tracked in `docs/security.md`.
- Decisions go in ADRs; partner-facing contracts in `docs/api/openapi.yaml`; each module has a page
  in `docs/modules/`.

## Consequences

- CI takes longer (audit, CodeQL and the Docker job run in parallel with tests).
- Exceptions to the audit gate are visible in code review rather than silently ignored.
