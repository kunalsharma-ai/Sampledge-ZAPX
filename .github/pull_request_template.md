## What and why

## How it was tested

- [ ] `pnpm check` passes on this branch's head commit (or `pnpm check --no-docker` with the reason)

## Checklist

- [ ] Database changes come with a migration, and tenant isolation is kept (`tenantId` on every query)
- [ ] New endpoints validate input and check roles
- [ ] Secrets and model ids come from configuration, not code
- [ ] Docs or an ADR updated if a module boundary or contract changed
