# 0026: Security hardening

Status: Accepted (Milestone 20, 2026-11-02)

## Context

A review of the whole application before go-live (authentication, sessions, roles and tenant
isolation, API keys, webhooks, uploads, outbound requests, headers, dependencies, AWS) found the
design sound: parameterised queries only, tenant checks on every lookup, hashed API keys and
SCIM tokens, sealed partner secrets, signed webhooks, CSRF header on cookie requests, file types
sniffed from bytes. It also found gaps that an attacker could use:

1. **SSRF bypass.** The private-address check recognised `::ffff:10.0.0.1` but not the same
   address in hex (`::ffff:a00:1`), and the URL parser always writes it in hex: a callback or
   webhook address of `http://[::ffff:169.254.169.254]/` passed the check. NAT64, 6to4 and
   Teredo addresses that embed a private IPv4 address passed too.
2. **DNS rebinding.** The host name was resolved and checked, then `fetch` resolved it again to
   connect. A name that answers a public address first and `127.0.0.1` second got through.
3. **Open redirect after SSO.** `next=/\t/evil.example` passed the "relative path" check; browsers
   drop tabs and newlines from addresses, which makes it `//evil.example`.
4. **No account lockout.** Sign-in was rate-limited per address only, so guessing spread across
   many addresses was unlimited.
5. **Sign-out was only in the browser.** The session token stayed valid for 12 hours after
   sign-out, so a copied cookie or token kept working. There was no "sign out everywhere".
6. **Session algorithm not pinned.** Verification accepted whatever HMAC algorithm a token named.
7. **Production foot-guns.** The API started in production with `COOKIE_SECURE=false` or with the
   example `JWT_SECRET`.
8. **Headers.** API responses had no content security policy or frame protection; the studio had
   no CSP; nginx dropped its security headers on the app pages (an `add_header` inside a
   `location` discards the server-level ones); CloudFront sent no CSP.
9. **Dependencies.** zod 3 carried a high-severity advisory (accepted until now); `uuid` inside
   exceljs a moderate one.
10. **Secrets in git.** Private repositories on GitHub's free plan have no secret scanning and no
    push protection, and there is no CI to catch a committed key.

## Decision

- One network guard (`apps/api/src/common/net-guard.ts`) for every request to an address a
  customer typed (callbacks, webhooks, OIDC discovery and token exchange). It understands every
  IPv6 form that embeds IPv4, and checks the address inside the socket's `lookup`, so the address
  checked is the address connected to. Uses `undici` (Node's own fetch implementation) for the
  custom connector.
- `safeNext` refuses control characters, spaces and backslashes and must parse to this origin.
- Account lockout: `LOGIN_MAX_FAILURES` (10) wrong passwords in a row lock the account for
  `LOGIN_LOCK_MINUTES` (15); while locked every password is refused with 429 `ACCOUNT_LOCKED`.
  Unknown emails never lock (nothing to lock) and keep the ordinary answer. A lock is audited.
- Sessions carry a `jti`. Sign-out stores it in `RevokedSession` until the token would have
  expired; the guard refuses it. `POST /api/auth/logout-all` sets `User.sessionsRevokedAt`, which
  ends every session issued before it. Tokens must be HS256.
- Common and patterned passwords are refused when accounts are created.
- Production start-up refuses `COOKIE_SECURE=false`, example secrets, and `SECRETS_KEY` equal to
  `JWT_SECRET`.
- Headers: the API sends `default-src 'none'` CSP, `X-Frame-Options: DENY`, CORP same-origin
  (media keeps cross-origin), COOP, Permissions-Policy and HSTS over https. The studio, runtime
  and CAPI app send CSPs (the studio's is limited because Next.js needs inline scripts). nginx
  includes one headers file in every location; CloudFront uses a response headers policy per app
  with the same CSP. The runtime can still be framed by customers; the CAPI app and studio cannot.
- WAF: a sign-in rate rule (100 requests per 5 minutes per address to `/api/auth/` by default)
  on both web ACLs, and the AWS SQL injection rule group.
- zod 4 (with `.prefault` where v3's `.default` parsed the default), `uuid` 11 override.
- Secrets in git: `scripts/secret-scan.mjs` runs in `pnpm check` and in pre-commit and pre-push
  hooks that `pnpm install` turns on (`core.hooksPath=.githooks`). `.gitignore` covers env files,
  keys and Terraform state. The full history was scanned when this landed: nothing found.

## Consequences

- One more indexed lookup per session request (`RevokedSession` by primary key).
- Sign-out on one device does not sign out others; "sign out everywhere" does.
- A locked account can be used again after the lock ends; there is no admin unlock button yet
  (an admin can clear `lockedUntil` in the database).
- The minimatch advisory inside exceljs remains (moderate; patterns are ZAPX's own, never user
  input; the fixed versions changed their API). It is listed in `pnpm-workspace.yaml`.
- The scanner is local: someone who skips the hooks (`--no-verify`) and `pnpm check` can still push
  a secret. GitHub's own secret scanning becomes available if the repository is made public or the
  plan includes GitHub Secret Protection; see `docs/operations/github-security.md`.
