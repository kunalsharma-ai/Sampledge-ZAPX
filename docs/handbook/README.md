# ZAPX maintainer handbook

This folder explains how ZAPX is built so that you can find the right file when something breaks,
understand what a change will affect, and add features safely. It was written by reading the code on
branch `blueprint-p5-enterprise` (the top of the open pull-request stack, PR #34, commit `252ac32`)
on 2026-11-05. Everything here points at real files; anything that could not be checked from the code
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

## Quick start (local machine)

Needs Node 22, pnpm 10.28 and PostgreSQL 16. Full detail and alternatives (Docker) are in
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
```

Before merging any change run `pnpm check` (or `pnpm check --quick` while working). The GitHub
Actions workflows exist but do not run on this account, so the local check is the quality gate
([ADR 0009](../adr/0009-local-quality-gates.md)).

## Which features are merged and which are still in open pull requests

`main` holds milestones 1 to 20 (PRs #1–#19 and #26, merged 2026-11-02). Everything below is built
and tested on its branch but **not merged into `main` yet**. The PRs are stacked: each one contains
the one before it, so they must be merged in this order.

| PR  | Branch                         | Based on                       | What it adds                                                                                                                                                                                                                            |
| --- | ------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #27 | `quantum-design-system`        | `main`                         | `packages/quantum` theme engine (presets, WCAG contrast), personal and organization appearance, the Appearance page and theme menu ([ADR 0027](../adr/0027-quantum-design-system.md))                                                   |
| #29 | `neon-ai-dashboard`            | `quantum-design-system`        | Neon AI default theme, the sidebar shell, home dashboard (`GET /api/dashboard`) and global search; projects list moves to `/projects` ([ADR 0028](../adr/0028-neon-dashboard.md))                                                       |
| #30 | `blueprint-p1-core`            | `neon-ai-dashboard`            | Loops, random blocks, calculated variables, live quota targets, ZAPX XML programmer view, logic debugger, question bank and templates, card sort and hot-spot questions ([ADR 0029](../adr/0029-blueprint-core-engineering.md))         |
| #31 | `blueprint-p2-ai-multilingual` | `blueprint-p1-core`            | Translation memory, glossary, right-to-left languages, URL variables, least-fill blocks, saved QA test cases, voice commands, 16 theme families ([ADR 0030](../adr/0030-blueprint-multilingual-and-qa.md))                              |
| #32 | `blueprint-p3-fieldwork`       | `blueprint-p2-ai-multilingual` | CAPI evidence (page times, interruptions, geofences), signature and barcode questions, back-checks, appeals, supervisor dashboard, email invitations through SendGrid ([ADR 0031](../adr/0031-blueprint-fieldwork-and-security.md))     |
| #33 | `blueprint-p4-research`        | `blueprint-p3-fieldwork`       | MaxDiff and conjoint, recodes, AI research assistant (`insights` task), CAPI video, least-fill quota groups, bank blocks, suggested test cases, device matrix ([ADR 0032](../adr/0032-blueprint-research-intelligence.md))              |
| #34 | `blueprint-p5-enterprise`      | `blueprint-p4-research`        | Automation rules and notifications, data residency and retention, cleaning rules, segments, chart dashboards, SMS invitations through Twilio, area themes and workspace presets ([ADR 0033](../adr/0033-blueprint-enterprise-scale.md)) |

**Not in this branch:** PR #28 (`integrations-in-crm`, configure integrations from Settings →
Integrations instead of environment variables) is open against `main` but is **not part of this
stack**, so none of its files (`apps/api/src/platform/integrations.ts`, the `PlatformIntegration`
table, `/settings/integrations`) exist here. In this branch every integration is configured with
environment variables ([CONFIGURATION.md](CONFIGURATION.md)). When #28 and this stack are both merged,
parts of this handbook (configuration, integrations) need updating. The six Dependabot PRs (#20–#25)
are also open and unrelated.

Throughout the handbook, features from the open PRs are tagged like this: _(PR #33, unmerged)_.

## What has never run against a real service

These parts are written and tested against local stand-ins only, so treat them as unproven until you
have tried them on a staging environment ([docs/operations/go-live.md](../operations/go-live.md)):
Claude AI calls, S3 storage, OpenID Connect and SAML sign-in, SCIM, Stripe billing, the AWS Terraform
and release script, PROJEXA (checked against its code, not a deployed PROJEXA), IPinfo, Deepgram,
Twilio (voice and SMS) and SendGrid.
