# Database operations

PostgreSQL 16, Prisma 6. Decision: [ADR 0002](../adr/0002-prisma-and-repository-boundaries.md).

## Migrations

- Create: `pnpm --filter @zapx/db migrate:dev --name <change>` (development database only).
- Apply: `pnpm db:migrate` locally and in CI; the `migrate` image (`docker compose` or an ECS
  one-off task) before each release. Migrations are additive where possible; destructive changes
  ship in two releases (stop using, then drop).

## Connection pooling

Each API process has one Prisma pool. Size it in `DATABASE_URL`:
`?connection_limit=10&pool_timeout=20`. Rule of thumb: instances × `connection_limit` must stay well
below the server's `max_connections` (leave room for migrations and admin sessions). On AWS put
**RDS Proxy** between ECS tasks and RDS; with a transaction-mode proxy or PgBouncer add
`&pgbouncer=true`, and run migrations against the direct endpoint.

## Backups and recovery

|                       | Local / single server                                       | AWS                                                                      |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Continuous            | –                                                           | RDS automated backups with point-in-time recovery (retention 14–35 days) |
| Daily                 | `infra/scripts/backup.sh` (pg_dump custom format, keeps 14) | automated snapshots; copy to a second region for DR                      |
| Before risky releases | `infra/scripts/backup.sh`                                   | manual snapshot                                                          |
| Restore               | `infra/scripts/restore.sh <file>` into an empty database    | restore to a new instance, verify, switch the endpoint                   |

Targets to agree with customers: RPO ≤ 5 minutes (PITR), RTO ≤ 1 hour. **Test a restore every
quarter** into a scratch database and run `pnpm test` against it; a backup that has never been
restored is not a backup.

## Soft delete

Projects, surveys and vendors have `deletedAt`. Queries filter `deletedAt: null`. Restoring is a
database operation for now (`UPDATE ... SET "deletedAt" = NULL`), recorded in the audit trail by hand.

## Tenant isolation

Every tenant-owned row has `tenantId`, and every studio query filters on it. Since Milestone 6,
`Response` also has a row-level security policy (ADR 0012): reads of respondent data from the studio
run with `app.tenant_id` set, so Postgres itself hides other tenants' responses.

Postgres never applies policies to superusers or roles with `BYPASSRLS`. The `postgres` image makes
`POSTGRES_USER` a superuser, so in production run migrations as the owner and the API as a plain role:

```sql
CREATE ROLE zapx_app LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE zapx TO zapx_app;
GRANT USAGE ON SCHEMA public TO zapx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zapx_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zapx_app;
```

Point the API's `DATABASE_URL` at `zapx_app` and keep the owner's URL for `prisma migrate deploy`.
`GET /api/audit/security` (admins) answers `enforced` when the policy applies to the API's role.
