# 0036. Super admin: plans, features per surface, and platform automation

Date: 2026-11-05 · Status: Accepted

## Context

Until now the organization administrator was the top role. Kunal asked for a super admin above
every organization who registers organizations and their administrators, manages subscriptions,
switches every feature on or off per subscription (separately for the web CRM and the mobile app),
sees all activity and integrations, and automates subscription handling. Changes must take effect at
once in the CRM and the mobile app.

## Decision

- **Role.** `User.superAdmin` (a flag, not a fifth `Role`), only for members of the organization that
  runs the installation (`Tenant.platformOperator`). Set with `node apps/api/dist/cli/set-super-admin.js
<email>`; the dev seed creates `superadmin@zapx.local`. Never through an API key. The super admin
  always has every feature and also manages the platform integrations.
- **Plans in the database.** `SubscriptionPlan` (code, name, price for display, limits, `webFeatures`,
  `mobileFeatures`). The four built-in plans are written on first start with every feature, so nothing
  changes for existing organizations. `PlanService` reads limits from it (cached, refreshed every 10 s
  and after each change). Stripe prices stay in Integrations.
- **Feature catalog and route map** in `apps/api/src/super-admin/features.ts`: 30 feature keys, and a
  first-match list of route patterns to features (reads and writes can need different features).
  Routes that match nothing are not gated (sign-in, respondent links, provider webhooks, SCIM).
- **Entitlements** = plan features for the surface, then organization overrides (can add or remove),
  then member overrides (can only remove), then `surveys.edit`/`publish` need `surveys.view`. A
  suspended organization or a member without mobile access has nothing. Unknown keys are off.
- **Enforcement in the auth guard**, which already reads the member on every request: it now also
  reads the organization's plan, suspension and overrides, and refuses with 403 `FEATURE_DISABLED`,
  `ORG_SUSPENDED`, `MOBILE_DISABLED` or `SUPER_ADMIN_ONLY`. The surface comes from the
  `X-ZAPX-Client: mobile` header. It also records `lastSeenAt`/`lastClient` at most once a minute.
- **Live updates.** `GET /api/me/entitlements` (ETag/304) and `GET /api/me/entitlements/stream`
  (server-sent events; re-checks every 3 s for changes made by other processes). The studio's
  `useMe` keeps one stream per page and hides menu entries at once; the mobile app uses the same API.
- **Platform automation.** `PlatformAutomation` rules: one trigger (new organization, subscription
  ending/ended, completes share, seats full, administrators inactive) and a list of actions (notify
  super admins, email organization admins, change plan, change subscription, suspend, reactivate,
  switch a feature). Checked every `PLATFORM_AUTOMATION_MS` in each API process; a firing is claimed
  by inserting a `PlatformAutomationRun` unique on (rule, dedupe key), so it runs once even with
  several processes. Six ready-made rules are one click away.
- Every super admin change is written to the audit log of the organization it touches.

## Consequences

- One extra join per authenticated request (the organization row), no extra query.
- New routes must be added to the route map in `features.ts`, or they are not gated by a feature.
- Billing is still not charged by ZAPX; the price on a plan is for display, Stripe stays optional.
