# Security and code quality review

This review was done while writing the handbook, by reading the code on `blueprint-p5-enterprise`
(PR #34) on 2026-11-05, and extended for PRs #37–#41 on branch `mobile-app` the same day (S10–S13).
**No code was changed by this review** (S1–S3 were then fixed in PR #36). Each finding says what was seen, where, why it
matters and what to consider. Severities are the reviewer's judgement, not the result of a
penetration test; nothing here was exploited against a running system other than the local one.

For the project's own security notes, which this review does not replace, see
[docs/security.md](../security.md) and [ADR 0026 security hardening](../adr/0026-security-hardening.md).

## 1. What is already in place (verified in code)

| Area                            | What the code does                                                                                                                                                                                                                                           | Where                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Authentication                  | Global `AuthGuard`; every route needs a session or API key unless marked `@Public()`                                                                                                                                                                         | `apps/api/src/auth/auth.guard.ts`, `app.module.ts`                                |
| Sessions                        | HS256 JWT, 12 h, unique `jwtid`; `httpOnly`, `SameSite=Lax` cookie `zapx_token`, `Secure` when `COOKIE_SECURE=true`; "sign out everywhere" via `sessionsRevokedAt`                                                                                           | `apps/api/src/auth/session.ts`                                                    |
| CSRF                            | Cookie requests must send `x-zapx-csrf: 1`, which a cross-site form cannot add                                                                                                                                                                               | `auth.guard.ts`                                                                   |
| Passwords                       | bcryptjs cost 10; 10–200 characters; common-password list; dummy-hash compare against timing leaks                                                                                                                                                           | `auth/auth.controller.ts`, `users/users.controller.ts`, `auth/password-policy.ts` |
| Brute force                     | Per-address throttle on login/sign-up; account lockout after `LOGIN_MAX_FAILURES` for `LOGIN_LOCK_MINUTES`                                                                                                                                                   | `auth.controller.ts`                                                              |
| API keys                        | `zapx_<prefix>_<secret>`; only a SHA-256 hash stored; shown once; expiry and revoke; die when the creator is disabled                                                                                                                                        | `auth.guard.ts`, `model ApiKey`                                                   |
| Authorization                   | `@Roles(...)` per route; INTERVIEWER deny-by-default; project scoping returns 404, not 403                                                                                                                                                                   | `auth.guard.ts`, `projects/access.service.ts`                                     |
| Tenant isolation                | Every query filters `tenantId`; PostgreSQL RLS (`zapx_tenant_isolation`) on `Response` and `Capture` via `forTenant`                                                                                                                                         | `common/prisma.service.ts`, ADR 0012                                              |
| Input validation                | Zod schemas on every body (`parseBody` → 400 with `issues`); JSON body limit 100 kB; upload size limits                                                                                                                                                      | `common/`, `bootstrap.ts`, upload controllers                                     |
| Uploads                         | Media type decided from the file's bytes (`sniffMedia`), not the client's claim; served with `nosniff`                                                                                                                                                       | `media/media.service.ts`, `media/media.controller.ts`                             |
| Outbound calls (SSRF)           | Callback and webhook hosts that resolve to private addresses are blocked, also after DNS resolution (rebinding)                                                                                                                                              | `common/net-guard.ts`, `integrations/http-delivery.ts`                            |
| Secrets at rest                 | Partner and webhook signing secrets sealed with AES-256-GCM (`SecretBox`, key `SECRETS_KEY`)                                                                                                                                                                 | `platform/secret-box.ts`                                                          |
| Production guard                | Refuses to start in production with example secrets, insecure cookies, private callback hosts, insecure SSO issuers                                                                                                                                          | `config.ts` (`superRefine`)                                                       |
| HTTP headers                    | API: CSP `default-src 'none'`, `X-Frame-Options DENY`, `nosniff`, `no-store`, HSTS over https; studio, runtime and CAPI set their own                                                                                                                        | `bootstrap.ts`, `apps/studio/next.config.mjs`, `infra/nginx/*-headers.conf`       |
| CORS                            | **Not enabled.** Studio, runtime and CAPI reach the API through same-origin proxies                                                                                                                                                                          | `bootstrap.ts`                                                                    |
| Edge trust                      | Client address and country headers are trusted only with the `EDGE_SHARED_SECRET` header (constant-time compare)                                                                                                                                             | `bootstrap.ts` `edgeTrust`                                                        |
| Personal data                   | Respondent IP never stored, only a keyed HMAC; soft delete and erasure; audit log                                                                                                                                                                            | `quality/quality.service.ts`, [DATABASE.md](DATABASE.md)                          |
| Error handling                  | Unknown errors return a generic 500; details go only to the server log                                                                                                                                                                                       | NestJS default                                                                    |
| Super admin _(PR #41)_          | `User.superAdmin` set only from the command line or by another super admin; never through an API key; only members of the operator organization; a super admin cannot remove their own flag; every change is written to the touched organization's audit log | `auth.guard.ts`, `super-admin/super-admin.service.ts`, `cli/set-super-admin.ts`   |
| Feature entitlements _(PR #41)_ | checked in `AuthGuard` on every request, per surface (web or mobile), with 403 codes; suspended organizations are refused everything but sign-out and `auth/me`                                                                                              | `auth.guard.ts`, `super-admin/features.ts`                                        |
| Integration keys _(PR #38)_     | sealed with `SecretBox` in `PlatformIntegration.secretsSealed`; the browser only learns whether a secret is set and its last four characters; changes and tests are audited                                                                                  | `platform/integrations.ts`, `integration-settings.service.ts`                     |
| Mobile app _(PR #40)_           | session token kept in the device's secure storage (`expo-secure-store`), sent as `Bearer` (no cookie, so no CSRF exposure); minimum app version enforced by the server                                                                                       | `apps/mobile/src/lib/storage.ts`, `api.ts`, `mobile/mobile.controller.ts`         |
| Repository hygiene              | Pre-commit secret scan; `.env` git-ignored; dependency audit with recorded exceptions                                                                                                                                                                        | `.githooks/`, `scripts/secret-scan.mjs`, `docs/security.md`                       |

## 2. Potential issues found

| #   | Severity | Finding                                                                                              | Status                                            |
| --- | -------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| S1  | Medium   | Vendor shared secret is readable by every role, including VIEWER                                     | **Fixed** on branch `security-fixes` (ADMIN only) |
| S2  | Medium   | Terraform secret list and the documented secret JSON disagree                                        | **Fixed** on branch `security-fixes`              |
| S3  | Medium   | No way to reset or change a password                                                                 | **Fixed** on branch `security-fixes`              |
| S4  | Low–Med  | Rate limits are per API process                                                                      | open                                              |
| S5  | Low–Med  | `JWT_SECRET` keys several unrelated things                                                           | open                                              |
| S6  | Low      | Studio content security policy does not restrict scripts                                             | open                                              |
| S7  | Low      | Login answers with the session token in the body too                                                 | open                                              |
| S8  | Low      | Automated security scanning never runs on GitHub                                                     | open                                              |
| S9  | Info     | Row-level security covers two tables only                                                            | open                                              |
| S10 | Low–Med  | Feature gating is a list of route patterns; unlisted routes are open _(PR #41)_                      | open                                              |
| S11 | Low      | The oldest organization becomes the platform operator automatically _(PR #38)_                       | open                                              |
| S12 | Info     | Super admins see the vendor secret only if they are also ADMIN of that organization _(PR #36 + #41)_ | open, owner to decide                             |
| S13 | Info     | Runtime CSP now allows `'wasm-unsafe-eval'` for eye tracking _(PR #37)_                              | accepted by design                                |

The review below describes the code as it was found on `blueprint-p5-enterprise`; each fixed
finding ends with what the fix changed.

### S1. Vendor shared secret readable by every role (Medium)

- **Seen:** `presentVendor` (`apps/api/src/vendors/vendors.controller.ts`, line 66) removes only
  `partnerSecretEnc`. The vendor's `secret` is returned by `GET /api/projects/:projectId/vendors`
  (line 123) and `GET /api/vendors/:id` (line 153), which have no `@Roles(...)`, so ADMIN,
  PROGRAMMER and VIEWER all receive it. The studio shows it in `apps/studio/components/VendorEditor.tsx`
  (line 317). The column `Vendor.secret` is stored as plain text (`docs/security.md` says so).
- **Why it matters:** the same secret signs entry links, signed redirects and callbacks and
  authenticates the vendor API (the studio's own label says so). A read-only member, or anyone who
  steals a VIEWER session or the database, could forge signed redirects to a vendor (for example
  fake completes) or read outcomes through the vendor API.
- **Consider:** return the secret only to `CAN_EDIT` roles, or replace it with a "reveal" action that
  is audited; seal it with `SecretBox` like the partner secret. Existing secrets can then be rotated
  with `POST /api/vendors/:id/rotate-secret`.

- **Fixed (branch `security-fixes`):** `presentVendor(v, role)` returns `secret` only to ADMIN
  (`SEES_VENDOR_SECRET`; ZAPX has no separate super admin role). Programmers and viewers get the
  rest of the vendor without it; programmers can still edit vendors and rotate the secret, but an
  admin hands the new secret to the vendor. Test: `apps/api/test/security-fixes.test.ts`. Sealing the column
  with `SecretBox` is still open (it needs a data migration of every vendor).

### S2. Terraform secret keys and the documented secret JSON disagree (Medium, deployment)

- **Seen:** `app_secret_keys` in `infra/terraform/variables.tf` includes `TWILIO_AUTH_TOKEN`; the
  example secret JSON in `infra/terraform/README.md` does not. `SENDGRID_API_KEY` is not in
  `app_secret_keys` at all.
- **Why it matters:** ECS refuses to start a task whose secret reference is missing, so following the
  README exactly fails the first release. Without a secret slot for SendGrid, the easy workaround is
  putting the key in `app_environment`, which is stored as plain text in the task definition and the
  Terraform state.
- **Consider:** add both keys to the example JSON and `SENDGRID_API_KEY` to `app_secret_keys`.
  Re-check after PR #28 (integrations in the CRM) merges, since it moves provider keys.

- **Fixed (branch `security-fixes`):** `SENDGRID_API_KEY` added to `app_secret_keys`, and the
  README's example JSON now lists every key including `TWILIO_AUTH_TOKEN`. A test in
  `apps/api/test/security-fixes.test.ts` fails if the two drift apart again.

### S3. No password reset or change (Medium)

- **Seen:** `apps/api/src/auth/auth.controller.ts` has `login`, `register`, `logout`, `logout-all`
  only; `PATCH /api/users/:id` changes `role`, `projectScope`, `disabled` only.
- **Why it matters:** a member who thinks their password leaked cannot change it; an administrator
  cannot reset one. The only route is a direct database update (see
  [TROUBLESHOOTING.md 6b](TROUBLESHOOTING.md#6b-email-or-password-is-incorrect-for-a-user-that-exists)),
  which is error-prone and bypasses the audit log. SSO tenants are less affected.
- **Consider:** "change my password" (needs the current one, sets `sessionsRevokedAt`) and an
  administrator reset that issues a one-time link; both audited.

- **Fixed (branch `security-fixes`):** `POST /api/auth/change-password` (current password needed,
  other sessions signed out, this one kept), `POST /api/users/:id/password-reset` (admin one-time
  link, also emailed when email is set up), `POST /api/auth/forgot-password` (emails a link; always 204) and `POST /api/auth/reset-password`. Tokens are stored as SHA-256 hashes in `PasswordReset`,
  work once, expire after `PASSWORD_RESET_HOURS` and are voided by a newer link; every change is
  audited. Studio: My account, Forgot your password?, Settings → Team → Reset password.

### S4. Rate limits are per API process (Low–Medium)

- **Seen:** `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }])` in `apps/api/src/app.module.ts`
  (line 88) with the default in-memory store. Production runs at least two API tasks with autoscaling.
- **Why it matters:** each task counts separately, so real limits are the configured value times the
  number of tasks, and change as autoscaling adds tasks. Account lockout (per account, stored in the
  database) and the WAF rate limit reduce the impact on login.
- **Consider:** a shared throttler store (PostgreSQL or Valkey) when exact limits matter, for example
  for the vendor API (120/min) and AI routes.

### S5. `JWT_SECRET` keys several unrelated things (Low–Medium, operations)

- **Seen:** besides sessions (`app.module.ts`), `JWT_SECRET` keys test-link signatures
  (`interview/interview.service.ts` `testSignature`), the network-address hash used for duplicate
  detection (`quality/quality.service.ts`, lines 71 and 76) and the SSO state (`auth/sso.service.ts`,
  line 100). `SecretBox` and the phone hash in `cati/calling-rules.ts` fall back to it when
  `SECRETS_KEY` is unset (development only; production requires `SECRETS_KEY`).
- **Why it matters:** rotating `JWT_SECRET` after a leak signs everyone out (expected) but also
  breaks every test link already shared and makes new respondents' address hashes incomparable with
  old ones, so same-network duplicate checks miss repeats across the rotation. This is easy to
  overlook during an incident.
- **Consider:** document this in the rotation procedure now; later derive separate keys for each
  purpose from a dedicated secret.

### S6. Studio CSP does not restrict scripts (Low)

- **Seen:** `apps/studio/next.config.mjs` sets `frame-ancestors`, `object-src`, `base-uri`,
  `connect-src` and `worker-src`, but no `script-src` or `default-src` (the comment says Next.js
  needs inline scripts). `apps/studio/app/layout.tsx` uses `dangerouslySetInnerHTML` only for two
  constants (theme CSS and boot script), not user data.
- **Why it matters:** if an XSS bug appears, the CSP will not stop injected script. React's escaping
  is the main defence. `connect-src 'self'` does limit where stolen data can be sent with `fetch`.
- **Consider:** a nonce-based `script-src` through Next.js middleware.

### S7. Session token also in the login response body (Low)

- **Seen:** `login` and `register` return `{ user, token }` (`auth.controller.ts`, lines 92 and 118)
  as well as setting the `httpOnly` cookie. The studio and CAPI app do not read `token`
  (searched `apps/studio`, `apps/capi`).
- **Why it matters:** the cookie is `httpOnly` so script cannot read it, but script running on the
  login page could read the body. Low because it needs an XSS on that page first.
- **Consider:** return the token only when the client asks for it (for example a `?token=1` flag for
  scripts), or point scripts to API keys.
- **Update (PR #40):** the mobile app now relies on the token in the login body (it cannot use the
  cookie). Any change here must keep a way for the app to get it, for example only when the request
  carries `X-ZAPX-Client: mobile`.

### S8. Automated security scanning never runs on GitHub (Low, process)

- **Seen:** `.github/workflows/ci.yml` and `codeql.yml` exist but the free plan has no Actions (ADR
  0009). `pnpm check` runs secret scan and `pnpm audit`, but there is no static analysis like
  CodeQL locally.
- **Consider:** run CodeQL CLI or Semgrep locally before releases, or enable Actions if the plan
  changes. Keep Dependabot PRs (#20–#25) moving.

### S9. Row-level security covers two tables (Info)

- **Seen:** the `zapx_tenant_isolation` policy is on `Response` and `Capture` only (ADR 0012). All
  other tables rely on every query filtering `tenantId` and on `AccessService`.
- **Why it matters:** a new query that forgets the filter leaks across tenants. The API tests cover
  existing routes, but nothing stops a new route from forgetting.
- **Consider:** keep the review rule "every `findMany` has `tenantId`" in PR reviews, and extend RLS
  to other personal-data tables (for example CATI call lists) when convenient.

### S10. Feature gating fails open for routes not in the map (Low–Medium) _(PR #41)_

- **Seen:** `featureForRoute()` in `apps/api/src/super-admin/features.ts` walks a list of path
  patterns (`RULES`) and returns `null`, meaning "not gated", for any path that matches none of them.
- **Why it matters:** a new API route that someone forgets to add is usable by every plan, even when
  the matching studio screen is hidden. This is a subscription leak, not a data leak: roles and
  project access still apply.
- **Suggested fix:** a test that lists every controller route (like the generator behind
  [API_DOCUMENTATION.md](API_DOCUMENTATION.md)) and fails when a route is neither in `RULES` nor on an
  explicit "always open" list.

### S11. Platform operator chosen automatically (Low) _(PR #38)_

- **Seen:** `IntegrationSettingsService.isOperator` (`apps/api/src/platform/integration-settings.service.ts`)
  marks the **oldest** organization as the operator when none is marked. Its administrators may then
  set every platform-wide key.
- **Why it matters:** on a new installation with `ALLOW_SIGNUP=true`, whoever signs up first becomes
  the operator.
- **Suggested fix:** run `node apps/api/dist/cli/set-operator.js <org>` as part of go-live, and keep
  `ALLOW_SIGNUP=false` in production (already recommended).

### S12. Vendor secret and the super admin (Info) _(PR #36 + #41)_

- **Seen:** after S1 the secret is returned only to role `ADMIN` (`SEES_VENDOR_SECRET` in
  `apps/api/src/vendors/vendors.controller.ts`). The super admin flag from PR #41 is not part of that
  check, and the super admin console does not show other organizations' vendors.
- **Why it matters:** the owner asked that "the super admin and admin both" can see it. Today a super
  admin sees it only in their own organization, and only when their role there is ADMIN.
- **Owner to decide:** whether super admins should see vendor secrets of every organization. That
  would be a code change (not made here, since this PR changes documentation only).

### S13. `'wasm-unsafe-eval'` in the runtime CSP (Info) _(PR #37)_

`infra/nginx/runtime-headers.conf` and the CloudFront policy in `infra/terraform/edge.tf` add
`'wasm-unsafe-eval'` so the eye-tracking model's WebAssembly can compile. It does not allow
JavaScript `eval()`. Accepted by design ([ADR 0034](../adr/0034-webcam-eye-tracking.md)).

## 3. Code quality observations

- **Consistent structure.** Each API module follows controller → service → Prisma with Zod at the
  edge; packages are pure TypeScript with their own tests. This makes the code easy to follow.
- **Large files.** Several controllers and services are long (for example
  `apps/api/src/interview/interview.service.ts`). Changes there need care; see the risky files table
  in [ARCHITECTURE.md](ARCHITECTURE.md).
- **Comments explain why.** Most decisions are commented with the milestone and ADR that introduced
  them, which helps when tracing behaviour back to a decision.
- **No studio unit tests** (only Playwright). See [DEPLOYMENT.md](DEPLOYMENT.md#1-testing).
- **Fifteen open stacked PRs.** Fixes on `main` have to be merged up through #27 → #41 → #40; conflicts
  grow the longer the stack stays open.
- **Two package managers.** `apps/mobile` uses npm with its own lockfile while the rest uses pnpm;
  `pnpm audit` does not cover the mobile app's dependencies (**Needs Verification**: run `npm audit`
  in `apps/mobile`).

## Documentation drift

Existing documents that did not match the code when the handbook was written. The first three and
the Terraform README were brought up to date on branch `security-fixes`.

| Document                                     | What is out of date                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` (root)                           | **Updated.** The product summary stopped at Milestone 13; it now covers M14–M20 and the open PRs.                                                  |
| `docs/architecture.md`                       | **Updated.** Title and content covered Milestones 1 to 13 only; now M1–M20, the open PRs and stale known limits.                                   |
| `docs/operations/go-live.md`                 | **Updated.** Step 1 said to merge PRs #1 to #19, which were merged on 2026-11-02; it now names the open stack.                                     |
| `docs/api/openapi.yaml`, `capi-openapi.yaml` | They describe only the vendor API (2 paths) and the CAPI sync (2 paths). The API has 283 routes; see [API_DOCUMENTATION.md](API_DOCUMENTATION.md). |
| `.env.example`                               | Missing several variables that have defaults; listed in [CONFIGURATION.md](CONFIGURATION.md#gaps-found).                                           |
| `infra/terraform/README.md`                  | **Updated.** Example secret JSON missed `TWILIO_AUTH_TOKEN` (S2).                                                                                  |
| `e2e/playwright.config.ts` comment           | Mentions `E2E_REUSE`, but the config always reuses running servers (**Needs Verification**).                                                       |
