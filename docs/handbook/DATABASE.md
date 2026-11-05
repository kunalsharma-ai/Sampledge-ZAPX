# Database

ZAPX stores everything in one **PostgreSQL 16** database, accessed only through **Prisma 6**
(`packages/db`). This file lists every table (Prisma "model"), field, relationship and index on branch
`blueprint-p5-enterprise`, generated from `packages/db/prisma/schema.prisma` and checked against the
migrations. ZAPX does not use MongoDB.

## 1. The essentials

| Question                | Answer                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database name           | `zapx` locally and in Docker (`.env.example`, `docker-compose.yml`); on AWS `DB_NAME` (default `zapx`, `apps/api/src/database-url.ts`)                                                                                                                 |
| Connection setting      | `DATABASE_URL=postgresql://user:password@host:5432/zapx?connection_limit=10&pool_timeout=20`, or `DB_HOST` + `DB_USER` + `DB_PASSWORD` (+ `DB_PORT`, `DB_NAME`, `DB_SSLMODE`, `DB_CONNECTION_LIMIT`)                                                   |
| Schema file             | `packages/db/prisma/schema.prisma` (51 models with `PasswordReset` from branch `security-fixes`, 22 enums)                                                                                                                                             |
| Migrations              | `packages/db/prisma/migrations/` — 28 folders (the last, `20261117000000_password_reset`, from branch `security-fixes`), one per milestone/phase, applied in name order                                                                                |
| Client used by the code | `PrismaService` (`apps/api/src/common/prisma.service.ts`), which extends the generated `PrismaClient` from `@zapx/db`                                                                                                                                  |
| Seed                    | `packages/db/src/seed.ts`: one organization "Demo tenant" and an admin account whose email and password are set by `SEED_EMAIL` and `SEED_PASSWORD` (the development defaults are in `seed.ts`; never use them outside your laptop). Development only. |
| Ids                     | `cuid()` strings, except `Response.id` (UUID set by the code), `MediaAsset.id` and `Capture.id` (22-character random ids, because they appear in URLs), `CatiDial.id` (random)                                                                         |

### How the questionnaire is stored

The survey itself is **not** spread over tables. Each `SurveyVersion` row holds:

- `definition` (JSON): the whole questionnaire in the format of `surveyDefinitionSchema`
  (`packages/survey-schema/src/index.ts`): pages, questions, options, conditions, terminations,
  quotas, loops, blocks, variables, recodes, cleaning rules, URL variables and settings. See
  [docs/examples/demo-screener.json](../examples/demo-screener.json) for an example.
- `presentation` (JSON): theme, device rules and translations (`presentationSchema`).

Answers are stored the same way: `Response.answers` is a JSON object `{ "<questionId>": value }`
(for grids `"<GRID>_<rowId>"`, for loops `"<Q>_<itemCode>"`). This keeps the survey format flexible,
but it means **you cannot rename a question id** once responses exist without migrating their JSON.

## 2. Relationships (entity diagram)

Only relations declared in Prisma (real foreign keys) are drawn. Many tables also carry `tenantId`,
`surveyId`, `userId` or `responseId` columns **without** a declared foreign key; those are "logical"
links enforced only by the code (listed in section 4).

```mermaid
erDiagram
  Tenant ||--o{ User : has
  Tenant ||--o{ Project : has
  Tenant ||--o| TenantAiPolicy : has
  Tenant ||--o| TenantSso : has
  Tenant ||--o| TenantScim : has
  Project ||--o{ Survey : contains
  Project ||--o{ Vendor : contains
  Project ||--o{ ProjectMember : grants
  User ||--o{ ProjectMember : "is member"
  User ||--o{ ApiKey : creates
  User ||--o{ CapiAssignment : "assigned to"
  User ||--o{ Response : "interviews (CAPI)"
  Survey ||--o{ SurveyVersion : versions
  Survey ||--o{ Response : collects
  Survey ||--o{ QuotaCount : counts
  Survey ||--o{ QaRun : tested
  Survey ||--o{ ChangeSet : proposals
  Survey ||--o{ CapiAssignment : assigns
  Survey ||--o{ CatiCase : "call list"
  Survey ||--o{ Report : reports
  Survey ||--o{ MediaAsset : media
  SurveyVersion ||--o{ Response : "answered with"
  Vendor ||--o{ Response : sources
  Vendor ||--o{ RedirectEvent : logs
  Vendor ||--o{ OutboundCallback : callbacks
  Response ||--o{ Capture : evidence
  CatiCase ||--o{ CatiCall : calls
  Webhook ||--o{ WebhookDelivery : deliveries
  Job ||--o{ StoredFile : files
  Distribution ||--o{ Invitation : sends
  AutomationRule ||--o{ AutomationRun : runs
```

## 3. Tables by area

| Area                      | Tables                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organizations and people  | `Tenant`, `User`, `ProjectMember`, `TenantSso`, `SsoRequest`, `TenantScim`, `ApiKey`, `RevokedSession`, `PasswordReset` _(branch `security-fixes`)_, `BillingEvent` |
| Surveys                   | `Project`, `Survey`, `SurveyVersion`, `ChangeSet`, `QaRun`, `QaTestCase`, `LibraryItem`, `GlossaryTerm`, `MediaAsset`, `BlockExposure`                              |
| Fieldwork and responses   | `Vendor`, `Response`, `QuotaCount`, `OpenEndFingerprint`, `FraudBlock`, `Capture`, `CapiAssignment`, `BackCheck`, `QualityAppeal`                                   |
| Phone (CATI)              | `CatiCase`, `CatiCall`, `CatiSettings`, `DoNotCall`, `CatiDialer`, `CatiDial`                                                                                       |
| Distribution              | `Contact`, `Distribution`, `Invitation`                                                                                                                             |
| Integrations and outboxes | `RedirectEvent`, `OutboundCallback`, `Webhook`, `WebhookDelivery`                                                                                                   |
| AI                        | `TenantAiPolicy`, `AiUsage`                                                                                                                                         |
| Jobs and files            | `Job`, `StoredFile`                                                                                                                                                 |
| Analysis                  | `Report`                                                                                                                                                            |
| Automation _(PR #34)_     | `AutomationRule`, `AutomationRun`, `Notification`                                                                                                                   |
| Audit                     | `AuditEvent`                                                                                                                                                        |

Tables that exist only on the open PR branches (not on `main`): `LibraryItem` (#30), `GlossaryTerm`,
`BlockExposure`, `QaTestCase` (#31), `BackCheck`, `QualityAppeal`, `Contact`, `Distribution`,
`Invitation` (#32), `AutomationRule`, `AutomationRun`, `Notification` (#34). Columns added by PR #27
(`User.preferences`, `Tenant.appearanceDefaults`) and later phases are in migrations
`20261110000000_quantum_appearance` onwards.

## 4. Logical links (no database foreign key)

The code relies on these columns pointing at the right row, but PostgreSQL does not check them. A
bad value will not raise an error; it will just make the row invisible to queries that join on it.

| Column(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Points at          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `tenantId` on `Survey`, `Vendor`, `Response`, `AuditEvent`, `QaRun`, `ChangeSet`, `RedirectEvent`, `OutboundCallback`, `AiUsage`, `CapiAssignment`, `CatiCase`, `CatiCall`, `ApiKey`, `Webhook`, `WebhookDelivery`, `Job`, `StoredFile`, `Report`, `MediaAsset`, `Capture`, `FraudBlock`, `LibraryItem`, `GlossaryTerm`, `QaTestCase`, `BackCheck`, `QualityAppeal`, `Contact`, `Distribution`, `Invitation`, `AutomationRule`, `AutomationRun`, `Notification`, `ProjectMember`, `CatiSettings`, `DoNotCall`, `CatiDialer`, `CatiDial`, `SsoRequest` | `Tenant.id`        |
| `Survey.liveVersionId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `SurveyVersion.id` |
| `surveyId` on `RedirectEvent`, `OpenEndFingerprint`, `Job`, `StoredFile`, `Capture`, `CatiSettings`, `CatiDialer`, `CatiDial`, `BlockExposure`, `QaTestCase`, `BackCheck`, `QualityAppeal`, `Contact`, `Distribution`, `AutomationRule`                                                                                                                                                                                                                                                                                                               | `Survey.id`        |
| `responseId` on `RedirectEvent`, `OutboundCallback`, `OpenEndFingerprint`, `CatiCase`, `FraudBlock`, `BackCheck`, `QualityAppeal`                                                                                                                                                                                                                                                                                                                                                                                                                     | `Response.id`      |
| `QaRun.versionId`, `ChangeSet.baseVersionId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `SurveyVersion.id` |
| `createdById`, `updatedById`, `decidedById`, `reviewedById`, `uploadedById`, `sampledById`, `checkedById`, `raisedById`, `addedById`, `actorId`, `userId`, `interviewerId` (except `Response` and `CapiAssignment`), `lockedById`                                                                                                                                                                                                                                                                                                                     | `User.id`          |
| `CatiDial.caseId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `CatiCase.id`      |
| `CatiDial.captureId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `Capture.id`       |
| `Invitation.contactId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `Contact.id`       |

## 5. Indexes, unique rules and database-level security

- **Unique rules that protect business logic** (a violation is a bug or a duplicate):
  `User.email` (one account per email across all organizations), `Vendor (projectId, code)`,
  `Response (surveyId, vendorId, uid)` (duplicate-UID protection), `Response.sessionTokenHash`,
  `Response.clientId` (CAPI uploads stored once), `SurveyVersion (surveyId, version)`,
  `QuotaCount (surveyId, quotaId)`, `RedirectEvent (responseId, status)`,
  `OutboundCallback.idempotencyKey` (one callback per outcome), `CatiCase (surveyId, code)`,
  `Contact (surveyId, email)` and `(surveyId, phone)`, `Invitation.uid`, `DoNotCall (tenantId, phoneHash)`,
  `FraudBlock (tenantId, kind, hash)`, `GlossaryTerm (tenantId, language, source)`, `ApiKey.prefix`.
  Note: in PostgreSQL a unique index treats `NULL` values as different, so `Response (surveyId, vendorId, uid)`
  does not stop two test interviews with no vendor and the same uid; the code checks that case itself.
- **Indexes** are listed under each table below (`@@index`). They follow the queries the code runs:
  by tenant and survey, by state and next-attempt time for outboxes, by time for logs.
- **Row-level security** (raw SQL in migrations `20261102120000_m6_enterprise` and
  `20261103000000_m12_fraud_capture`): `Response` and `Capture` have `FORCE ROW LEVEL SECURITY` with
  policy `zapx_tenant_isolation`. When the setting `app.tenant_id` is set (by
  `PrismaService.forTenant`), only that organization's rows are visible; when it is not set, all rows
  are visible (used by system paths such as the respondent flow and workers). PostgreSQL ignores the
  policy for superusers and `BYPASSRLS` roles; the local Docker user `zapx` is a superuser, so locally
  it is not enforced. Check with `GET /api/audit/security` (admins). Details:
  [ADR 0012](../adr/0012-row-level-security.md), [operations/database.md](../operations/database.md).
- **Soft delete**: `Project`, `Survey`, `Vendor` (and `StoredFile`, `MediaAsset`, `Capture`) have
  `deletedAt`. Queries filter `deletedAt: null` (centrally in `AccessService`). Rows are never removed.
- **Erasure, not deletion** _(PR #34)_: the retention policy clears answers and identifiers on
  `Response` and sets `erasedAt`; the row stays so counts remain true (`GovernanceService.applyRetention`).

## 6. How the code reads and writes (CRUD)

All database access is through Prisma; there is no hand-written SQL except a few `$queryRaw` /
`$executeRaw` calls (row-level security setting, the RLS self-check, `FOR UPDATE SKIP LOCKED` claims of
jobs, callbacks and automation runs). Patterns worth knowing:

| Pattern               | Where                                                                                                                                      | Why                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Scoped lookups        | `AccessService.projects/surveys/vendors(user)` added to every `findFirst/findMany`                                                         | tenant isolation and project access                   |
| Optimistic locking    | `SurveysService.saveDraft` compares `expectedUpdatedAt`; `ChangeSetsService` compares `baseUpdatedAt`                                      | two people editing the same draft                     |
| Conditional updates   | `response.updateMany({ where: { id, status: 'IN_PROGRESS', currentPage } })` in `InterviewService`                                         | double submits and races cannot advance twice         |
| Transactions          | `prisma.$transaction(...)` in publish, complete (quota places), project delete, register                                                   | all-or-nothing changes                                |
| Atomic quota counting | `takeQuotaPlaces` in `apps/api/src/quotas/quota-places.ts`                                                                                 | quotas never overfill                                 |
| Outbox rows           | `OutboundCallback`, `WebhookDelivery`, `Job`, `AutomationRun`, `Invitation`                                                                | work is recorded in the same database, then delivered |
| Tenant-scoped client  | `prisma.forTenant(tenantId)` for studio reads of responses, exports, review, fieldwork, analysis                                           | second line of defence (RLS)                          |
| Encrypted columns     | `TenantSso.clientSecretSealed`, `Vendor.partnerSecretEnc`, `Webhook.secretEnc`, `CatiCase.phoneSealed`, `User.phoneSealed` via `SecretBox` | secrets ZAPX must read back                           |
| Hashed columns        | `ApiKey.secretHash`, `TenantScim.secretHash`, `Response.sessionTokenHash`, `ipHash`, `deviceHash`, `DoNotCall.phoneHash`                   | never store the original                              |

## 7. Migrations

```bash
# create a new migration after editing schema.prisma (development database only)
pnpm --filter @zapx/db migrate:dev --name add_my_field
# apply all pending migrations (local, CI, every release)
pnpm db:migrate                      # = prisma migrate deploy with ../../.env
node apps/api/dist/cli/migrate.js    # same, inside the Docker image / ECS migration task
# regenerate the Prisma client after a schema change
pnpm --filter @zapx/db build
```

Rules from [operations/database.md](../operations/database.md): never edit a migration that has been
applied anywhere; make changes additive; remove a column in two releases (stop using it, then drop it).

## 8. Backup and restoration

| Environment           | Backup                                                                                                                                                     | Restore                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Local / single server | `DATABASE_URL=postgresql://... infra/scripts/backup.sh ./backups` (pg_dump custom format, keeps the newest 14, `KEEP=` to change)                          | `DATABASE_URL=postgresql://.../empty_db infra/scripts/restore.sh backups/zapx-<time>.dump` into an **empty** database |
| AWS (Terraform)       | RDS automated backups with point-in-time recovery (14 days) and AWS Backup daily plan for RDS and the files bucket (35 days) — `infra/terraform/backup.tf` | restore to a **new** instance or bucket, verify, then point a stack at it                                             |

Files (exports, media, photos, recordings) are **not** in the database: back up `FILES_DIR` (local)
or rely on the S3 bucket's versioning and AWS Backup. Test a restore regularly (quarterly is the
target in the operations guide). **Needs Verification:** the AWS backup plan has not been applied to a
real account yet.

## 9. Every table and field

Generated from `schema.prisma`. "Required" = the column is `NOT NULL`. Relation fields (the Prisma
objects that join tables) are summarised under "Relations".

#### Tenant

| Field                     | Type        | Required | Key / default            | Meaning                                                                                                                                                                   |
| ------------------------- | ----------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | `String`    | yes      | **PK**, default `cuid()` |                                                                                                                                                                           |
| `name`                    | `String`    | yes      |                          |                                                                                                                                                                           |
| `redirectDefaults`        | `Json`      | yes      | default `"{}"`           | Organization-level redirect defaults: {urls, words, countries} (lowest precedence).                                                                                       |
| `plan`                    | `String`    | yes      | default `"enterprise"`   | Plan code (Milestone 8): free, team, business or enterprise. Limits live in code (plans.ts).                                                                              |
| `billingCustomerId`       | `String?`   | no       | unique                   | Billing (Milestone 13): the Stripe customer and subscription behind the plan, when billing is on.                                                                         |
| `billingSubscriptionId`   | `String?`   | no       |                          |                                                                                                                                                                           |
| `billingStatus`           | `String?`   | no       |                          | Stripe subscription status (active, trialing, past_due, canceled, ...).                                                                                                   |
| `billingPeriodEnd`        | `DateTime?` | no       |                          |                                                                                                                                                                           |
| `appearanceDefaults`      | `Json`      | yes      | default `"{}"`           | Quantum Design System: the organization's default appearance for members who have not chosen their own.                                                                   |
| `appearancePresets`       | `Json`      | yes      | default `"[]"`           | Blueprint phase 5: saved workspace presets, [{id, name, appearance, modules}], shared with members.                                                                       |
| `dataRegion`              | `String?`   | no       |                          | Blueprint phase 5: the region the organization's data must stay in (e.g. "eu"), checked against the deployment's DATA_REGION; null when the organization has not set one. |
| `blockExternalProcessors` | `Boolean`   | yes      | default `false`          | Blueprint phase 5: when on, features that send data to a processor outside the deployment (AI, transcription) are refused for this organization.                          |
| `retention`               | `Json`      | yes      | default `"{}"`           | Blueprint phase 5: retention policy {responsesDays?, capturesDays?, contactsDays?} (null: keep).                                                                          |
| `createdAt`               | `DateTime`  | yes      | default `now()`          |                                                                                                                                                                           |

Relations: has many `User` (`users`); has many `Project` (`projects`); has one `TenantAiPolicy` (`aiPolicy`); has one `TenantSso` (`sso`); has one `TenantScim` (`scim`).

#### TenantSso

Single sign-on for one organization: OpenID Connect (Milestone 8) or SAML 2.0 (Milestone 13).

| Field                | Type         | Required   | Key / default    | Meaning                                                                                                    |
| -------------------- | ------------ | ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `tenantId`           | `String`     | yes        | **PK**           |                                                                                                            |
| `enabled`            | `Boolean`    | yes        | default `false`  |                                                                                                            |
| `protocol`           | `String`     | yes        | default `"OIDC"` | OIDC or SAML. The OIDC fields are empty for SAML and the SAML fields null for OIDC.                        |
| `samlEntryPoint`     | `String?`    | no         |                  | SAML: the identity provider's single sign-on URL (HTTP-Redirect binding).                                  |
| `samlIdpIssuer`      | `String?`    | no         |                  | SAML: the identity provider's entity ID (the Issuer of its responses).                                     |
| `samlCerts`          | `String[]`   | yes (list) | default `[]`     | SAML: the identity provider's signing certificates (PEM, public). Several during a rotation.               |
| `issuer`             | `String`     | yes        |                  |                                                                                                            |
| `clientId`           | `String`     | yes        |                  |                                                                                                            |
| `clientSecretSealed` | `String`     | yes        |                  | Client secret sealed with SecretBox.                                                                       |
| `domains`            | `String[]`   | yes (list) |                  | Email domains that sign in through this organization's identity provider (lower case).                     |
| `enforced`           | `Boolean`    | yes        | default `false`  | When true, members other than admins cannot sign in with a password.                                       |
| `jitRole`            | enum `Role?` | no         |                  | Create a member on first sign-in (just-in-time provisioning) with this role. Null = only existing members. |
| `updatedById`        | `String?`    | no         |                  |                                                                                                            |
| `updatedAt`          | `DateTime`   | yes        | auto-updated     |                                                                                                            |

Relations: `tenantId` → `Tenant.id`.

#### SsoRequest

A SAML sign-in in progress (Milestone 13): the AuthnRequest ID, used once to check InResponseTo.

| Field       | Type       | Required | Key / default   | Meaning |
| ----------- | ---------- | -------- | --------------- | ------- |
| `id`        | `String`   | yes      | **PK**          |         |
| `tenantId`  | `String`   | yes      |                 |         |
| `next`      | `String`   | yes      | default `"/"`   |         |
| `expiresAt` | `DateTime` | yes      |                 |         |
| `createdAt` | `DateTime` | yes      | default `now()` |         |

Indexes and constraints: `@@index([expiresAt])`.

#### PasswordReset

_Branch `security-fixes`._ One-time password reset link, created by an administrator
(`createdById` set) or by "forgot password" (`createdById` null). Only a SHA-256 hash of the token is
stored. Logical links (no foreign key): `userId` → `User.id`, `tenantId` → `Tenant.id`.

| Field         | Type        | Required | Key / default    | Meaning                                                           |
| ------------- | ----------- | -------- | ---------------- | ----------------------------------------------------------------- |
| `id`          | `String`    | yes      | **PK**, `cuid()` |                                                                   |
| `tenantId`    | `String`    | yes      |                  |                                                                   |
| `userId`      | `String`    | yes      |                  | the member whose password the link sets                           |
| `tokenHash`   | `String`    | yes      | unique           | SHA-256 (hex) of the token in the link                            |
| `expiresAt`   | `DateTime`  | yes      |                  | now + `PASSWORD_RESET_HOURS`                                      |
| `usedAt`      | `DateTime?` | no       |                  | set when used, or when a newer link or a password change voids it |
| `createdById` | `String?`   | no       |                  | the administrator; null for "forgot password"                     |
| `createdAt`   | `DateTime`  | yes      | default `now()`  |                                                                   |

Indexes and constraints: `@@unique([tokenHash])`, `@@index([userId, createdAt])`.

#### BillingEvent

Stripe webhook events already applied (Milestone 13), so a redelivered event changes nothing.

| Field       | Type       | Required | Key / default   | Meaning |
| ----------- | ---------- | -------- | --------------- | ------- |
| `id`        | `String`   | yes      | **PK**          |         |
| `type`      | `String`   | yes      |                 |         |
| `tenantId`  | `String?`  | no       |                 |         |
| `createdAt` | `DateTime` | yes      | default `now()` |         |

Indexes and constraints: `@@index([createdAt])`.

#### TenantScim

SCIM 2.0 provisioning token for one organization (Milestone 8). Stored hashed like API keys.

| Field         | Type        | Required | Key / default   | Meaning |
| ------------- | ----------- | -------- | --------------- | ------- |
| `tenantId`    | `String`    | yes      | **PK**          |         |
| `prefix`      | `String`    | yes      | unique          |         |
| `secretHash`  | `String`    | yes      |                 |         |
| `createdById` | `String`    | yes      |                 |         |
| `createdAt`   | `DateTime`  | yes      | default `now()` |         |
| `lastUsedAt`  | `DateTime?` | no       |                 |         |

Relations: `tenantId` → `Tenant.id`.

#### User

| Field               | Type                | Required | Key / default            | Meaning                                                                                                    |
| ------------------- | ------------------- | -------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `id`                | `String`            | yes      | **PK**, default `cuid()` |                                                                                                            |
| `tenantId`          | `String`            | yes      |                          |                                                                                                            |
| `email`             | `String`            | yes      | unique                   |                                                                                                            |
| `name`              | `String`            | yes      |                          |                                                                                                            |
| `passwordHash`      | `String`            | yes      |                          |                                                                                                            |
| `role`              | enum `Role`         | yes      | default `PROGRAMMER`     |                                                                                                            |
| `projectScope`      | enum `ProjectScope` | yes      | default `ALL`            |                                                                                                            |
| `disabledAt`        | `DateTime?`         | no       |                          | Disabled members cannot sign in, and their sessions and API keys stop working at once.                     |
| `preferences`       | `Json`              | yes      | default `"{}"`           | Personal preferences, e.g. {appearance: {...}} (Quantum Design System). Follows the member across devices. |
| `ssoSubject`        | `String?`           | no       |                          | Subject from the organization's identity provider (OIDC `sub`), set on first SSO sign-in.                  |
| `scimExternalId`    | `String?`           | no       |                          | The identity provider's id for this member when provisioned through SCIM.                                  |
| `createdAt`         | `DateTime`          | yes      | default `now()`          |                                                                                                            |
| `phoneSealed`       | `String?`           | no       |                          | Milestone 19: the phone the dialer rings for this interviewer (sealed), and its last digits.               |
| `phoneHint`         | `String?`           | no       |                          |                                                                                                            |
| `failedLogins`      | `Int`               | yes      | default `0`              | Milestone 20: failed password sign-ins in a row, and when the account may try again.                       |
| `lockedUntil`       | `DateTime?`         | no       |                          |                                                                                                            |
| `sessionsRevokedAt` | `DateTime?`         | no       |                          | Milestone 20: sessions issued before this moment no longer work ("sign out everywhere").                   |

Relations: `tenantId` → `Tenant.id`; has many `CapiAssignment` (`capiAssignments`); has many `Response` (`capiInterviews`); has many `ProjectMember` (`projects`); has many `ApiKey` (`apiKeys`).

Indexes and constraints: `@@unique([tenantId, ssoSubject])`; `@@index([tenantId])`.

#### Project

| Field              | Type        | Required | Key / default            | Meaning                                                                            |
| ------------------ | ----------- | -------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `id`               | `String`    | yes      | **PK**, default `cuid()` |                                                                                    |
| `tenantId`         | `String`    | yes      |                          |                                                                                    |
| `name`             | `String`    | yes      |                          |                                                                                    |
| `client`           | `String?`   | no       |                          |                                                                                    |
| `redirectDefaults` | `Json`      | yes      | default `"{}"`           | Project-level redirect defaults: {urls, words, countries}. Vendors override these. |
| `createdAt`        | `DateTime`  | yes      | default `now()`          |                                                                                    |
| `deletedAt`        | `DateTime?` | no       |                          | Soft delete: hidden everywhere, kept for audit and data retention.                 |

Relations: `tenantId` → `Tenant.id`; has many `Survey` (`surveys`); has many `Vendor` (`vendors`); has many `ProjectMember` (`members`).

Indexes and constraints: `@@index([tenantId, deletedAt])`.

#### ProjectMember

A member with ASSIGNED project scope can see and work on this project (Milestone 6).

| Field       | Type       | Required | Key / default   | Meaning |
| ----------- | ---------- | -------- | --------------- | ------- |
| `projectId` | `String`   | yes      |                 |         |
| `userId`    | `String`   | yes      |                 |         |
| `tenantId`  | `String`   | yes      |                 |         |
| `addedById` | `String?`  | no       |                 |         |
| `createdAt` | `DateTime` | yes      | default `now()` |         |

Relations: `projectId` → `Project.id`; `userId` → `User.id`.

Indexes and constraints: `@@id([projectId, userId])`; `@@index([userId])`.

#### Survey

| Field           | Type                | Required | Key / default            | Meaning                                                            |
| --------------- | ------------------- | -------- | ------------------------ | ------------------------------------------------------------------ |
| `id`            | `String`            | yes      | **PK**, default `cuid()` |                                                                    |
| `tenantId`      | `String`            | yes      |                          |                                                                    |
| `projectId`     | `String`            | yes      |                          |                                                                    |
| `name`          | `String`            | yes      |                          |                                                                    |
| `status`        | enum `SurveyStatus` | yes      | default `DRAFT`          |                                                                    |
| `liveVersionId` | `String?`           | no       |                          | The published version respondents currently receive.               |
| `createdAt`     | `DateTime`          | yes      | default `now()`          |                                                                    |
| `updatedAt`     | `DateTime`          | yes      | auto-updated             |                                                                    |
| `deletedAt`     | `DateTime?`         | no       |                          | Soft delete: hidden everywhere, kept for audit and data retention. |

Relations: `projectId` → `Project.id`; has many `SurveyVersion` (`versions`); has many `Response` (`responses`); has many `QuotaCount` (`quotaCounts`); has many `QaRun` (`qaRuns`); has many `ChangeSet` (`changeSets`); has many `CapiAssignment` (`capiAssignments`); has many `CatiCase` (`catiCases`); has many `Report` (`reports`); has many `MediaAsset` (`MediaAsset`).

Indexes and constraints: `@@index([tenantId, projectId, deletedAt])`.

#### SurveyVersion

| Field          | Type                 | Required | Key / default            | Meaning                                                                                                                                                            |
| -------------- | -------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`           | `String`             | yes      | **PK**, default `cuid()` |                                                                                                                                                                    |
| `surveyId`     | `String`             | yes      |                          |                                                                                                                                                                    |
| `version`      | `Int`                | yes      |                          |                                                                                                                                                                    |
| `definition`   | `Json`               | yes      |                          | Canonical survey definition (see @zapx/survey-schema). Immutable once published.                                                                                   |
| `status`       | enum `VersionStatus` | yes      | default `DRAFT`          |                                                                                                                                                                    |
| `presentation` | `Json`               | yes      | default `"{}"`           | Presentation layer: theme, translations and device settings (see presentationSchema). Versioned with the definition, so a published version always looks the same. |
| `checkReport`  | `Json?`              | no       |                          | Static logic analysis report captured at publish time.                                                                                                             |
| `createdById`  | `String?`            | no       |                          |                                                                                                                                                                    |
| `createdAt`    | `DateTime`           | yes      | default `now()`          |                                                                                                                                                                    |
| `updatedAt`    | `DateTime`           | yes      | auto-updated             |                                                                                                                                                                    |
| `publishedAt`  | `DateTime?`          | no       |                          |                                                                                                                                                                    |

Relations: `surveyId` → `Survey.id`; has many `Response` (`responses`).

Indexes and constraints: `@@unique([surveyId, version])`.

#### Vendor

| Field                 | Type                     | Required   | Key / default            | Meaning                                                                                    |
| --------------------- | ------------------------ | ---------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `id`                  | `String`                 | yes        | **PK**, default `cuid()` |                                                                                            |
| `tenantId`            | `String`                 | yes        |                          |                                                                                            |
| `projectId`           | `String`                 | yes        |                          |                                                                                            |
| `name`                | `String`                 | yes        |                          |                                                                                            |
| `code`                | `String`                 | yes        |                          | Vendor ID passed on survey links (vid=...). Unique within a project.                       |
| `integration`         | enum `VendorIntegration` | yes        | default `DIRECT`         |                                                                                            |
| `redirectMode`        | enum `RedirectMode`      | yes        | default `STATIC`         |                                                                                            |
| `staticUrls`          | `Json`                   | yes        | default `"{}"`           | Static redirect URL per outcome status, e.g. {"complete": "https://...?uid=[UID]"}.        |
| `statusWords`         | `Json`                   | yes        | default `"{}"`           | Words sent for [STATUS] per outcome, e.g. {"quota_full": "overquota"}.                     |
| `dynamicAllowedHosts` | `String[]`               | yes (list) | default `[]`             | Hosts allowed for dynamic return URLs supplied at entry (protects against open redirects). |
| `dynamicParam`        | `String`                 | yes        | default `"rurl"`         | Query parameter that carries the dynamic return URL on entry.                              |
| `secret`              | `String`                 | yes        |                          | Shared secret for signed entry links and signed redirects.                                 |
| `requireSignedEntry`  | `Boolean`                | yes        | default `false`          |                                                                                            |
| `signRedirects`       | `Boolean`                | yes        | default `false`          |                                                                                            |
| `countryRedirects`    | `Json`                   | yes        | default `"{}"`           | Per-country overrides: {"DE": {"urls": {...}, "words": {...}}}. Highest precedence.        |
| `callbackUrl`         | `String?`                | no         |                          | Callback (postback) URL template, sent as a signed GET when an outcome is recorded.        |
| `callbackStatuses`    | `String[]`               | yes (list) | default `[]`             | Outcome statuses that trigger a callback.                                                  |
| `callbackMaxAttempts` | `Int`                    | yes        | default `6`              | Delivery attempts per callback before it is dead-lettered (1-10).                          |
| `partnerBaseUrl`      | `String?`                | no         |                          | PROJEXA integration: base URL, e.g. https://projexa.example.                               |
| `partnerSecretEnc`    | `String?`                | no         |                          | PROJEXA client secret for the S2S outcome signature, encrypted at rest (SecretBox).        |
| `partnerS2s`          | `Boolean`                | yes        | default `true`           | Send PROJEXA's S2S outcome confirmation.                                                   |
| `createdAt`           | `DateTime`               | yes        | default `now()`          |                                                                                            |
| `updatedAt`           | `DateTime`               | yes        | auto-updated             |                                                                                            |
| `deletedAt`           | `DateTime?`              | no         |                          | Soft delete. The code stays reserved so old links can never reach a different vendor.      |

Relations: `projectId` → `Project.id`; has many `Response` (`responses`); has many `RedirectEvent` (`redirectEvents`); has many `OutboundCallback` (`callbacks`).

Indexes and constraints: `@@unique([projectId, code])`; `@@index([tenantId, deletedAt])`.

#### Response

| Field              | Type                  | Required   | Key / default            | Meaning                                                                                                                                                                                       |
| ------------------ | --------------------- | ---------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | `String`              | yes        | **PK**, default `cuid()` |                                                                                                                                                                                               |
| `tenantId`         | `String`              | yes        |                          |                                                                                                                                                                                               |
| `surveyId`         | `String`              | yes        |                          |                                                                                                                                                                                               |
| `versionId`        | `String`              | yes        |                          | The exact version this respondent answered.                                                                                                                                                   |
| `vendorId`         | `String?`             | no         |                          |                                                                                                                                                                                               |
| `uid`              | `String`              | yes        |                          |                                                                                                                                                                                               |
| `country`          | `String?`             | no         |                          |                                                                                                                                                                                               |
| `isTest`           | `Boolean`             | yes        | default `false`          |                                                                                                                                                                                               |
| `status`           | enum `ResponseStatus` | yes        | default `IN_PROGRESS`    |                                                                                                                                                                                               |
| `outcomeReason`    | `String?`             | no         |                          | Termination rule or quota that ended the interview, if any.                                                                                                                                   |
| `answers`          | `Json`                | yes        | default `"{}"`           |                                                                                                                                                                                               |
| `orderSeed`        | `String?`             | no         |                          | Seed of this respondent's page order when it differs from the response id (least-fill blocks).                                                                                                |
| `currentPage`      | `Int`                 | yes        | default `0`              | Index of the page currently shown; -1 once finished.                                                                                                                                          |
| `entryParams`      | `Json`                | yes        | default `"{}"`           | Extra entry parameters, available to redirects as [param:name].                                                                                                                               |
| `returnUrl`        | `String?`             | no         |                          | Validated dynamic return URL supplied at entry.                                                                                                                                               |
| `sessionTokenHash` | `String`              | yes        | unique                   | SHA-256 of the respondent's session token; the token itself is never stored.                                                                                                                  |
| `userAgent`        | `String?`             | no         |                          |                                                                                                                                                                                               |
| `language`         | `String?`             | no         |                          | Language the respondent answered in (BCP 47 tag).                                                                                                                                             |
| `device`           | `String?`             | no         |                          | desktop, tablet or mobile, classified at entry.                                                                                                                                               |
| `startedAt`        | `DateTime`            | yes        | default `now()`          |                                                                                                                                                                                               |
| `updatedAt`        | `DateTime`            | yes        | auto-updated             |                                                                                                                                                                                               |
| `completedAt`      | `DateTime?`           | no         |                          |                                                                                                                                                                                               |
| `mode`             | enum `InterviewMode`  | yes        | default `CAWI`           |                                                                                                                                                                                               |
| `interviewerId`    | `String?`             | no         |                          | CAPI: the interviewer who conducted the interview.                                                                                                                                            |
| `clientId`         | `String?`             | no         | unique                   | CAPI: id generated on the device, so a retried upload is never stored twice.                                                                                                                  |
| `deviceId`         | `String?`             | no         |                          | CAPI: device the interview was recorded on (generated by the app, not a hardware id).                                                                                                         |
| `syncedAt`         | `DateTime?`           | no         |                          |                                                                                                                                                                                               |
| `pageShownAt`      | `DateTime?`           | no         |                          | When the current page was shown (CAWI), for length-of-interview timing.                                                                                                                       |
| `durationMs`       | `Int?`                | no         |                          | Time spent on answered pages, in milliseconds (length of interview).                                                                                                                          |
| `lastPageId`       | `String?`             | no         |                          | Last page the respondent reached (drop-off reporting).                                                                                                                                        |
| `ipHash`           | `String?`             | no         |                          | Keyed HMAC of the network address, only for same-network checks; the address is never stored.                                                                                                 |
| `qualityScore`     | `Int?`                | no         |                          | 0-100, set when a complete is scored. Null when quality scoring is off or not applicable.                                                                                                     |
| `qualityFlags`     | `Json`                | yes        | default `"[]"`           | [{code, ref?, penalty, detail}] from @zapx/quality-core.                                                                                                                                      |
| `reviewState`      | enum `ReviewState`    | yes        | default `NONE`           |                                                                                                                                                                                               |
| `reviewedAt`       | `DateTime?`           | no         |                          |                                                                                                                                                                                               |
| `reviewedById`     | `String?`             | no         |                          |                                                                                                                                                                                               |
| `reviewNote`       | `String?`             | no         |                          |                                                                                                                                                                                               |
| `deviceHash`       | `String?`             | no         |                          | Keyed HMAC of browser traits (screen, time zone, languages, platform, user agent). The traits are not stored.                                                                                 |
| `signals`          | `Json`                | yes        | default `"{}"`           | Browser signals while answering: {automation?, honeypot?, quietPages?, pasted?: [questionId]}.                                                                                                |
| `geoCountry`       | `String?`             | no         |                          | Two-letter country reported by the edge network (GEO_COUNTRY_HEADER), when configured.                                                                                                        |
| `networkFlags`     | `String[]`            | yes (list) | default `[]`             | Milestone 16: what a network reputation service said about the respondent's address (vpn, proxy, tor, relay, hosting). Only these words are kept: not the address, not the provider's answer. |
| `location`         | `Json?`               | no         |                          | CAPI: {start?, end?: {lat, lon, accuracy, at}} and {audioConsent?}. Rounded to about a metre.                                                                                                 |
| `evidence`         | `Json?`               | no         |                          | Blueprint phase 3, CAPI: {pageTimes: [{pageId, shownAt, ms}], interruptions: {count, totalMs, log}, geofence}.                                                                                |
| `quotaCells`       | `String[]`            | yes (list) | default `[]`             | Blueprint phase 4: the quotas this complete was counted toward (least-fill groups pick one), released on reject.                                                                              |
| `erasedAt`         | `DateTime?`           | no         |                          | Blueprint phase 5: when the retention policy erased this interview's answers and identifiers. The row stays (status, timings, counts), but analyses and exports leave it out.                 |

Relations: `surveyId` → `Survey.id`; `versionId` → `SurveyVersion.id`; `vendorId` → `Vendor.id`; `interviewerId` → `User.id`; has many `Capture` (`captures`).

Indexes and constraints: `@@unique([surveyId, vendorId, uid])`; `@@index([surveyId, reviewState])`; `@@index([surveyId, ipHash])`; `@@index([surveyId, deviceHash])`; `@@index([interviewerId, startedAt])`; `@@index([tenantId, surveyId, status])`; `@@index([vendorId, completedAt])`; `@@index([tenantId, status, completedAt])`; `@@index([status, updatedAt])`.

#### QuotaCount

| Field            | Type     | Required | Key / default            | Meaning                                                                                     |
| ---------------- | -------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `id`             | `String` | yes      | **PK**, default `cuid()` |                                                                                             |
| `surveyId`       | `String` | yes      |                          |                                                                                             |
| `quotaId`        | `String` | yes      |                          |                                                                                             |
| `count`          | `Int`    | yes      | default `0`              |                                                                                             |
| `targetOverride` | `Int?`   | no       |                          | Target changed while the survey is live (no republish). Null: the published target applies. |

Relations: `surveyId` → `Survey.id`.

Indexes and constraints: `@@unique([surveyId, quotaId])`.

#### AuditEvent

| Field        | Type       | Required | Key / default            | Meaning |
| ------------ | ---------- | -------- | ------------------------ | ------- |
| `id`         | `String`   | yes      | **PK**, default `cuid()` |         |
| `tenantId`   | `String`   | yes      |                          |         |
| `actorId`    | `String?`  | no       |                          |         |
| `action`     | `String`   | yes      |                          |         |
| `entityType` | `String`   | yes      |                          |         |
| `entityId`   | `String`   | yes      |                          |         |
| `data`       | `Json`     | yes      | default `"{}"`           |         |
| `createdAt`  | `DateTime` | yes      | default `now()`          |         |

Indexes and constraints: `@@index([tenantId, entityType, entityId])`; `@@index([tenantId, createdAt])`.

#### QaRun

A QA Laboratory run: synthetic respondents simulated against one survey version.

| Field         | Type       | Required | Key / default            | Meaning                                                                       |
| ------------- | ---------- | -------- | ------------------------ | ----------------------------------------------------------------------------- |
| `id`          | `String`   | yes      | **PK**, default `cuid()` |                                                                               |
| `tenantId`    | `String`   | yes      |                          |                                                                               |
| `surveyId`    | `String`   | yes      |                          |                                                                               |
| `versionId`   | `String`   | yes      |                          |                                                                               |
| `version`     | `Int`      | yes      |                          |                                                                               |
| `respondents` | `Int`      | yes      |                          |                                                                               |
| `seed`        | `String`   | yes      |                          |                                                                               |
| `passed`      | `Boolean`  | yes      |                          |                                                                               |
| `coverage`    | `Float`    | yes      |                          | Coverage percent (0-100) of pages, questions, options, branches and outcomes. |
| `report`      | `Json`     | yes      |                          | Full QaReport from @zapx/logic-engine simulateSurvey.                         |
| `createdById` | `String?`  | no       |                          |                                                                               |
| `createdAt`   | `DateTime` | yes      | default `now()`          |                                                                               |

Relations: `surveyId` → `Survey.id`.

Indexes and constraints: `@@index([tenantId, surveyId, createdAt])`.

#### ChangeSet

A proposed edit to a survey draft (from AI, a file import or a manual paste). Nothing reaches the draft until a programmer reviews and applies it.

| Field                | Type                | Required | Key / default            | Meaning                                                                                     |
| -------------------- | ------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `id`                 | `String`            | yes      | **PK**, default `cuid()` |                                                                                             |
| `tenantId`           | `String`            | yes      |                          |                                                                                             |
| `surveyId`           | `String`            | yes      |                          |                                                                                             |
| `baseVersionId`      | `String`            | yes      |                          | Draft version the proposal was made against, and its updatedAt at that moment.              |
| `baseUpdatedAt`      | `DateTime`          | yes      |                          |                                                                                             |
| `source`             | enum `ChangeSource` | yes      |                          |                                                                                             |
| `title`              | `String`            | yes      |                          |                                                                                             |
| `prompt`             | `String?`           | no       |                          | The instruction or brief given (for AI), or the import file name.                           |
| `sourceFileName`     | `String?`           | no       |                          |                                                                                             |
| `proposedDefinition` | `Json`              | yes      |                          | Full proposed survey definition (validated by @zapx/survey-schema).                         |
| `diff`               | `Json`              | yes      |                          | Structured diff against the base draft.                                                     |
| `assumptions`        | `Json`              | yes      | default `"[]"`           | Assumptions and questions the author (AI or importer) wants a human to confirm.             |
| `confidence`         | `Json?`             | no       |                          | Import confidence and per-item issues, if any.                                              |
| `check`              | `Json`              | yes      |                          | Schema and logic check of the proposed definition.                                          |
| `status`             | enum `ChangeStatus` | yes      | default `PROPOSED`       |                                                                                             |
| `producer`           | `String`            | yes      |                          | Model or importer that produced the proposal, e.g. "claude-opus-5-5" or "xlsx-template-v1". |
| `createdById`        | `String?`           | no       |                          |                                                                                             |
| `decidedById`        | `String?`           | no       |                          |                                                                                             |
| `decidedAt`          | `DateTime?`         | no       |                          |                                                                                             |
| `createdAt`          | `DateTime`          | yes      | default `now()`          |                                                                                             |

Relations: `surveyId` → `Survey.id`.

Indexes and constraints: `@@index([tenantId, surveyId, createdAt])`.

#### RedirectEvent

Redirect audit log: every outcome redirect ZAPX resolved, with the level that supplied it.

| Field        | Type       | Required | Key / default            | Meaning                                                                         |
| ------------ | ---------- | -------- | ------------------------ | ------------------------------------------------------------------------------- |
| `id`         | `String`   | yes      | **PK**, default `cuid()` |                                                                                 |
| `tenantId`   | `String`   | yes      |                          |                                                                                 |
| `surveyId`   | `String`   | yes      |                          |                                                                                 |
| `responseId` | `String?`  | no       |                          | Null when the respondent was rejected before a response was recorded.           |
| `vendorId`   | `String?`  | no       |                          |                                                                                 |
| `uid`        | `String`   | yes      |                          |                                                                                 |
| `status`     | `String`   | yes      |                          |                                                                                 |
| `statusWord` | `String`   | yes      |                          |                                                                                 |
| `source`     | `String`   | yes      |                          | static, dynamic, partner or none.                                               |
| `level`      | `String?`  | no       |                          | vendor_country, vendor, project_country, project or organization (static only). |
| `url`        | `String?`  | no       |                          |                                                                                 |
| `reason`     | `String?`  | no       |                          | Why the outcome happened (termination id, quota id, rejection reason).          |
| `isTest`     | `Boolean`  | yes      | default `false`          |                                                                                 |
| `createdAt`  | `DateTime` | yes      | default `now()`          |                                                                                 |

Relations: `vendorId` → `Vendor.id`.

Indexes and constraints: `@@unique([responseId, status])`; `@@index([tenantId, vendorId, createdAt])`; `@@index([tenantId, surveyId, createdAt])`.

#### OutboundCallback

Outbox of server-to-server callbacks. Written when an outcome is recorded and delivered by the callback worker with retries; the idempotency key makes every outcome send at most one.

| Field            | Type                     | Required | Key / default            | Meaning                                                                       |
| ---------------- | ------------------------ | -------- | ------------------------ | ----------------------------------------------------------------------------- |
| `id`             | `String`                 | yes      | **PK**, default `cuid()` |                                                                               |
| `tenantId`       | `String`                 | yes      |                          |                                                                               |
| `vendorId`       | `String`                 | yes      |                          |                                                                               |
| `responseId`     | `String`                 | yes      |                          |                                                                               |
| `status`         | `String`                 | yes      |                          |                                                                               |
| `idempotencyKey` | `String`                 | yes      | unique                   | "<responseId>:<status>" – unique, sent as X-Idempotency-Key on every attempt. |
| `integration`    | enum `VendorIntegration` | yes      |                          |                                                                               |
| `method`         | `String`                 | yes      |                          |                                                                               |
| `url`            | `String`                 | yes      |                          |                                                                               |
| `payload`        | `Json?`                  | no       |                          |                                                                               |
| `state`          | enum `CallbackState`     | yes      | default `PENDING`        |                                                                               |
| `attempts`       | `Int`                    | yes      | default `0`              |                                                                               |
| `maxAttempts`    | `Int`                    | yes      | default `6`              |                                                                               |
| `nextAttemptAt`  | `DateTime`               | yes      | default `now()`          |                                                                               |
| `lastHttpStatus` | `Int?`                   | no       |                          |                                                                               |
| `lastError`      | `String?`                | no       |                          |                                                                               |
| `log`            | `Json`                   | yes      | default `"[]"`           | Last attempts: [{at, httpStatus, error, ms}] (most recent 10).                |
| `deliveredAt`    | `DateTime?`              | no       |                          |                                                                               |
| `createdAt`      | `DateTime`               | yes      | default `now()`          |                                                                               |
| `updatedAt`      | `DateTime`               | yes      | auto-updated             |                                                                               |

Relations: `vendorId` → `Vendor.id`.

Indexes and constraints: `@@index([state, nextAttemptAt])`; `@@index([tenantId, vendorId, createdAt])`.

#### TenantAiPolicy

Tenant-specific AI permissions and limits (absent row = server defaults).

| Field                   | Type       | Required   | Key / default                        | Meaning                                                                                   |
| ----------------------- | ---------- | ---------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `tenantId`              | `String`   | yes        | **PK**                               |                                                                                           |
| `enabled`               | `Boolean`  | yes        | default `true`                       |                                                                                           |
| `allowedTasks`          | `String[]` | yes (list) | default `["architect", "translate"]` | AI tasks this tenant may use, e.g. ["architect","translate"].                             |
| `requestsPerMinute`     | `Int`      | yes        | default `10`                         |                                                                                           |
| `requestsPerDay`        | `Int`      | yes        | default `500`                        |                                                                                           |
| `monthlyBudgetMicroUsd` | `BigInt`   | yes        | default `0`                          | Monthly spend cap in micro-USD (0 = no cap).                                              |
| `redactPii`             | `Boolean`  | yes        | default `true`                       | Redact e-mail addresses, phone and card numbers from briefs and documents before sending. |
| `updatedById`           | `String?`  | no         |                                      |                                                                                           |
| `updatedAt`             | `DateTime` | yes        | auto-updated                         |                                                                                           |

Relations: `tenantId` → `Tenant.id`.

#### AiUsage

One AI call: who, what task, which provider and model, tokens, cost and outcome.

| Field              | Type       | Required | Key / default            | Meaning                                                                         |
| ------------------ | ---------- | -------- | ------------------------ | ------------------------------------------------------------------------------- |
| `id`               | `String`   | yes      | **PK**, default `cuid()` |                                                                                 |
| `tenantId`         | `String`   | yes      |                          |                                                                                 |
| `userId`           | `String?`  | no       |                          |                                                                                 |
| `task`             | `String`   | yes      |                          |                                                                                 |
| `provider`         | `String`   | yes      |                          |                                                                                 |
| `model`            | `String`   | yes      |                          |                                                                                 |
| `outcome`          | `String`   | yes      |                          | ok, error, refused, rate_limited, budget_exceeded, circuit_open, not_permitted. |
| `errorCode`        | `String?`  | no       |                          |                                                                                 |
| `inputTokens`      | `Int`      | yes      | default `0`              |                                                                                 |
| `outputTokens`     | `Int`      | yes      | default `0`              |                                                                                 |
| `cacheReadTokens`  | `Int`      | yes      | default `0`              |                                                                                 |
| `cacheWriteTokens` | `Int`      | yes      | default `0`              |                                                                                 |
| `costMicroUsd`     | `BigInt`   | yes      | default `0`              |                                                                                 |
| `latencyMs`        | `Int`      | yes      | default `0`              |                                                                                 |
| `surveyId`         | `String?`  | no       |                          | Survey the call was about, if any.                                              |
| `redactions`       | `Int`      | yes      | default `0`              | Number of values redacted from the input.                                       |
| `createdAt`        | `DateTime` | yes      | default `now()`          |                                                                                 |

Indexes and constraints: `@@index([tenantId, createdAt])`; `@@index([tenantId, task, createdAt])`.

#### OpenEndFingerprint

Fingerprint of a long open answer (normalized text, SHA-256), to spot the same text from different respondents.

| Field        | Type       | Required | Key / default            | Meaning |
| ------------ | ---------- | -------- | ------------------------ | ------- |
| `id`         | `String`   | yes      | **PK**, default `cuid()` |         |
| `surveyId`   | `String`   | yes      |                          |         |
| `questionId` | `String`   | yes      |                          |         |
| `hash`       | `String`   | yes      |                          |         |
| `responseId` | `String`   | yes      |                          |         |
| `createdAt`  | `DateTime` | yes      | default `now()`          |         |

Indexes and constraints: `@@unique([responseId, questionId])`; `@@index([surveyId, questionId, hash])`.

#### CapiAssignment

A survey an interviewer may conduct in the CAPI app.

| Field           | Type       | Required | Key / default            | Meaning                                                                                       |
| --------------- | ---------- | -------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `id`            | `String`   | yes      | **PK**, default `cuid()` |                                                                                               |
| `tenantId`      | `String`   | yes      |                          |                                                                                               |
| `surveyId`      | `String`   | yes      |                          |                                                                                               |
| `interviewerId` | `String`   | yes      |                          |                                                                                               |
| `target`        | `Int?`     | no       |                          | Optional number of completes expected from this interviewer (shown in the app; not enforced). |
| `active`        | `Boolean`  | yes      | default `true`           |                                                                                               |
| `createdAt`     | `DateTime` | yes      | default `now()`          |                                                                                               |

Relations: `surveyId` → `Survey.id`; `interviewerId` → `User.id`.

Indexes and constraints: `@@unique([surveyId, interviewerId])`; `@@index([tenantId, interviewerId])`.

#### CatiCase

One person to call for a CATI survey (Milestone 9). The phone number is sealed with SecretBox.

| Field             | Type                  | Required | Key / default            | Meaning                                                                                        |
| ----------------- | --------------------- | -------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `id`              | `String`              | yes      | **PK**, default `cuid()` |                                                                                                |
| `tenantId`        | `String`              | yes      |                          |                                                                                                |
| `surveyId`        | `String`              | yes      |                          |                                                                                                |
| `code`            | `String`              | yes      |                          | Respondent id from the sample; becomes the interview's UID.                                    |
| `phoneSealed`     | `String`              | yes      |                          |                                                                                                |
| `phoneHint`       | `String`              | yes      |                          | Last digits, for display without unsealing.                                                    |
| `name`            | `String?`             | no       |                          |                                                                                                |
| `data`            | `Json`                | yes      | default `"{}"`           | Extra sample columns, available to the survey as entry parameters.                             |
| `status`          | enum `CatiCaseStatus` | yes      | default `PENDING`        |                                                                                                |
| `attempts`        | `Int`                 | yes      | default `0`              |                                                                                                |
| `maxAttempts`     | `Int`                 | yes      | default `6`              |                                                                                                |
| `nextCallAt`      | `DateTime`            | yes      | default `now()`          |                                                                                                |
| `lockedById`      | `String?`             | no       |                          | Who has the case open, until when (a lease, so an abandoned screen frees the case).            |
| `lockedUntil`     | `DateTime?`           | no       |                          |                                                                                                |
| `lastDisposition` | `String?`             | no       |                          |                                                                                                |
| `closedReason`    | `String?`             | no       |                          |                                                                                                |
| `responseId`      | `String?`             | no       | unique                   |                                                                                                |
| `createdAt`       | `DateTime`            | yes      | default `now()`          |                                                                                                |
| `updatedAt`       | `DateTime`            | yes      | auto-updated             |                                                                                                |
| `timeZone`        | `String?`             | no       |                          | Milestone 18: the respondent's time zone (IANA, from the sample), else the survey's.           |
| `phoneHash`       | `String?`             | no       |                          | Keyed hash of the number, matched against the do-not-call list. Null on cases from before M18. |

Relations: `surveyId` → `Survey.id`; has many `CatiCall` (`calls`).

Indexes and constraints: `@@unique([surveyId, code])`; `@@index([surveyId, status, nextCallAt])`; `@@index([tenantId, surveyId])`; `@@index([tenantId, phoneHash])`.

#### CatiSettings

Milestone 18: when a survey's cases may be called, in the respondent's local time.

| Field       | Type       | Required   | Key / default                | Meaning                                                                            |
| ----------- | ---------- | ---------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `surveyId`  | `String`   | yes        | **PK**                       |                                                                                    |
| `tenantId`  | `String`   | yes        |                              |                                                                                    |
| `timeZone`  | `String`   | yes        | default `"UTC"`              | Used for cases without their own time zone.                                        |
| `callFrom`  | `Int`      | yes        | default `540`                | Minutes after local midnight: calls from callFrom up to (not including) callUntil. |
| `callUntil` | `Int`      | yes        | default `1260`               |                                                                                    |
| `days`      | `Int[]`    | yes (list) | default `[1, 2, 3, 4, 5, 6]` | ISO weekdays allowed: 1 = Monday ... 7 = Sunday.                                   |
| `updatedAt` | `DateTime` | yes        | auto-updated                 |                                                                                    |

#### DoNotCall

Milestone 18: numbers the organization must not call, as keyed hashes (never the number).

| Field         | Type       | Required | Key / default            | Meaning                                                        |
| ------------- | ---------- | -------- | ------------------------ | -------------------------------------------------------------- |
| `id`          | `String`   | yes      | **PK**, default `cuid()` |                                                                |
| `tenantId`    | `String`   | yes      |                          |                                                                |
| `phoneHash`   | `String`   | yes      |                          |                                                                |
| `hint`        | `String`   | yes      |                          | Last three digits, so an administrator can tell entries apart. |
| `source`      | `String`   | yes      |                          | respondent (asked on a call) / upload / manual                 |
| `note`        | `String?`  | no       |                          |                                                                |
| `createdById` | `String?`  | no       |                          |                                                                |
| `createdAt`   | `DateTime` | yes      | default `now()`          |                                                                |

Indexes and constraints: `@@unique([tenantId, phoneHash])`.

#### CatiDialer

Milestone 19: a survey's phone dialer settings. No row: interviewers dial by hand.

| Field             | Type       | Required | Key / default   | Meaning                                                                      |
| ----------------- | ---------- | -------- | --------------- | ---------------------------------------------------------------------------- |
| `surveyId`        | `String`   | yes      | **PK**          |                                                                              |
| `tenantId`        | `String`   | yes      |                 |                                                                              |
| `enabled`         | `Boolean`  | yes      | default `false` |                                                                              |
| `recordCalls`     | `Boolean`  | yes      | default `false` | Record calls (both sides) and keep the recording with the interview.         |
| `recordingNotice` | `String?`  | no       |                 | Read to the respondent before the call is connected when calls are recorded. |
| `updatedAt`       | `DateTime` | yes      | auto-updated    |                                                                              |

#### CatiDial

Milestone 19: one call placed by the dialer. The interviewer's phone rings first; the respondent is dialled when the interviewer answers. The id is random and appears in the provider's webhooks.

| Field              | Type        | Required | Key / default      | Meaning                                                                                                  |
| ------------------ | ----------- | -------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `id`               | `String`    | yes      | **PK**             |                                                                                                          |
| `tenantId`         | `String`    | yes      |                    |                                                                                                          |
| `surveyId`         | `String`    | yes      |                    |                                                                                                          |
| `caseId`           | `String`    | yes      |                    |                                                                                                          |
| `interviewerId`    | `String`    | yes      |                    |                                                                                                          |
| `provider`         | `String`    | yes      |                    |                                                                                                          |
| `providerCallId`   | `String?`   | no       | unique             | The provider's id of the interviewer's call (Twilio CallSid).                                            |
| `status`           | `String`    | yes      | default `"queued"` | The interviewer's leg: queued / ringing / in-progress / completed / busy / no-answer / failed / canceled |
| `respondentStatus` | `String?`   | no       |                    | The respondent's leg, once dialled: answered / completed / busy / no-answer / failed / canceled          |
| `talkSeconds`      | `Int?`      | no       |                    | Seconds the respondent was connected.                                                                    |
| `record`           | `Boolean`   | yes      | default `false`    |                                                                                                          |
| `recordingStatus`  | `String`    | yes      | default `"none"`   | none / pending / stored / discarded / failed                                                             |
| `recordingSid`     | `String?`   | no       |                    |                                                                                                          |
| `recordingTries`   | `Int`       | yes      | default `0`        |                                                                                                          |
| `captureId`        | `String?`   | no       |                    |                                                                                                          |
| `error`            | `String?`   | no       |                    |                                                                                                          |
| `createdAt`        | `DateTime`  | yes      | default `now()`    |                                                                                                          |
| `endedAt`          | `DateTime?` | no       |                    |                                                                                                          |

Indexes and constraints: `@@index([caseId, createdAt])`; `@@index([recordingStatus])`.

#### CatiCall

One call attempt on a case, with its disposition (the schema comment for this sits above `CatiDialer` by mistake).

| Field           | Type        | Required | Key / default            | Meaning |
| --------------- | ----------- | -------- | ------------------------ | ------- |
| `id`            | `String`    | yes      | **PK**, default `cuid()` |         |
| `tenantId`      | `String`    | yes      |                          |         |
| `caseId`        | `String`    | yes      |                          |         |
| `interviewerId` | `String`    | yes      |                          |         |
| `disposition`   | `String`    | yes      |                          |         |
| `note`          | `String?`   | no       |                          |         |
| `callbackAt`    | `DateTime?` | no       |                          |         |
| `startedAt`     | `DateTime`  | yes      |                          |         |
| `endedAt`       | `DateTime`  | yes      | default `now()`          |         |

Relations: `caseId` → `CatiCase.id` (on delete Cascade).

Indexes and constraints: `@@index([caseId])`; `@@index([tenantId, interviewerId, endedAt])`.

#### ApiKey

Organization API key (Milestone 6). Acts as the member who created it, with at most the key's role. Only a SHA-256 hash of the secret is stored; the full key is shown once.

| Field         | Type        | Required | Key / default            | Meaning                                                                               |
| ------------- | ----------- | -------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `id`          | `String`    | yes      | **PK**, default `cuid()` |                                                                                       |
| `tenantId`    | `String`    | yes      |                          |                                                                                       |
| `createdById` | `String`    | yes      |                          |                                                                                       |
| `name`        | `String`    | yes      |                          |                                                                                       |
| `prefix`      | `String`    | yes      | unique                   | Public part of the key ("zapx*<prefix>*<secret>"), used to look it up.                |
| `secretHash`  | `String`    | yes      |                          |                                                                                       |
| `role`        | enum `Role` | yes      |                          | PROGRAMMER or VIEWER. The effective role is the lower of this and the creator's role. |
| `expiresAt`   | `DateTime?` | no       |                          |                                                                                       |
| `lastUsedAt`  | `DateTime?` | no       |                          |                                                                                       |
| `revokedAt`   | `DateTime?` | no       |                          |                                                                                       |
| `createdAt`   | `DateTime`  | yes      | default `now()`          |                                                                                       |

Relations: `createdById` → `User.id`.

Indexes and constraints: `@@index([tenantId, createdAt])`.

#### Webhook

Outbound webhook subscription (Milestone 6). Payloads are signed and never carry answers.

| Field         | Type       | Required   | Key / default            | Meaning                                                             |
| ------------- | ---------- | ---------- | ------------------------ | ------------------------------------------------------------------- |
| `id`          | `String`   | yes        | **PK**, default `cuid()` |                                                                     |
| `tenantId`    | `String`   | yes        |                          |                                                                     |
| `url`         | `String`   | yes        |                          |                                                                     |
| `description` | `String?`  | no         |                          |                                                                     |
| `events`      | `String[]` | yes (list) |                          | Event types, e.g. ["response.finished", "survey.published"].        |
| `secretEnc`   | `String`   | yes        |                          | Signing secret sealed with SecretBox (it must be readable to sign). |
| `active`      | `Boolean`  | yes        | default `true`           |                                                                     |
| `createdById` | `String?`  | no         |                          |                                                                     |
| `createdAt`   | `DateTime` | yes        | default `now()`          |                                                                     |
| `updatedAt`   | `DateTime` | yes        | auto-updated             |                                                                     |

Relations: has many `WebhookDelivery` (`deliveries`).

Indexes and constraints: `@@index([tenantId])`.

#### WebhookDelivery

Outbox row for one webhook event: delivered by the background worker with retries.

| Field            | Type                 | Required | Key / default            | Meaning                                      |
| ---------------- | -------------------- | -------- | ------------------------ | -------------------------------------------- |
| `id`             | `String`             | yes      | **PK**, default `cuid()` |                                              |
| `tenantId`       | `String`             | yes      |                          |                                              |
| `webhookId`      | `String`             | yes      |                          |                                              |
| `event`          | `String`             | yes      |                          |                                              |
| `payload`        | `Json`               | yes      |                          | The exact JSON body that is signed and sent. |
| `state`          | enum `CallbackState` | yes      | default `PENDING`        |                                              |
| `attempts`       | `Int`                | yes      | default `0`              |                                              |
| `maxAttempts`    | `Int`                | yes      | default `6`              |                                              |
| `nextAttemptAt`  | `DateTime`           | yes      | default `now()`          |                                              |
| `lastHttpStatus` | `Int?`               | no       |                          |                                              |
| `lastError`      | `String?`            | no       |                          |                                              |
| `deliveredAt`    | `DateTime?`          | no       |                          |                                              |
| `createdAt`      | `DateTime`           | yes      | default `now()`          |                                              |
| `updatedAt`      | `DateTime`           | yes      | auto-updated             |                                              |

Relations: `webhookId` → `Webhook.id` (on delete Cascade).

Indexes and constraints: `@@index([state, nextAttemptAt])`; `@@index([webhookId, createdAt])`.

#### Job

Background job (Milestone 7): exports, QA runs, AI drafts. Run by the job worker, which claims rows with FOR UPDATE SKIP LOCKED and a lease, so several workers can run safely.

| Field             | Type             | Required | Key / default            | Meaning                                                                                     |
| ----------------- | ---------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `id`              | `String`         | yes      | **PK**, default `cuid()` |                                                                                             |
| `tenantId`        | `String`         | yes      |                          |                                                                                             |
| `type`            | `String`         | yes      |                          | export / qa_run / ai_propose                                                                |
| `surveyId`        | `String?`        | no       |                          |                                                                                             |
| `status`          | enum `JobStatus` | yes      | default `QUEUED`         |                                                                                             |
| `input`           | `Json`           | yes      |                          |                                                                                             |
| `result`          | `Json?`          | no       |                          |                                                                                             |
| `error`           | `String?`        | no       |                          |                                                                                             |
| `progress`        | `Int`            | yes      | default `0`              | 0-100, and a short description of the current step.                                         |
| `progressNote`    | `String?`        | no       |                          |                                                                                             |
| `attempts`        | `Int`            | yes      | default `0`              |                                                                                             |
| `maxAttempts`     | `Int`            | yes      | default `2`              |                                                                                             |
| `runAfter`        | `DateTime`       | yes      | default `now()`          |                                                                                             |
| `lockedUntil`     | `DateTime?`      | no       |                          | Lease: a running job whose lease expired (worker crashed) is picked up again.               |
| `cancelRequested` | `Boolean`        | yes      | default `false`          |                                                                                             |
| `createdById`     | `String`         | yes      |                          | The member the job runs as; their current role and project access are checked when it runs. |
| `startedAt`       | `DateTime?`      | no       |                          |                                                                                             |
| `finishedAt`      | `DateTime?`      | no       |                          |                                                                                             |
| `createdAt`       | `DateTime`       | yes      | default `now()`          |                                                                                             |
| `updatedAt`       | `DateTime`       | yes      | auto-updated             |                                                                                             |

Relations: has many `StoredFile` (`files`).

Indexes and constraints: `@@index([status, runAfter])`; `@@index([tenantId, surveyId, createdAt])`; `@@index([finishedAt])`.

#### StoredFile

A file kept in the file store (Milestone 7): export results and uploaded documents for AI jobs. The bytes live in the FileStore (local disk or object storage), never in the database.

| Field         | Type        | Required | Key / default            | Meaning         |
| ------------- | ----------- | -------- | ------------------------ | --------------- |
| `id`          | `String`    | yes      | **PK**, default `cuid()` |                 |
| `tenantId`    | `String`    | yes      |                          |                 |
| `surveyId`    | `String?`   | no       |                          |                 |
| `jobId`       | `String?`   | no       |                          |                 |
| `purpose`     | `String`    | yes      |                          | export / upload |
| `name`        | `String`    | yes      |                          |                 |
| `contentType` | `String`    | yes      |                          |                 |
| `size`        | `Int`       | yes      |                          |                 |
| `sha256`      | `String`    | yes      |                          |                 |
| `storageKey`  | `String`    | yes      | unique                   |                 |
| `expiresAt`   | `DateTime`  | yes      |                          |                 |
| `createdById` | `String?`   | no       |                          |                 |
| `createdAt`   | `DateTime`  | yes      | default `now()`          |                 |
| `deletedAt`   | `DateTime?` | no       |                          |                 |

Relations: `jobId` → `Job.id` (on delete SetNull).

Indexes and constraints: `@@index([expiresAt, deletedAt])`; `@@index([tenantId, createdAt])`.

#### Report

A saved analysis (Milestone 10): filters plus frequencies or a crosstab definition.

| Field         | Type       | Required | Key / default            | Meaning                                                                               |
| ------------- | ---------- | -------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `id`          | `String`   | yes      | **PK**, default `cuid()` |                                                                                       |
| `tenantId`    | `String`   | yes      |                          |                                                                                       |
| `surveyId`    | `String`   | yes      |                          |                                                                                       |
| `name`        | `String`   | yes      |                          |                                                                                       |
| `config`      | `Json`     | yes      |                          | {type: "crosstab" / "frequencies", filters, banner?, stubs?, variables?, confidence?} |
| `createdById` | `String`   | yes      |                          |                                                                                       |
| `createdAt`   | `DateTime` | yes      | default `now()`          |                                                                                       |
| `updatedAt`   | `DateTime` | yes      | auto-updated             |                                                                                       |

Relations: `surveyId` → `Survey.id`.

Indexes and constraints: `@@index([tenantId, surveyId])`.

#### MediaAsset

An image, video or audio file shown in a survey (Milestone 11). Referenced from definitions by id, served publicly to respondents. Kept while any version uses it; never expires.

| Field         | Type        | Required | Key / default   | Meaning                                                                                 |
| ------------- | ----------- | -------- | --------------- | --------------------------------------------------------------------------------------- |
| `id`          | `String`    | yes      | **PK**          | 22-character random id (not a cuid): it is the public URL, so it must not be guessable. |
| `tenantId`    | `String`    | yes      |                 |                                                                                         |
| `surveyId`    | `String`    | yes      |                 |                                                                                         |
| `kind`        | `String`    | yes      |                 | image / video / audio                                                                   |
| `name`        | `String`    | yes      |                 |                                                                                         |
| `contentType` | `String`    | yes      |                 |                                                                                         |
| `size`        | `Int`       | yes      |                 |                                                                                         |
| `sha256`      | `String`    | yes      |                 |                                                                                         |
| `storageKey`  | `String`    | yes      | unique          |                                                                                         |
| `createdById` | `String?`   | no       |                 |                                                                                         |
| `createdAt`   | `DateTime`  | yes      | default `now()` |                                                                                         |
| `deletedAt`   | `DateTime?` | no       |                 |                                                                                         |

Relations: `surveyId` → `Survey.id`.

Indexes and constraints: `@@index([tenantId, surveyId])`.

#### Capture

A photo answer or an interview recording (Milestone 12). Private: only people who can see the survey can open it, and every view is audited. Files live in the file store.

| Field                | Type        | Required | Key / default   | Meaning                                                                                           |
| -------------------- | ----------- | -------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `id`                 | `String`    | yes      | **PK**          | 22-character random id.                                                                           |
| `tenantId`           | `String`    | yes      |                 |                                                                                                   |
| `surveyId`           | `String`    | yes      |                 |                                                                                                   |
| `responseId`         | `String?`   | no       |                 |                                                                                                   |
| `clientId`           | `String?`   | no       |                 | CAPI: the interview's device-generated id. Captures are uploaded before the interview syncs.      |
| `ref`                | `String`    | yes      |                 | The value stored in the photo answer, or "audio" for the interview recording.                     |
| `kind`               | `String`    | yes      |                 | photo / audio                                                                                     |
| `contentType`        | `String`    | yes      |                 |                                                                                                   |
| `size`               | `Int`       | yes      |                 |                                                                                                   |
| `sha256`             | `String`    | yes      |                 |                                                                                                   |
| `storageKey`         | `String`    | yes      | unique          |                                                                                                   |
| `uploadedById`       | `String?`   | no       |                 |                                                                                                   |
| `createdAt`          | `DateTime`  | yes      | default `now()` |                                                                                                   |
| `deletedAt`          | `DateTime?` | no       |                 |                                                                                                   |
| `transcript`         | `String?`   | no       |                 | Milestone 17: speech-to-text of a recording, when a reviewer asked for it. Deleted with the file. |
| `transcriptLanguage` | `String?`   | no       |                 |                                                                                                   |
| `transcriptProvider` | `String?`   | no       |                 |                                                                                                   |
| `transcribedAt`      | `DateTime?` | no       |                 |                                                                                                   |

Relations: `responseId` → `Response.id`.

Indexes and constraints: `@@unique([clientId, ref])`; `@@unique([responseId, ref])`; `@@index([tenantId, surveyId])`.

#### FraudBlock

A device or network an organization blocked after rejecting fraud (Milestone 12). Only keyed hashes.

| Field         | Type       | Required | Key / default            | Meaning                                      |
| ------------- | ---------- | -------- | ------------------------ | -------------------------------------------- |
| `id`          | `String`   | yes      | **PK**, default `cuid()` |                                              |
| `tenantId`    | `String`   | yes      |                          |                                              |
| `kind`        | `String`   | yes      |                          | device / network                             |
| `hash`        | `String`   | yes      |                          |                                              |
| `responseId`  | `String?`  | no       |                          | The rejected response it came from, and why. |
| `note`        | `String?`  | no       |                          |                                              |
| `createdById` | `String?`  | no       |                          |                                              |
| `createdAt`   | `DateTime` | yes      | default `now()`          |                                              |

Indexes and constraints: `@@unique([tenantId, kind, hash])`.

#### RevokedSession

Milestone 20: a session that was signed out before it expired. Rows are removed once the session would have expired anyway.

| Field       | Type       | Required | Key / default   | Meaning |
| ----------- | ---------- | -------- | --------------- | ------- |
| `jti`       | `String`   | yes      | **PK**          |         |
| `userId`    | `String`   | yes      |                 |         |
| `expiresAt` | `DateTime` | yes      |                 |         |
| `createdAt` | `DateTime` | yes      | default `now()` |         |

Indexes and constraints: `@@index([expiresAt])`.

#### LibraryItem

Blueprint phase 1: the organization's question bank. A QUESTION item holds one question (without its page); a SURVEY item holds a whole definition used as an organization template.

| Field         | Type                   | Required   | Key / default            | Meaning |
| ------------- | ---------------------- | ---------- | ------------------------ | ------- |
| `id`          | `String`               | yes        | **PK**, default `cuid()` |         |
| `tenantId`    | `String`               | yes        |                          |         |
| `kind`        | enum `LibraryItemKind` | yes        |                          |         |
| `name`        | `String`               | yes        |                          |         |
| `category`    | `String`               | yes        | default `"General"`      |         |
| `tags`        | `String[]`             | yes (list) | default `[]`             |         |
| `content`     | `Json`                 | yes        |                          |         |
| `createdById` | `String?`              | no         |                          |         |
| `createdAt`   | `DateTime`             | yes        | default `now()`          |         |
| `updatedAt`   | `DateTime`             | yes        | auto-updated             |         |

Indexes and constraints: `@@index([tenantId, kind])`.

#### GlossaryTerm

Blueprint phase 2: the organization's translation glossary. Terms are sent with AI translation requests and checked by per-language QA.

| Field         | Type       | Required | Key / default            | Meaning                                    |
| ------------- | ---------- | -------- | ------------------------ | ------------------------------------------ |
| `id`          | `String`   | yes      | **PK**, default `cuid()` |                                            |
| `tenantId`    | `String`   | yes      |                          |                                            |
| `language`    | `String`   | yes      |                          | Target language tag, e.g. "fr" or "es-MX". |
| `source`      | `String`   | yes      |                          |                                            |
| `target`      | `String`   | yes      |                          |                                            |
| `note`        | `String?`  | no       |                          |                                            |
| `createdById` | `String?`  | no       |                          |                                            |
| `createdAt`   | `DateTime` | yes      | default `now()`          |                                            |
| `updatedAt`   | `DateTime` | yes      | auto-updated             |                                            |

Indexes and constraints: `@@unique([tenantId, language, source])`.

#### BlockExposure

Blueprint phase 2: how often each page of a least-fill block has been picked for a respondent.

| Field      | Type     | Required | Key / default | Meaning |
| ---------- | -------- | -------- | ------------- | ------- |
| `surveyId` | `String` | yes      |               |         |
| `blockId`  | `String` | yes      |               |         |
| `pageId`   | `String` | yes      |               |         |
| `count`    | `Int`    | yes      | default `0`   |         |

Indexes and constraints: `@@id([surveyId, blockId, pageId])`.

#### QaTestCase

Blueprint phase 2: saved QA test cases of a survey (answers plus expectations), run against every draft as a regression suite.

| Field         | Type       | Required | Key / default            | Meaning                                                 |
| ------------- | ---------- | -------- | ------------------------ | ------------------------------------------------------- |
| `id`          | `String`   | yes      | **PK**, default `cuid()` |                                                         |
| `tenantId`    | `String`   | yes      |                          |                                                         |
| `surveyId`    | `String`   | yes      |                          |                                                         |
| `name`        | `String`   | yes      |                          |                                                         |
| `data`        | `Json`     | yes      |                          | The case as `qaTestCaseSchema` (answers, seed, expect). |
| `createdById` | `String?`  | no       |                          |                                                         |
| `createdAt`   | `DateTime` | yes      | default `now()`          |                                                         |
| `updatedAt`   | `DateTime` | yes      | auto-updated             |                                                         |

Indexes and constraints: `@@index([surveyId])`.

#### BackCheck

A completed CAPI interview drawn for verification: a supervisor calls or visits the respondent, or listens to the recording, and records whether the interview really took place as recorded.

| Field           | Type                   | Required   | Key / default            | Meaning                                                                                     |
| --------------- | ---------------------- | ---------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `id`            | `String`               | yes        | **PK**, default `cuid()` |                                                                                             |
| `tenantId`      | `String`               | yes        |                          |                                                                                             |
| `surveyId`      | `String`               | yes        |                          |                                                                                             |
| `responseId`    | `String`               | yes        | unique                   |                                                                                             |
| `interviewerId` | `String?`              | no         |                          | The interviewer of the checked interview (kept here so per-interviewer rates need no join). |
| `method`        | enum `BackCheckMethod` | yes        | default `PHONE`          |                                                                                             |
| `state`         | enum `BackCheckState`  | yes        | default `PENDING`        |                                                                                             |
| `mismatches`    | `String[]`             | yes (list) | default `[]`             | Questions re-asked during the check whose answer did not match.                             |
| `note`          | `String?`              | no         |                          |                                                                                             |
| `sampledById`   | `String`               | yes        |                          |                                                                                             |
| `checkedById`   | `String?`              | no         |                          |                                                                                             |
| `checkedAt`     | `DateTime?`            | no         |                          |                                                                                             |
| `createdAt`     | `DateTime`             | yes        | default `now()`          |                                                                                             |

Indexes and constraints: `@@index([surveyId, state])`; `@@index([surveyId, interviewerId])`.

#### QualityAppeal

An interviewer asks for a quality decision on one of their interviews to be looked at again.

| Field          | Type               | Required | Key / default            | Meaning                   |
| -------------- | ------------------ | -------- | ------------------------ | ------------------------- |
| `id`           | `String`           | yes      | **PK**, default `cuid()` |                           |
| `tenantId`     | `String`           | yes      |                          |                           |
| `surveyId`     | `String`           | yes      |                          |                           |
| `responseId`   | `String`           | yes      | unique                   | One appeal per interview. |
| `raisedById`   | `String`           | yes      |                          |                           |
| `message`      | `String`           | yes      |                          |                           |
| `state`        | enum `AppealState` | yes      | default `OPEN`           |                           |
| `decisionNote` | `String?`          | no       |                          |                           |
| `decidedById`  | `String?`          | no       |                          |                           |
| `decidedAt`    | `DateTime?`        | no       |                          |                           |
| `createdAt`    | `DateTime`         | yes      | default `now()`          |                           |

Indexes and constraints: `@@index([surveyId, state])`; `@@index([raisedById])`.

#### Contact

Someone a survey can be sent to by email (blueprint distribution).

| Field            | Type        | Required | Key / default            | Meaning                                                                                         |
| ---------------- | ----------- | -------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `id`             | `String`    | yes      | **PK**, default `cuid()` |                                                                                                 |
| `tenantId`       | `String`    | yes      |                          |                                                                                                 |
| `surveyId`       | `String`    | yes      |                          |                                                                                                 |
| `email`          | `String?`   | no       |                          | Email or phone (or both); blueprint phase 5 adds phone for SMS invitations.                     |
| `phone`          | `String?`   | no       |                          | E.164, e.g. +447700900123.                                                                      |
| `name`           | `String?`   | no       |                          |                                                                                                 |
| `language`       | `String?`   | no       |                          |                                                                                                 |
| `fields`         | `Json`      | yes      | default `"{}"`           | Extra columns from the import, passed to the survey as link parameters (e.g. region, panel id). |
| `unsubscribedAt` | `DateTime?` | no       |                          |                                                                                                 |
| `createdAt`      | `DateTime`  | yes      | default `now()`          |                                                                                                 |

Indexes and constraints: `@@unique([surveyId, email])`; `@@unique([surveyId, phone])`; `@@index([tenantId])`.

#### Distribution

| Field             | Type                       | Required | Key / default            | Meaning                                                                                                     |
| ----------------- | -------------------------- | -------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `id`              | `String`                   | yes      | **PK**, default `cuid()` |                                                                                                             |
| `tenantId`        | `String`                   | yes      |                          |                                                                                                             |
| `surveyId`        | `String`                   | yes      |                          |                                                                                                             |
| `name`            | `String`                   | yes      |                          |                                                                                                             |
| `channel`         | enum `DistributionChannel` | yes      | default `EMAIL`          | Blueprint phase 5: email (subject + body) or SMS (body only).                                               |
| `subject`         | `String`                   | yes      |                          |                                                                                                             |
| `body`            | `String`                   | yes      |                          | Plain text; [link] becomes the person's own survey link, [name] their name, [unsubscribe] the opt-out link. |
| `sendAt`          | `DateTime`                 | yes      |                          |                                                                                                             |
| `reminderDays`    | `Int`                      | yes      | default `0`              | Remind people who have not completed this many days after the last email (0 = no reminders).                |
| `maxReminders`    | `Int`                      | yes      | default `0`              |                                                                                                             |
| `reminderSubject` | `String?`                  | no       |                          |                                                                                                             |
| `state`           | enum `DistributionState`   | yes      | default `SCHEDULED`      |                                                                                                             |
| `createdById`     | `String`                   | yes      |                          |                                                                                                             |
| `sentAt`          | `DateTime?`                | no       |                          |                                                                                                             |
| `createdAt`       | `DateTime`                 | yes      | default `now()`          |                                                                                                             |

Relations: has many `Invitation` (`invitations`).

Indexes and constraints: `@@index([surveyId])`; `@@index([state, sendAt])`.

#### Invitation

| Field            | Type                   | Required | Key / default            | Meaning                                                                            |
| ---------------- | ---------------------- | -------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `id`             | `String`               | yes      | **PK**, default `cuid()` |                                                                                    |
| `tenantId`       | `String`               | yes      |                          |                                                                                    |
| `distributionId` | `String`               | yes      |                          |                                                                                    |
| `contactId`      | `String`               | yes      |                          |                                                                                    |
| `uid`            | `String`               | yes      | unique                   | The respondent id in the person's survey link; random, so links cannot be guessed. |
| `state`          | enum `InvitationState` | yes      | default `QUEUED`         |                                                                                    |
| `sends`          | `Int`                  | yes      | default `0`              | Emails sent: the invitation plus reminders.                                        |
| `lastSentAt`     | `DateTime?`            | no       |                          |                                                                                    |
| `nextReminderAt` | `DateTime?`            | no       |                          |                                                                                    |
| `error`          | `String?`              | no       |                          |                                                                                    |
| `createdAt`      | `DateTime`             | yes      | default `now()`          |                                                                                    |

Relations: `distributionId` → `Distribution.id` (on delete Cascade).

Indexes and constraints: `@@unique([distributionId, contactId])`; `@@index([nextReminderAt])`.

#### AutomationRule

An automation rule: when the trigger happens (a survey event or a schedule) and every condition holds, run the actions, or hold them for an administrator's approval first.

| Field              | Type        | Required | Key / default            | Meaning                                                                                      |
| ------------------ | ----------- | -------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `id`               | `String`    | yes      | **PK**, default `cuid()` |                                                                                              |
| `tenantId`         | `String`    | yes      |                          |                                                                                              |
| `name`             | `String`    | yes      |                          |                                                                                              |
| `enabled`          | `Boolean`   | yes      | default `true`           |                                                                                              |
| `surveyId`         | `String?`   | no       |                          | Only events of this survey (required for schedules). Null: every survey in the organization. |
| `trigger`          | `String`    | yes      |                          | A webhook event name (response.finished, quota.full, ...) or "schedule".                     |
| `schedule`         | `Json?`     | no       |                          | For schedules: {every: "hour" / "day" / "week", at?: "HH:MM" (UTC), weekday?: 0-6}.          |
| `conditions`       | `Json`      | yes      | default `"[]"`           | [{field, op, value}], all must hold. Fields: event.<key> or metrics.<name>.                  |
| `actions`          | `Json`      | yes      |                          | [{type: "notify" / "email" / "webhook" / "set_survey_status", ...}]                          |
| `requiresApproval` | `Boolean`   | yes      | default `false`          |                                                                                              |
| `cooldownMinutes`  | `Int`       | yes      | default `0`              | The rule fires at most once in this many minutes (0: every time).                            |
| `nextRunAt`        | `DateTime?` | no       |                          |                                                                                              |
| `lastFiredAt`      | `DateTime?` | no       |                          |                                                                                              |
| `createdById`      | `String?`   | no       |                          |                                                                                              |
| `createdAt`        | `DateTime`  | yes      | default `now()`          |                                                                                              |
| `updatedAt`        | `DateTime`  | yes      | auto-updated             |                                                                                              |

Relations: has many `AutomationRun` (`runs`).

Indexes and constraints: `@@index([tenantId, trigger])`; `@@index([nextRunAt])`.

#### AutomationRun

One firing of a rule: the event it saw, whether its conditions held, and what each action did.

| Field         | Type                      | Required | Key / default            | Meaning                                           |
| ------------- | ------------------------- | -------- | ------------------------ | ------------------------------------------------- |
| `id`          | `String`                  | yes      | **PK**, default `cuid()` |                                                   |
| `tenantId`    | `String`                  | yes      |                          |                                                   |
| `ruleId`      | `String`                  | yes      |                          |                                                   |
| `event`       | `String`                  | yes      |                          |                                                   |
| `data`        | `Json`                    | yes      |                          |                                                   |
| `state`       | enum `AutomationRunState` | yes      | default `PENDING`        |                                                   |
| `note`        | `String?`                 | no       |                          | Why it was skipped, or the condition values seen. |
| `results`     | `Json?`                   | no       |                          | [{type, ok, detail}] per action.                  |
| `decidedById` | `String?`                 | no       |                          |                                                   |
| `decidedAt`   | `DateTime?`               | no       |                          |                                                   |
| `createdAt`   | `DateTime`                | yes      | default `now()`          |                                                   |
| `updatedAt`   | `DateTime`                | yes      | auto-updated             |                                                   |

Relations: `ruleId` → `AutomationRule.id` (on delete Cascade).

Indexes and constraints: `@@index([state, createdAt])`; `@@index([ruleId, createdAt])`; `@@index([tenantId, state])`.

#### Notification

An in-app notification for one member.

| Field       | Type        | Required | Key / default            | Meaning                                                  |
| ----------- | ----------- | -------- | ------------------------ | -------------------------------------------------------- |
| `id`        | `String`    | yes      | **PK**, default `cuid()` |                                                          |
| `tenantId`  | `String`    | yes      |                          |                                                          |
| `userId`    | `String`    | yes      |                          |                                                          |
| `title`     | `String`    | yes      |                          |                                                          |
| `body`      | `String`    | yes      |                          |                                                          |
| `link`      | `String?`   | no       |                          | A studio path to open, e.g. /surveys/abc?tab=automation. |
| `readAt`    | `DateTime?` | no       |                          |                                                          |
| `createdAt` | `DateTime`  | yes      | default `now()`          |                                                          |

Indexes and constraints: `@@index([userId, readAt, createdAt])`.

### Enums

| Enum                  | Values                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Role`                | `ADMIN`, `PROGRAMMER`, `VIEWER`, `INTERVIEWER`                                                                                     |
| `InterviewMode`       | `CAWI`, `CAPI`, `CATI`                                                                                                             |
| `CatiCaseStatus`      | `PENDING`, `CALLBACK`, `IN_CALL`, `DONE`, `CLOSED`                                                                                 |
| `ReviewState`         | `NONE`, `PENDING`, `ACCEPTED`, `REJECTED`                                                                                          |
| `ProjectScope`        | `ALL`, `ASSIGNED`                                                                                                                  |
| `SurveyStatus`        | `DRAFT`, `LIVE`, `PAUSED`, `CLOSED`                                                                                                |
| `VersionStatus`       | `DRAFT`, `PUBLISHED`, `SUPERSEDED`                                                                                                 |
| `RedirectMode`        | `STATIC`, `DYNAMIC`, `HYBRID`                                                                                                      |
| `ChangeSource`        | `AI`, `IMPORT`, `MANUAL`                                                                                                           |
| `ChangeStatus`        | `PROPOSED`, `APPLIED`, `REJECTED`                                                                                                  |
| `ResponseStatus`      | `IN_PROGRESS`, `COMPLETE`, `TERMINATE`, `QUOTA_FULL`, `QUALITY_FAIL`, `SECURITY_REJECT`, `DUPLICATE`, `PARTIAL`, `TECHNICAL_ERROR` |
| `VendorIntegration`   | `DIRECT`, `PROJEXA`                                                                                                                |
| `CallbackState`       | `PENDING`, `DELIVERED`, `FAILED`, `DEAD`                                                                                           |
| `JobStatus`           | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`                                                                            |
| `LibraryItemKind`     | `QUESTION`, `SURVEY`, `BLOCK`                                                                                                      |
| `BackCheckMethod`     | `PHONE`, `VISIT`, `RECORDING`                                                                                                      |
| `BackCheckState`      | `PENDING`, `VERIFIED`, `FAILED`, `UNREACHABLE`                                                                                     |
| `AppealState`         | `OPEN`, `UPHELD`, `OVERTURNED`                                                                                                     |
| `DistributionState`   | `SCHEDULED`, `SENDING`, `SENT`, `CANCELLED`                                                                                        |
| `DistributionChannel` | `EMAIL`, `SMS`                                                                                                                     |
| `InvitationState`     | `QUEUED`, `SENT`, `FAILED`, `SKIPPED`                                                                                              |
| `AutomationRunState`  | `PENDING`, `AWAITING_APPROVAL`, `RUNNING`, `DONE`, `SKIPPED`, `REJECTED`, `FAILED`                                                 |

<!-- 51 models, 22 enums -->
