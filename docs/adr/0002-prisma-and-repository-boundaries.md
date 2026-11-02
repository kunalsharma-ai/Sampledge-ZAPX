# 0002 · Prisma on PostgreSQL, behind repository boundaries

Date: 2026-11-01 · Status: Accepted

## Context

Approved stack: Prisma and PostgreSQL. Requirements: versioned migrations, multi-tenant isolation,
indexes on project, vendor, survey and respondent records, transaction safety, soft deletion, audit
trails, connection pooling, backups, and the ability to replace the ORM later.

## Decision

- **Migrations**: `packages/db/prisma/migrations`, created with `prisma migrate dev`, applied with
  `prisma migrate deploy` (CI, the `migrate` container, an ECS task before each release).
- **Tenancy**: every tenant-owned table has `tenantId`; every studio query filters by the session's
  tenant. PostgreSQL row-level security is planned as a second line of defence before external
  customers are onboarded.
- **Concurrency**: conditional updates (`updateMany ... where status = IN_PROGRESS`), atomic quota
  increments (`count < target`), compare-and-swap on draft `updatedAt`, `SELECT ... FOR UPDATE`
  where read-modify-write is unavoidable, and `FOR UPDATE SKIP LOCKED` for the callback outbox.
- **Soft delete**: projects, surveys and vendors have `deletedAt`. Deleted rows disappear from the
  studio and their links stop working; responses, logs and the audit trail stay. Responses are never
  soft-deleted by users; retention and erasure will be explicit data-protection jobs.
- **Audit**: `AuditEvent` for every change by a person or by AI; `RedirectEvent`,
  `OutboundCallback.log` and `AiUsage` for operational history.
- **Repository boundaries**: new modules keep all Prisma calls in one repository class
  (`RedirectRepository`, `AiUsageRepository`). Older controllers that call Prisma directly are
  moved behind repositories when they are next changed, not in one big rewrite.
- **Pooling and backups**: see `docs/operations/database.md`.

## Consequences

- Replacing Prisma means re-implementing repository classes, not business logic, once the older
  controllers have been moved.
- Prisma lacks partial unique indexes in its schema language, so a soft-deleted vendor keeps its
  code reserved (which is also safer: old links never reach a different vendor).
