# ZAPX maintainer handbook

This folder explains how ZAPX is built so that you can find the right file when something breaks,
understand what a change will affect, and add features safely. It was first written from
branch `blueprint-p5-enterprise` (PR #34, commit `252ac32`), refreshed for PRs #37–#41 on 2026-11-05,
and brought up to date with `main` (commit `68f4531`, every PR through #46 merged) on 2026-11-06. Everything here points at real files; anything that could not be checked from the code
alone is marked **Needs Verification**.

The repository already has a README, ADRs and module guides. Nothing was replaced: this handbook sits
beside them and links to them. Where the older documents are out of date, this handbook says so
(see [Security & code quality review](SECURITY_REVIEW.md#documentation-drift)).

## The documents

| File                                         | Read it when you want to…                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)           | understand how the pieces fit, how a request flows, how login and permissions work     |
| [FILE_STRUCTURE.md](FILE_STRUCTURE.md)       | know what a folder or file is for, and which files to touch for a feature              |
| [DATABASE.md](DATABASE.md)                   | look up a table, field, relationship, index, or how backups work                       |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | find an endpoint, who may call it, what it expects and where its code is               |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | set up a machine, run the apps, add a page, field, endpoint, table or role             |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md)     | fix a problem: app not starting, login failing, data not saving, slow pages, and so on |
| [DEPLOYMENT.md](DEPLOYMENT.md)               | build for production, release to AWS, roll back, back up and restore                   |
| [CONFIGURATION.md](CONFIGURATION.md)         | look up any environment variable                                                       |
| [SECURITY_REVIEW.md](SECURITY_REVIEW.md)     | see how security works and the issues found while writing this handbook                |
| [CHANGELOG.md](CHANGELOG.md)                 | see what was built when, and how to record future changes                              |

## What ZAPX is, in one paragraph

ZAPX is a web platform for market research surveys. Research teams use the **studio** to write a
questionnaire (by hand, from a file, or with AI help), check its logic, test it with simulated
respondents, translate it and publish it. **Respondents** answer it through links that sample
**vendors** (panel companies) send them; at the end ZAPX sends each respondent back to the vendor with
the right outcome (complete, screened out, over quota, and so on). Interviewers can also run the same
survey **face to face** in an offline app (CAPI) or **by phone** from a call list (CATI). ZAPX scores
the quality of every interview, lets people review suspicious ones, and offers exports, analysis,
dashboards, automation and enterprise features (single sign-on, API keys, webhooks, audit log).
A **super admin** runs the whole installation: organizations, subscription plans and which features each
organization and member may use on the web and in the **mobile app** for Android and iOS _(PRs #41 and #40)_.

## Quick start (local machine)

Needs Node 26 (LTS, see `.nvmrc`), pnpm 10.28 and PostgreSQL 16. Full detail and alternatives (Docker) are in
[DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#1-set-up-a-development-machine).

```bash
git clone https://github.com/kunalsharma-ai/Sampledge-ZAPX.git && cd Sampledge-ZAPX
cp .env.example .env                  # then edit DATABASE_URL if your Postgres differs
pnpm install
docker compose up -d postgres         # or use your own PostgreSQL 16
pnpm build                            # builds every package and app (also generates the Prisma client)
pnpm db:migrate                       # creates the tables
pnpm db:seed                          # creates the demo admin (SEED_EMAIL / SEED_PASSWORD, defaults in packages/db/src/seed.ts)
set -a; . ./.env; set +a
node apps/api/dist/main.js            # API     http://localhost:4000/api
pnpm --filter @zapx/studio start      # Studio  http://localhost:3000   (second terminal)
pnpm --filter @zapx/runtime preview   # Survey  http://localhost:5173   (third terminal)
pnpm --filter @zapx/capi preview      # CAPI    http://localhost:5174   (fourth terminal)
( cd apps/mobile && npm ci && npm start )   # Mobile app (Expo, own npm project; PR #40)
```

Before merging any change run `pnpm check` (or `pnpm check --quick` while working). The GitHub
Actions workflows exist but do not run on this account, so the local check is the quality gate
([ADR 0009](../adr/0009-local-quality-gates.md)).

## What is on `main`

Everything is merged. `main` holds milestones 1 to 20 (PRs #1–#19 and #26, merged 2026-11-02), the
stack below (merged with merge commits on 2026-11-05, in this order) and the clean-up PRs #44–#46
(merged 2026-11-06). Feature sections in this handbook still carry a tag such as _(PR #33)_ so you
can find the pull request, its ADR and its tests.

| PR  | Branch                         | Based on                       | What it adds                                                                                                                                                                                                                            |
| --- | ------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #27 | `quantum-design-system`        | `main`                         | `packages/quantum` theme engine (presets, WCAG contrast), personal and organization appearance, the Appearance page and theme menu ([ADR 0027](../adr/0027-quantum-design-system.md))                                                   |
| #29 | `neon-ai-dashboard`            | `quantum-design-system`        | Neon AI default theme, the sidebar shell, home dashboard (`GET /api/dashboard`) and global search; projects list moves to `/projects` ([ADR 0028](../adr/0028-neon-dashboard.md))                                                       |
| #30 | `blueprint-p1-core`            | `neon-ai-dashboard`            | Loops, random blocks, calculated variables, live quota targets, ZAPX XML programmer view, logic debugger, question bank and templates, card sort and hot-spot questions ([ADR 0029](../adr/0029-blueprint-core-engineering.md))         |
| #31 | `blueprint-p2-ai-multilingual` | `blueprint-p1-core`            | Translation memory, glossary, right-to-left languages, URL variables, least-fill blocks, saved QA test cases, voice commands, 16 theme families ([ADR 0030](../adr/0030-blueprint-multilingual-and-qa.md))                              |
| #32 | `blueprint-p3-fieldwork`       | `blueprint-p2-ai-multilingual` | CAPI evidence (page times, interruptions, geofences), signature and barcode questions, back-checks, appeals, supervisor dashboard, email invitations through SendGrid ([ADR 0031](../adr/0031-blueprint-fieldwork-and-security.md))     |
| #33 | `blueprint-p4-research`        | `blueprint-p3-fieldwork`       | MaxDiff and conjoint, recodes, AI research assistant (`insights` task), CAPI video, least-fill quota groups, bank blocks, suggested test cases, device matrix ([ADR 0032](../adr/0032-blueprint-research-intelligence.md))              |
| #34 | `blueprint-p5-enterprise`      | `blueprint-p4-research`        | Automation rules and notifications, data residency and retention, cleaning rules, segments, chart dashboards, SMS invitations through Twilio, area themes and workspace presets ([ADR 0033](../adr/0033-blueprint-enterprise-scale.md)) |
| #35 | `docs-handbook`                | `blueprint-p5-enterprise`      | This handbook                                                                                                                                                                                                                           |
| #36 | `security-fixes`               | `docs-handbook`                | Fixes S1–S3 of the [security review](SECURITY_REVIEW.md): vendor secret for administrators only, password change and reset, AWS secret list; older docs brought past M13                                                                |
| #37 | `blueprint-p6-eye-tracking`    | `security-fixes`               | Webcam eye tracking question (`eyetrack`), experimental and opt-in, with a heat map in analysis ([ADR 0034](../adr/0034-webcam-eye-tracking.md))                                                                                        |
| #38 | `stack-integrations-in-crm`    | `blueprint-p6-eye-tracking`    | PR #28 rebuilt on this stack: set Claude, IPinfo, Deepgram, Twilio, Stripe and S3 in Settings → Integrations; the `PlatformIntegration` table ([ADR 0035](../adr/0035-integrations-in-the-crm.md))                                      |
| #39 | `neon-everywhere`              | `stack-integrations-in-crm`    | Neon design on every studio page (shared `PageHeader`, `neon-pages.css`) and the CAPI interviewer app; visual only (ADR 0028 addendum)                                                                                                  |
| #41 | `super-admin-console`          | `neon-everywhere`              | Super admin console (`/super-admin`): organizations, subscription plans, web and mobile features, suspension, activity, platform automation; live entitlements ([ADR 0036](../adr/0036-super-admin.md))                                 |
| #40 | `mobile-app`                   | `super-admin-console`          | ZAPX mobile app for Android and iOS (`apps/mobile`, Expo), gated live by the super admin's mobile features ([ADR 0037](../adr/0037-mobile-app.md))                                                                                      |
| #42 | `docs-handbook-refresh`        | `mobile-app`                   | Handbook refresh for #37–#41                                                                                                                                                                                                            |
| #43 | `vendor-secret-super-admin`    | `docs-handbook-refresh`        | Super admins see the vendor shared secret whatever their role, never through an API key (S12)                                                                                                                                           |
| #44 | `dependency-updates`           | `main`                         | Node 26 LTS (`.nvmrc`, `engines`, Docker `node:26-bookworm-slim`, `nginx:1.31-alpine`); replaces Dependabot #20–#25                                                                                                                     |
| #45 | `security-s4-s9`               | `main`                         | Fixes S4–S9: shared rate-limit store, `SIGNING_KEYS_SECRET`, studio script nonce, no token in browser bodies, security lint, more row-level security                                                                                    |
| #46 | `neon-confirm-dialogs`         | `main`                         | Neon confirm dialogs (`useConfirm()`) instead of the browser's `window.confirm`                                                                                                                                                         |

PR #28 (`integrations-in-crm`) was merged as part of #38. The Dependabot PRs #20–#25 were closed,
replaced by #44. Still open: PR #47 (SAMPLEON integration, its own branch; not in this handbook).

## What has never run against a real service

These parts are written and tested against local stand-ins only, so treat them as unproven until you
have tried them on a staging environment ([docs/operations/go-live.md](../operations/go-live.md)):
Claude AI calls, S3 storage, OpenID Connect and SAML sign-in, SCIM, Stripe billing, the AWS Terraform
and release script, PROJEXA (checked against its code, not a deployed PROJEXA), IPinfo, Deepgram,
Twilio (voice and SMS) and SendGrid. Also unproven: webcam eye tracking on real webcams (PR #37), and the
mobile app on real Android and iOS devices and in the app stores (PR #40; it has been type-checked,
unit-tested and previewed on the web only).
