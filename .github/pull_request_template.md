## What and why

## How it was tested

- [ ] `pnpm lint`, `pnpm format:check`, `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm e2e` (if the UI or the respondent flow changed)

## Checklist

- [ ] Database changes come with a migration, and tenant isolation is kept (`tenantId` on every query)
- [ ] New endpoints validate input and check roles
- [ ] Secrets and model ids come from configuration, not code
- [ ] Docs or an ADR updated if a module boundary or contract changed
