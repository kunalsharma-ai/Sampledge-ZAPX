# Changelog

What was built when, taken from the repository's pull requests. Dates are when the PR was merged
(or opened, for open PRs), in UTC. Each milestone has a design record in [docs/adr/](../adr/) and,
for most, a module guide in [docs/modules/](../modules/).

The format follows [Keep a Changelog](https://keepachangelog.com/): newest first, grouped by
release. ZAPX has no version numbers or git tags yet, so entries are grouped by milestone or PR.

## Unreleased (open pull requests, not on `main`)

These exist only on their branches. The stack is merged in order: #27 → #29 → #30 → #31 → #32 →
#33 → #34. PR #28 is separate (based on `main`) and is **not** included in the stack.

| PR  | Opened     | Branch                         | Base                           | What it adds                                                                                       | ADR  |
| --- | ---------- | ------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------- | ---- |
| #34 | 2026-11-05 | `blueprint-p5-enterprise`      | `blueprint-p4-research`        | Automation, data residency and retention, data cleaning, dashboards, SMS, area themes              | 0033 |
| #33 | 2026-11-04 | `blueprint-p4-research`        | `blueprint-p3-fieldwork`       | MaxDiff, conjoint, recodes, AI research assistant, CAPI video                                      | 0032 |
| #32 | 2026-11-04 | `blueprint-p3-fieldwork`       | `blueprint-p2-ai-multilingual` | Fieldwork evidence, supervision, appeals, email distribution                                       | 0031 |
| #31 | 2026-11-04 | `blueprint-p2-ai-multilingual` | `blueprint-p1-core`            | Multilingual tools, URL variables, least-fill, test cases, voice, 16 themes                        | 0030 |
| #30 | 2026-11-04 | `blueprint-p1-core`            | `neon-ai-dashboard`            | Loops, blocks, variables, programmer workspace, question bank                                      | 0029 |
| #29 | 2026-11-04 | `neon-ai-dashboard`            | `quantum-design-system`        | Neon AI dashboard theme (new default), sidebar shell, real-data home screen                        | 0028 |
| #28 | 2026-11-03 | `integrations-in-crm`          | `main`                         | Set up every integration (Claude, IPinfo, Deepgram, Twilio, Stripe, S3) in Settings → Integrations | —    |
| #27 | 2026-11-02 | `quantum-design-system`        | `main`                         | Quantum Design System: audit, theme engine, first components                                       | 0027 |

Also open: Dependabot PRs #20–#25 (Node 26 and nginx 1.31 base images; GitHub Actions versions).

### Security (branch `security-fixes`, on top of #35)

- The vendor shared secret is returned only to ADMIN; programmers and viewers no longer receive it.
- Password change on My account (`POST /api/auth/change-password`), administrator one-time reset
  links (`POST /api/users/:id/password-reset`), "forgot password" by email
  (`POST /api/auth/forgot-password`) and `POST /api/auth/reset-password`.
- Sessions carry their issue time in milliseconds (`iatMs`), so "sign out other sessions" keeps the
  session that changed the password.
- AWS: `SENDGRID_API_KEY` added to `app_secret_keys`; the Terraform README's example secret JSON
  now lists every key.

### Database

- Migration `20261117000000_password_reset`: new table `PasswordReset`. Backward-compatible: yes.

### Configuration

- New variable `PASSWORD_RESET_HOURS` (default `24`), in `.env.example`.

### Documentation

- Added this maintainer handbook in `docs/handbook/` (#35).
- Root `README.md`, `docs/architecture.md`, `docs/operations/go-live.md` and `docs/security.md`
  brought up to date past Milestone 13 (branch `security-fixes`).

## Milestone 20: security hardening (2026-11-02, PR #26)

Account lockout, "sign out everywhere", production configuration guard, security headers on every
API response, Zod 4. [ADR 0026](../adr/0026-security-hardening.md).

## Milestones 1–19 (all merged 2026-11-02)

| Milestone | PR  | Title                                                                                | ADR        |
| --------- | --- | ------------------------------------------------------------------------------------ | ---------- |
| M19       | #19 | Phone dialer and call recording (Twilio adapter)                                     | 0025       |
| M18       | #18 | CATI calling hours and do-not-call list                                              | 0024       |
| M17       | #17 | Transcripts of interview recordings (Deepgram adapter)                               | 0023       |
| M16       | #16 | VPN, proxy and data-centre check (IPinfo adapter)                                    | 0022       |
| M15       | #15 | Rim weighting in analysis                                                            | 0021       |
| M14       | #14 | WAF, autoscaling, backups and the go-live checklist                                  | 0020       |
| M13       | #13 | Production readiness (S3, SAML, billing, AWS, PROJEXA check)                         | 0019       |
| M12       | #12 | Fraud detection and face-to-face capture                                             | 0018       |
| M11       | #11 | Rich media, image choice, NPS/scales, ranking, constant sum and sliders              | 0017       |
| M10       | #10 | Survey analysis, significance-tested crosstabs and saved reports                     | 0016       |
| M9        | #9  | CATI phone interviewing (call lists, queue, dispositions)                            | 0015       |
| M8        | #8  | Single sign-on, SCIM provisioning and plan limits                                    | 0014       |
| M7        | #7  | Background jobs, file storage and a worker process                                   | 0013       |
| M6        | #6  | Project access, API keys, webhooks, audit log, row-level security                    | 0010–0012  |
| M5        | #5  | Data quality (scoring, review, fieldwork) and offline CAPI interviewer app           | 0007, 0008 |
| M4        | #4  | Redirect & Vendor Integration, PROJEXA adapter, AI gateway, governance and Docker    | 0003–0006  |
| M3        | #3  | Experience Studio, languages with human review, and device rules                     | —          |
| M2        | #2  | AI Survey Architect, file import, change sets and QA Laboratory                      | —          |
| M1        | #1  | Survey foundation (schema, logic engine, studio, hosting, redirects, quotas, export) | 0001, 0002 |

ADR numbers for M1–M6 are matched by topic from `docs/adr/` file names; **Needs Verification** for
M2 and M3, which have no ADR of their own in the list.

## How to record a change

Add an entry under **Unreleased** in the same PR as the change. When a group of PRs is merged and
released, move the entries under a heading with the date (and a version, if versioning starts).

```markdown
## Unreleased

### Added

- <What a user can now do>, (#<PR>), [ADR 00NN](../adr/00NN-<name>.md) if a decision was made.

### Changed

- <Behaviour that is different now>, and what people must do about it (#<PR>).

### Fixed

- <Bug>: <what was wrong, what is right now> (#<PR>).

### Database

- Migration `<timestamp>_<name>`: <tables/columns added or changed>. Backward-compatible: yes/no.

### Configuration

- New variable `<NAME>` (default `<value>`); add it to `.env.example` and, on AWS,
  `app_environment` or the app secret.

### Security

- <What was hardened or which advisory was addressed>.
```

Recommended (not in place yet): tag releases (`git tag release-YYYY-MM-DD`) when deploying with
`infra/scripts/deploy-aws.sh`, so rollback has a named target (see
[DEPLOYMENT.md](DEPLOYMENT.md#5-rolling-back)).
