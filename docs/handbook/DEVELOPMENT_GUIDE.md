# Development guide

How to set up a machine, run SampCode, and make the common kinds of change. Every command below exists in
the repository's `package.json` files or scripts; they were run on 2026-11-05 on this branch
(install, build, migrate, seed and the 590 unit and API tests all passed).

## 1. Set up a development machine

### What you need

| Tool       | Version                                       | Check                                     |
| ---------- | --------------------------------------------- | ----------------------------------------- |
| Node.js    | 26 LTS (`engines.node >= 26`, `.nvmrc`)       | `node -v`                                 |
| pnpm       | 10.28.0 (`packageManager`)                    | `pnpm -v` (`corepack enable` installs it) |
| PostgreSQL | 16                                            | `psql --version`, or use Docker           |
| Docker     | optional, for the full stack and image builds | `docker info`                             |
| Terraform  | optional, only for `infra/terraform` checks   | `terraform -version`                      |

### Step by step

```bash
# 1. get the code (use the branch you want to work on)
git clone https://github.com/kunalsharma-ai/Sampledge-ZAPX.git
cd Sampledge-ZAPX
git checkout main                        # everything is merged into main

# 2. settings
cp .env.example .env                     # edit DATABASE_URL if needed; see CONFIGURATION.md

# 3. dependencies (also installs the git hooks that scan for secrets)
pnpm install

# 4. a database
docker compose up -d postgres            # PostgreSQL 16 with user/password/db zapx/zapx on :5432
#   …or your own server:
#   createuser -P zapx && createdb -O zapx zapx

# 5. build everything (generates the Prisma client, compiles packages and apps)
pnpm build

# 6. tables and a first admin
pnpm db:migrate
pnpm db:seed                             # demo admin from SEED_EMAIL / SEED_PASSWORD (defaults in packages/db/src/seed.ts)
```

### Run the apps

Each in its own terminal, after loading `.env`:

```bash
set -a; . ./.env; set +a
node apps/api/dist/main.js               # API     http://localhost:4000/api  (also runs jobs and callbacks)
pnpm --filter @zapx/studio start         # Studio  http://localhost:3000
pnpm --filter @zapx/runtime preview      # Respondent runtime http://localhost:5173
pnpm --filter @zapx/capi preview         # Interviewer app    http://localhost:5174
```

Mobile app _(PR #40)_, which is its own npm project outside the pnpm workspace:

```bash
cd apps/mobile
npm ci
npm start              # Expo dev server: scan the QR code with Expo Go, or press w for the web preview
npm run typecheck && npm test
```

On a phone, sign in with your computer's network address and the studio port, for example
`http://192.168.x.x:3000`, not `localhost`.

Super admin _(PR #41)_ on your machine: `pnpm db:seed` also creates one (`SEED_SUPER_EMAIL` /
`SEED_SUPER_PASSWORD`, development defaults in `packages/db/src/seed.ts`), or run
`node apps/api/dist/cli/set-super-admin.js <your email>`. Then open http://localhost:3000/super-admin.

Development servers with reload: `pnpm --filter @zapx/studio dev`, `pnpm --filter @zapx/runtime dev`,
`pnpm --filter @zapx/capi dev`. The API has no watch mode: `pnpm --filter @zapx/api dev` compiles once
and starts; re-run it after a change. `pnpm dev` runs every package's `dev` script in parallel.

Optional separate worker (like production): start the API with `JOB_WORKER=off CALLBACK_WORKER=off`
and run `node apps/api/dist/worker.js`.

Everything in containers instead: `docker compose up --build` (studio :3000, runtime :5173, CAPI
:5174, API :4000, plus a worker and a one-off migration).

### First things to try

Sign in at http://localhost:3000, create a project, add a vendor (**+ Sampledge preset**), create a
survey, paste [docs/examples/demo-screener.json](../examples/demo-screener.json) into the JSON tab,
publish, set it live, and create a link under **Distribution**. Open the link to take the survey.

## 2. Everyday commands

| Command                                                     | What it does                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ | ------------- |
| `pnpm build`                                                | builds all packages and apps with Turborepo (cached)                                                                                            |
| `pnpm typecheck`                                            | TypeScript checks everywhere                                                                                                                    |
| `pnpm lint`                                                 | ESLint (`eslint.config.mjs`)                                                                                                                    |
| `pnpm format` / `pnpm format:check`                         | Prettier write / check (also checks Markdown)                                                                                                   |
| `pnpm test`                                                 | unit tests in packages + API tests (needs the database in `.env`)                                                                               |
| `pnpm --filter @zapx/api test -- test/m6.test.ts`           | one API test file                                                                                                                               |
| `pnpm --filter @zapx/logic-engine test`                     | one package's tests                                                                                                                             |
| `set -a; . ./.env; set +a; pnpm e2e`                        | Playwright browser tests (build first; it starts the apps itself)                                                                               |
| `pnpm check`                                                | the full quality gate: install, secret scan, format, lint, build, typecheck, migrate, tests, audit, Terraform (if installed), e2e, Docker build |
| `pnpm check --quick`                                        | format, lint, build, typecheck and tests only                                                                                                   |
| `pnpm check --no-e2e` / `--no-docker`                       | skip those steps                                                                                                                                |
| `pnpm secrets:scan`                                         | look for secrets in tracked files                                                                                                               |
| `pnpm --filter @zapx/db migrate:dev --name <change>`        | create a migration from schema changes                                                                                                          |
| `node apps/api/dist/cli/set-plan.js <org id or email> <free | team                                                                                                                                            | business | enterprise>` | change a plan |

Run `pnpm check` before merging. GitHub Actions does not run on this account, so this is the only
gate ([ADR 0009](../adr/0009-local-quality-gates.md)).

## 3. Rules that keep SampCode consistent

These come from `docs/architecture.md` and the ADRs, and the code follows them. Break them only with
a new ADR.

1. **One survey format.** Anything about the questionnaire goes into
   `packages/survey-schema/src/index.ts`. Do not add a second questionnaire model or table.
2. **One logic engine.** Conditions, validation, routing and quotas are in `packages/logic-engine`,
   used by the server, studio preview, QA lab and CAPI app. Do not re-implement them in a component.
3. **The server decides.** The runtime only shows what the API returns.
4. **Presentation never changes logic.** Themes and translations are keyed by question id.
5. **Published versions never change.**
6. **AI proposes, people approve.** AI output becomes a change set.
7. **Every query is scoped.** Use `AccessService` (projects, surveys, vendors) and always filter by
   `tenantId`. Use `prisma.forTenant()` for studio reads of respondent data.
8. **Validate every body** with a Zod schema and `parseBody`.
9. **Audit every change** with `AuditService.record`.
10. **No real integration without real verification.** New providers are off by default behind a
    switch in `config.ts` and an adapter interface.

## 4. How to make common changes

Each recipe lists the files in the order you should change them. After any change: `pnpm build`,
`pnpm test`, and the relevant e2e spec.

### Add a new studio page

Example: a "Reports" page at `/reports`.

1. Create `apps/studio/app/reports/page.tsx`. Start with `'use client';`, wrap the content in
   `<Shell>` from `@/components/Shell`, load data with `api()` from `@/lib/api`, and get the member
   with `useMe()` from `@/lib/useMe`. Copy the structure of `apps/studio/app/library/page.tsx`.
   From PR #39 every signed-in page starts with `PageHeader` from `@/components/neon/PageHeader`
   (icon, eyebrow, title, actions); keep the heading text, e2e tests look for it.
2. Add a menu item in `apps/studio/components/Shell.tsx` (the `items.push({ href, label, icon })`
   list; icons from `lucide-react`). Hide it for roles that cannot use it.
3. Add styles to `apps/studio/app/globals.css` using the existing `--q-*` custom properties.
4. Add an e2e test in `e2e/tests/` that opens the page. Keep only one link whose name contains
   "Projects" or "Settings" per page (existing specs match names by substring).

### Add a new form

1. Build the form in a component under `apps/studio/components/` with controlled React state.
2. Submit with `api('/path', { method: 'POST', body })` (the CSRF header is added for you). Catch
   `ApiError` and show it with `ErrorNote`.
3. Show the server's validation issues: `ApiError.body.issues` is `[{path, message}]`.
4. Make the matching API route validate the same fields with Zod (next recipes). The server is the
   source of truth; client checks are only for convenience.

### Add a field to an existing table

Example: a free-text `notes` field on projects.

1. `packages/db/prisma/schema.prisma`: add `notes String?` to `model Project` with a `///` comment.
2. `pnpm --filter @zapx/db migrate:dev --name project_notes` (creates
   `packages/db/prisma/migrations/<timestamp>_project_notes/migration.sql`), then `pnpm --filter @zapx/db build`.
3. `apps/api/src/projects/projects.controller.ts`: add `notes: z.string().max(5000).optional()` to
   `createSchema` (and an update route if editing is needed). Controllers that `select` columns
   explicitly must list the new one.
4. Studio: `apps/studio/app/projects/[id]/page.tsx` and the create form in
   `apps/studio/components/neon/CreateSurvey.tsx` / `ProjectsSection.tsx`.
5. Export or analysis? Only if it is respondent data: `apps/api/src/exports/export.service.ts`.
6. Tests: add a case to the relevant `apps/api/test/*.test.ts`.

Fields inside the **survey definition** (not a table) are different: change
`packages/survey-schema/src/index.ts`, keep them optional with a default so published versions still
parse, then the logic engine and editors. No migration.

### Create a new API endpoint

Example: `GET /api/projects/:id/summary`.

1. Pick the module folder (`apps/api/src/projects/`). Add a method to the controller:

   ```ts
   @Get(':id/summary')
   async summary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
     const project = await this.prisma.project.findFirst({ where: { id, ...this.access.projects(user) } });
     if (!project) throw new NotFoundException('Project not found');
     return { … };
   }
   ```

2. Decide who may call it: no decorator = every signed-in role except interviewers;
   `@Roles(...CAN_EDIT)` for programmers and admins; `@Roles('ADMIN')`; `@Public()` only for
   respondent or partner routes that check something else.
3. Validate input with a Zod schema and `parseBody` (`apps/api/src/common/validation.ts`).
4. Put real logic in a service (`*.service.ts`). A **new** controller or service must be added to
   `controllers` / `providers` in `apps/api/src/app.module.ts` (or to `integrations.module.ts` for that
   module).
5. Record changes with `this.audit.record(user, 'project.something', 'project', id, data)`.
6. Add a rate limit with `@Throttle({ default: { limit: N, ttl: 60_000 } })` if it is expensive.
7. Call it from the studio with `api('/projects/' + id + '/summary')`.
8. Test it in `apps/api/test/` with Supertest (copy the setup from an existing file).
9. If partners use it, document it in `docs/api/openapi.yaml`.
10. _(PR #41)_ If the route belongs to a feature that plans can switch off, add its path pattern to
    `RULES` in `apps/api/src/super-admin/features.ts`. A route that is not listed there is open to
    every plan (see [SECURITY_REVIEW.md S10](SECURITY_REVIEW.md)). A new feature key also goes in
    `FEATURES` there and, if the mobile app uses it, in `apps/mobile/src/lib/features.ts`.
11. Add the route to [API_DOCUMENTATION.md](API_DOCUMENTATION.md).

### Modify an existing API

1. Find the route in [API_DOCUMENTATION.md](API_DOCUMENTATION.md) (the table links to the handler).
2. Search the front ends for its path (`grep -rn "/projects/" apps/studio apps/runtime apps/capi`) to
   see every caller.
3. Prefer additive changes (new optional fields). Removing or renaming a field breaks the studio,
   partners (vendor API, webhooks) or CAPI apps already installed on devices.
4. Update the Zod schema, the service and the callers together; run the module's API test and e2e spec.

### Add a database table

1. Add the `model` in `schema.prisma` with `id String @id @default(cuid())`, `tenantId String`,
   `createdAt DateTime @default(now())`, and indexes for how you will query it
   (`@@index([tenantId, …])`). Add `deletedAt DateTime?` if it should be soft-deleted.
2. Create the migration (`migrate:dev`), rebuild `@zapx/db`.
3. Access it only from the module's service (or repository), always filtering by `tenantId`.
4. If it holds respondent data that studio users read, consider a row-level-security policy like the
   one for `Response` (raw SQL in the migration; see `20261102120000_m6_enterprise`).
5. If rows expire, add a delete to `JobWorker.housekeeping` (`apps/api/src/jobs/job.worker.ts`).
6. Document it in [DATABASE.md](DATABASE.md) (regenerate the tables or add a section).

### Update validation rules

| What                                                      | Where                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Request bodies                                            | the Zod schema at the top of the controller (e.g. `vendorSchema`, `linkSchema`)                         |
| Survey structure (what is a valid survey)                 | `packages/survey-schema/src/index.ts`                                                                   |
| Logic check (warnings and errors before publish)          | `packages/logic-engine/src/analyze.ts`                                                                  |
| Respondent answers (required, ranges, custom validations) | `packages/logic-engine/src/interview.ts` (`validatePage`); messages in `SYSTEM_MESSAGES` (translatable) |
| Passwords                                                 | `apps/api/src/auth/password-policy.ts` and the schemas in `auth.controller.ts` / `users.controller.ts`  |
| Environment variables                                     | `apps/api/src/config.ts`                                                                                |
| Upload types and sizes                                    | `apps/api/src/imports/documents.ts`, `media/media.service.ts`, `captures/capture.service.ts`            |

### Modify reports or dashboards

- **Analysis tables and statistics:** `packages/analysis-core/src/index.ts` (pure functions, tested in
  `analysis.test.ts`), called by `apps/api/src/analysis/analysis.service.ts`, shown by
  `apps/studio/components/Analysis.tsx`. Weighting is `packages/analysis-core/src/weighting.ts`.
- **Saved reports:** the config shape is validated in `analysis.service.ts`; stored in `Report.config`.
- **Chart dashboards** _(PR #34)_: a saved report of tiles, `POST /api/surveys/:id/analysis/dashboard`.
- **Fieldwork dashboard:** `packages/quality-core/src/fieldwork.ts` + `QualityService.fieldwork`,
  shown in `apps/studio/components/Quality.tsx`.
- **Home dashboard** _(PR #29)_: `apps/api/src/dashboard/dashboard.controller.ts` and
  `apps/studio/app/page.tsx`, charts in `apps/studio/components/neon/Charts.tsx` (plain SVG).
- **Exports:** `apps/api/src/exports/export.service.ts`.

### Add a user role or change permissions

Roles touch many files; plan carefully.

1. `packages/db/prisma/schema.prisma` `enum Role` + migration.
2. `apps/api/src/auth/auth.types.ts`: `RoleName` and the `RANK` table used by `lowerRole` (API keys).
3. `apps/api/src/auth/decorators.ts`: groups such as `CAN_EDIT`, `ALL_ROLES`.
4. `apps/api/src/auth/auth.guard.ts`: today `INTERVIEWER` is deny-by-default; decide whether the new
   role is too.
5. Go through every `@Roles(...)` in `apps/api/src` (`grep -rn "@Roles" apps/api/src`) and the
   in-method checks (`grep -rn "role !== 'ADMIN'\|role === 'ADMIN'" apps/api/src`).
6. Users and SCIM: role validation in `apps/api/src/users/users.controller.ts` and
   `apps/api/src/scim/scim.controller.ts`; SSO just-in-time roles in `TenantSso.jitRole`.
7. Plans: `apps/api/src/plans/plan.service.ts` counts seats and interviewers.
8. Studio: `apps/studio/lib/api.ts` (`Me.role`), `components/Shell.tsx` (menu), `components/Team.tsx`
   (role picker), and pages that use `me.role` (e.g. `readOnly = me?.role === 'VIEWER'` in
   `app/surveys/[id]/page.tsx`).
9. Tests: the M5 and M6 API tests walk routes as limited roles; extend them.

To give a project-level permission instead of a new role, use project access
(`ProjectMember`, `AccessService`). To sell a capability per plan instead, use a feature
(`apps/api/src/super-admin/features.ts`) _(PR #41)_. The super admin is a flag (`User.superAdmin`),
not a role; do not add it to `@Roles`.

### Modify business logic

| Logic                                           | File                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| What page comes next, skip logic, piping        | `packages/logic-engine/src/interview.ts`, `flow.ts`, `expression.ts`                      |
| Entry checks, re-entry, device rules            | `apps/api/src/interview/interview.service.ts` (`start`)                                   |
| Quota counting and least-fill                   | `apps/api/src/quotas/quota-places.ts`                                                     |
| Outcome redirects and status words              | `packages/redirect-core/src/layers.ts`, `template.ts`, `presets.ts`                       |
| Callback retries                                | `packages/redirect-core/src/callbacks.ts`, `apps/api/src/integrations/callback.worker.ts` |
| Quality score                                   | `packages/quality-core/src/assess.ts`, `open-ends.ts`                                     |
| Review decisions (accept/reject, quota release) | `apps/api/src/quality/quality.service.ts` (`decide`)                                      |
| CAPI sync rules                                 | `apps/api/src/capi/capi.service.ts`, `packages/logic-engine/src/replay.ts`                |
| CATI queue, retries, calling hours              | `apps/api/src/cati/cati.service.ts`, `calling-rules.ts`                                   |
| Plan limits                                     | `apps/api/src/plans/plans.ts`, `plan.service.ts`                                          |
| Automation rules _(PR #34)_                     | `apps/api/src/automation/automation-rules.ts`, `automation.service.ts`                    |
| Retention _(PR #34)_                            | `apps/api/src/governance/governance.service.ts`                                           |

Pure packages have fast unit tests next to the code; write the test first, then change the function.

## 5. Quick reference

| Task                                           | Files to check                                                                                                                                                                              | What to modify                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Fix login issue                                | `apps/api/src/auth/auth.controller.ts`, `auth.guard.ts`, `session.ts`, `sso.service.ts`, `apps/studio/app/login/page.tsx`, `apps/studio/lib/api.ts`, `.env` (`JWT_SECRET`, `COOKIE_SECURE`) | lockout/disabled state on the `User` row, cookie settings, CSRF header, SSO enforcement (`TenantSso.enforced`) |
| Add new page                                   | `apps/studio/app/<route>/page.tsx`, `apps/studio/components/Shell.tsx`, `apps/studio/app/globals.css`                                                                                       | new page file, menu item, styles                                                                               |
| Change database field                          | `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/`, the module's controller Zod schema and service, the studio component                                                  | schema + new migration, validation, reads/writes, UI                                                           |
| Modify API                                     | the controller and service in `apps/api/src/<module>/`, callers in `apps/studio`, `apps/runtime`, `apps/capi`, `docs/api/openapi.yaml` for partner routes                                   | handler, schema, callers, tests                                                                                |
| Fix frontend issue                             | the page in `apps/studio/app/`, the component in `apps/studio/components/`, `packages/survey-renderer/src/index.tsx` (respondent screens), `apps/runtime/src/App.tsx`                       | the component; check the browser console and the network tab for the API answer                                |
| Change business logic                          | `packages/logic-engine`, `packages/redirect-core`, `packages/quality-core`, `packages/analysis-core`, or the module service in `apps/api/src`                                               | the pure function first (with its unit test), then the service                                                 |
| Add a setting                                  | `apps/api/src/config.ts`, `.env.example`, `infra/terraform/ecs.tf` / `variables.tf`                                                                                                         | Zod field with a safe default                                                                                  |
| Change respondent redirect                     | vendor in the studio, or `packages/redirect-core`, `apps/api/src/integrations/integration-config.ts`                                                                                        | URLs/status words (data), or precedence logic (code)                                                           |
| Change an email/SMS                            | `apps/api/src/distribution/distribution.service.ts`, `mailer.ts`, `sms.ts`                                                                                                                  | template rendering and sending                                                                                 |
| Turn a feature on or off for a plan _(PR #41)_ | super admin console (`/super-admin/plans`, `/super-admin/organizations`), `apps/api/src/super-admin/features.ts`, `apps/mobile/src/lib/features.ts`                                         | plan features (data) or the route map and catalog (code)                                                       |
| Change a provider key _(PR #38)_               | Settings → Integrations in the studio, `apps/api/src/platform/integrations.ts`                                                                                                              | saved values (data) or the field list (code)                                                                   |
| Change a mobile screen _(PR #40)_              | `apps/mobile/src/app/`, `src/screens/survey/`, `src/lib/api.ts`                                                                                                                             | the screen; wrap gated parts in `<Gate>` / `<IfFeature>`                                                       |
| Add a background task                          | `apps/api/src/jobs/job.worker.ts`, `jobs.controller.ts`                                                                                                                                     | job type and handler, or a step in `pass()` / `housekeeping()`                                                 |

## 6. Version control habits used in this repository

- Work happens on a branch per milestone; each becomes a pull request. Stacked PRs are merged in
  order with merge commits.
- Commit hooks (`.githooks/pre-commit`, `pre-push`) run the secret scan. If a commit "does nothing",
  the hook may have blocked it: read its output.
- Every change of behaviour gets a test, and every significant decision an ADR in `docs/adr/`
  (copy an existing one; update `docs/adr/README.md`).
