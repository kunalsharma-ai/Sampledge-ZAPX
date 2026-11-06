# Changelog

What was built when, taken from the repository's pull requests. Dates are when the PR was merged
(or opened, for the open PR), in UTC. Each milestone has a design record in [docs/adr/](../adr/) and,
for most, a module guide in [docs/modules/](../modules/).

The format follows [Keep a Changelog](https://keepachangelog.com/): newest first, grouped by
release. SampCode (called ZAPX until 2026-11-06) has no version numbers or git tags yet, so entries are grouped by milestone or PR.

## SAMPLEON, CI, docs and the SampCode name (merged 2026-11-06, PRs #47–#50)

- PR #47, branch `claude/sampleon-survey-host`: SAMPLEON integration (survey host and audience
  requests); see [docs/modules/sampleon.md](../modules/sampleon.md). Not described in this handbook yet.
- PR #49, branch `claude/ci-free-minutes`: GitHub Actions CI workflow changes.
- PR #48, branch `docs-final-handoff`: docs brought in line with `main` after #46.
- PR #50, branch `rename-sampcode`: the product is renamed **SampCode** (formerly ZAPX) with the new logo,
  icon and favicon in the studio, the CAPI app and the mobile app; internal identifiers keep `zapx`
  (ADR 0038, [docs/brand/](../brand/README.md)).

## Clean-up: Node 26, security S4–S9, confirm dialogs (merged 2026-11-06, PRs #44–#46)

`main` = `68f4531`. The full `pnpm check --no-docker` passed on Node 26 after each merge.

### Changed

- Node 26 LTS everywhere: `.nvmrc`, `engines.node >= 26`, `@types/node` 26, Docker images
  `node:26-bookworm-slim` and `nginx:1.31-alpine`, newer GitHub Actions steps (#44). The Dependabot
  PRs #20–#25 were closed as replaced.
- Confirmations in the studio and the CAPI app use a neon dialog (`useConfirm()`,
  `components/neon/ConfirmDialog.tsx`, `apps/capi/src/Confirm.tsx`) instead of `window.confirm` (#46).

### Security (#45)

- Security review findings S4–S9 fixed: rate limits shared by every API task (`RateLimitBucket`,
  `THROTTLE_STORE`), `SIGNING_KEYS_SECRET` with one derived key per purpose, studio script nonce
  (`apps/studio/middleware.ts`), no session token in browser response bodies, `eslint-plugin-security`
  in `pnpm lint`, row-level security on seven more tables.

### Database

- Migration `20261120000000_security_hardening`: table `RateLimitBucket`, row-level security policies
  on `CatiCase`, `CatiCall`, `DoNotCall`, `Contact`, `Invitation`, `BackCheck`, `QualityAppeal`.
  Backward-compatible: yes (#45).

### Configuration

- New `SIGNING_KEYS_SECRET` (32+ characters, required in production, different from `JWT_SECRET`
  and `SECRETS_KEY`); on AWS it is in `app_secret_keys`, so it must be in the Secrets Manager JSON (#45).
- New `THROTTLE_STORE` (`database`, the production default, or `memory`) (#45).

## Design system, blueprint, integrations, super admin, mobile (merged 2026-11-05, PRs #27–#43)

All merged into `main` with merge commits on 2026-11-05, in this order: #27 → #29 → #30 → #31 →
#32 → #33 → #34 → #35 → #36 → #37 → #38 (which also merged #28) → #39 → #41 → #40 → #42 → #43.

| PR  | Branch                         | What it adds                                                                                       | ADR           |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------- |
| #43 | `vendor-secret-super-admin`    | Super admins see the vendor shared secret whatever their role, never through an API key            | —             |
| #42 | `docs-handbook-refresh`        | Handbook refresh for #37–#41                                                                       | —             |
| #40 | `mobile-app`                   | Android and iOS app (Expo), gated live by the super admin's mobile features                        | 0037          |
| #41 | `super-admin-console`          | Super admin: organizations, plans, web and mobile features, suspension, activity, automation       | 0036          |
| #39 | `neon-everywhere`              | Neon design on every studio page and the CAPI app (visual only)                                    | 0028 addendum |
| #38 | `stack-integrations-in-crm`    | Integrations in the CRM (#28) on top of the stack                                                  | 0035          |
| #37 | `blueprint-p6-eye-tracking`    | Webcam eye tracking (experimental, opt-in)                                                         | 0034          |
| #36 | `security-fixes`               | Security fixes S1–S3 and older docs brought past M13                                               | —             |
| #35 | `docs-handbook`                | This maintainer handbook                                                                           | —             |
| #34 | `blueprint-p5-enterprise`      | Automation, data residency and retention, data cleaning, dashboards, SMS, area themes              | 0033          |
| #33 | `blueprint-p4-research`        | MaxDiff, conjoint, recodes, AI research assistant, CAPI video                                      | 0032          |
| #32 | `blueprint-p3-fieldwork`       | Fieldwork evidence, supervision, appeals, email distribution                                       | 0031          |
| #31 | `blueprint-p2-ai-multilingual` | Multilingual tools, URL variables, least-fill, test cases, voice, 16 themes                        | 0030          |
| #30 | `blueprint-p1-core`            | Loops, blocks, variables, programmer workspace, question bank                                      | 0029          |
| #29 | `neon-ai-dashboard`            | Neon AI dashboard theme (new default), sidebar shell, real-data home screen                        | 0028          |
| #28 | `integrations-in-crm`          | Set up every integration (Claude, IPinfo, Deepgram, Twilio, Stripe, S3) in Settings → Integrations | 0035          |
| #27 | `quantum-design-system`        | Quantum Design System: audit, theme engine, first components                                       | 0027          |

### Security (#36)

- The vendor shared secret is returned only to ADMIN; programmers and viewers no longer receive it.
- The super admin also receives the vendor shared secret, whatever their role, but never through an
  API key (#43).
- Password change on My account (`POST /api/auth/change-password`), administrator one-time reset
  links (`POST /api/users/:id/password-reset`), "forgot password" by email
  (`POST /api/auth/forgot-password`) and `POST /api/auth/reset-password`.
- Sessions carry their issue time in milliseconds (`iatMs`), so "sign out other sessions" keeps the
  session that changed the password.
- AWS: `SENDGRID_API_KEY` added to `app_secret_keys`; the Terraform README's example secret JSON
  now lists every key.

### Added (#37–#41)

- Webcam eye-tracking question `eyetrack` with a heat map in analysis
  (`POST /api/surveys/:id/analysis/eyetracking/:questionId`); experimental (#37).
- Settings → Integrations: Claude, IPinfo, Deepgram, Twilio, Stripe and S3 set in the studio, sealed
  in the database, environment as fallback (#38).
- Neon look on every studio page (`PageHeader`, `neon-pages.css`) and the CAPI app (#39).
- Super admin console `/super-admin`, `/api/super/*`, live entitlements
  (`/api/me/entitlements`, `/stream`), subscription plans with web and mobile features,
  suspension, platform automation; CLIs `set-super-admin.js` and `set-operator.js` (#41).
- ZAPX mobile app in `apps/mobile` (Expo, Android and iOS), `/api/mobile/version` and
  `/api/mobile/config` (#40).

### Database

- Migration `20261117000000_password_reset`: new table `PasswordReset`. Backward-compatible: yes (#36).
- Migration `20261118000000_integrations_in_crm`: new table `PlatformIntegration`, column
  `Tenant.platformOperator`. Backward-compatible: yes (#38).
- Migration `20261119000000_super_admin`: tables `SubscriptionPlan`, `PlatformAutomation`,
  `PlatformAutomationRun`; subscription, suspension and feature-override columns on `Tenant`;
  `superAdmin`, `featureOverrides`, `mobileAccess`, `lastSeenAt`, `lastClient` on `User`; index on
  `AuditEvent.createdAt`. Backward-compatible: yes, only new tables and
  columns with defaults (#41).

### Configuration

- New variable `PASSWORD_RESET_HOURS` (default `24`), in `.env.example` (#36).
- New variables `INTEGRATIONS_REFRESH_MS` (default `15000`) and `ANTHROPIC_API_BASE` (tests only) (#38).
- New variables `PLATFORM_AUTOMATION` (default `on`) and `PLATFORM_AUTOMATION_MS` (default `60000`) (#41).
- New variable `MOBILE_MIN_VERSION` (unset by default) (#40).
- Runtime CSP adds `'wasm-unsafe-eval'` (nginx and CloudFront) for eye tracking (#37).

### Documentation

- Added this maintainer handbook in `docs/handbook/` (#35), refreshed for #37–#41 (#42) and brought
  up to date with `main` after #46 on 2026-11-06.
- Root `README.md`, `docs/architecture.md`, `docs/operations/go-live.md` and `docs/security.md`
  brought up to date past Milestone 13 (PR #36).

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
