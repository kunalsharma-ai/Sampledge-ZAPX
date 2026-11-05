# 0009: Quality gates run locally; GitHub Actions is optional

Status: Accepted (2026-11-02). Supersedes the CI and branch-protection parts of [ADR 0006](0006-engineering-governance.md).

## Context

The repository is private on GitHub's free plan. GitHub Actions minutes are not available on the
account, and branch protection is not offered for private repositories on the free plan. The
maintainer decided to continue without a paid plan.

## Decision

- `pnpm check` (`scripts/check.sh`) is the quality gate: install with the frozen lockfile, format,
  lint, build, typecheck, migrations, unit and API tests, dependency audit, end-to-end tests and the
  Docker image build. It runs on any machine with Node 26, pnpm 10, PostgreSQL and (for images) Docker.
- A pull request is merged only after `pnpm check` passes on its head commit, and the pull request
  says so. Merging stays a deliberate human action; nobody pushes to `main` directly by convention
  instead of by enforcement.
- `.github/workflows/` stays in the repository unchanged, so CI and CodeQL run again automatically if
  Actions becomes available. No process depends on it.
- Dependabot keeps opening update pull requests (it does not use Actions minutes); each is checked
  with `pnpm check` like any other.

## Consequences

- Checks are only as reliable as the habit of running them; the PR template asks for it.
- No CodeQL scanning without Actions. `pnpm audit` and the review checklist remain; CodeQL can be run
  locally with the CodeQL CLI if needed.
- Without branch protection, `main` can be pushed to by anyone with write access. Today that is the
  maintainer only.
