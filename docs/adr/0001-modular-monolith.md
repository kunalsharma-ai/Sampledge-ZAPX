# 0001 · Modular monolith with separable modules

Date: 2026-11-01 · Status: Accepted

## Context

ZAPX starts with one primary developer assisted by Claude, with more developers later. It has to
integrate with PROJEXA, BIDZO, DEALFLOW and future Sampledge platforms, and some parts (redirects,
AI, background work) may need to scale or deploy separately one day. Microservices from day one
would multiply deployment, observability and data-consistency work before there is load to justify it.

## Decision

One NestJS API process and one PostgreSQL database, split into modules with explicit boundaries:

- Pure, framework-free packages hold domain logic: `survey-schema`, `logic-engine`,
  `survey-renderer`, `redirect-core`. They have no database or HTTP code and are unit-tested alone.
- API modules own their tables and expose a small surface. Other modules depend on abstract
  classes (`RedirectService`, `AiProvider`, `SecretBox`), never on another module's tables.
- New modules put all database access in one repository class (see 0002).
- Partner-facing APIs are versioned (`/api/v1/...`) and documented in `docs/api/openapi.yaml`;
  studio endpoints are internal and may change with the studio.

## Consequences

- One deployable, one migration history, simple local development (`docker compose up`).
- A module can be extracted by moving its package and repository behind an HTTP client that
  implements the same abstract class. The Redirect & Vendor Integration module is built this way
  first (0003).
- The discipline is by convention and review; ESLint and CODEOWNERS help (0006).
