# 0012: PostgreSQL row-level security on respondent data

Status: Accepted (Milestone 6)

## Context

Tenant isolation has relied on every query filtering by `tenantId`. One missing filter in a future
endpoint could expose another organization's respondents. Respondent data (`Response`: answers,
outcomes, quality flags) is the most sensitive table, and the one external customers will ask about.

## Decision

- `Response` has row-level security enabled and forced (so it applies to the table owner too), with
  one policy: a row is visible and writable when `app.tenant_id` is unset, or when it equals the row's
  `tenantId`.
- `PrismaService.forTenant(tenantId)` returns a client that runs each operation in a short transaction
  that first sets `app.tenant_id` (`set_config(..., true)`, transaction-local, safe with connection
  pooling). Studio reads of respondent data use it: the responses list, CSV and Excel exports, the
  quality review queue and decisions, and the fieldwork dashboard.
- System paths do not set it: the respondent runtime (which has no tenant until it has found the
  survey), the CAPI sync, background workers and migrations. For them the policy allows every row.
- At start-up the API checks whether its database role is a superuser or has `BYPASSRLS` (Postgres
  never applies policies to those) and logs a warning; admins see the result at
  `GET /api/audit/security` (`enforced` or `bypassed`).

## Consequences

- This is a second line of defence for the studio's respondent-data reads, not a replacement for the
  application's tenant filters, and it does not cover system paths or other tables yet. It is
  described that way in the security notes; it must not be described as full database-level tenant
  isolation.
- Production must run the API as a plain role (not the owner created by the Postgres image). The
  local `docker compose` stack uses the image's `zapx` superuser, so policies are bypassed there;
  `docs/operations/database.md` shows how to create the application role.
- Next steps: a non-permissive policy for a dedicated studio role, then the same policy on other
  tenant tables (audit, change sets, QA runs).
