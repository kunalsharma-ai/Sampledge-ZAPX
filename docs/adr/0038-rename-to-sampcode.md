# 0038: ZAPX is renamed SampCode

Status: Accepted (2026-11-06)

## Context

The owner renamed the product from ZAPX to **SampCode** ("Write. Run. Ship.", "by Sampledge") and supplied a new
icon and a light and a dark logo (SVG and PNG). Everything people see must carry the new name and artwork: the
studio (CRM), the interviewer (CAPI) app, the mobile app's name and icon, emails, exports and the user-facing docs.
The old name is also built into identifiers that installations, partners and stored data depend on.

## Decision

1. **Every user-visible use of the name says SampCode:** page titles, the sidebar and sign-in branding, error and
   email texts (password reset, automation and subscription emails, default sender name `SampCode surveys`),
   export workbook creator, AI prompts, the mobile app's display name and permission texts, the CAPI web app
   manifest, and the current docs (README, handbook, module and operations guides, OpenAPI titles).
2. **Brand artwork lives in `docs/brand/`** (originals) and is copied where each app serves it: studio
   `public/brand/` with `components/neon/Brand.tsx`, favicon `app/icon.svg` and `app/apple-icon.png`; CAPI
   `public/icon*.{svg,png}`; mobile `assets/images/`. The sidebar uses the still icon and a text wordmark that
   follows the theme; the sign-in page shows the animated logo in the light or dark version for the scheme.
3. **Identifiers keep `zapx`.** Package names, database names, environment variables, HTTP headers, User-Agents,
   key and token prefixes, the SAMPLEON source platform value, storage and cache keys, the server identity checked
   by the mobile app, the mobile bundle id `com.sampledge.zapx`, Expo slug and URL scheme. The full list is in
   `docs/brand/README.md`. Voice commands accept both "Hey SampCode" and the old "Hey ZAPX".
4. **History is not rewritten.** ADRs 0001 to 0037 and past changelog entries keep the name they were written with.

## Consequences

- No migration, configuration change or partner change is needed to deploy the rename.
- The CAPI service worker cache is bumped (`zapx-capi-v2`) so installed interviewer apps pick up the new icons.
- Store listings need the new name and icon when the mobile app is first published; the bundle id stays, which
  keeps the option of renaming it before the first store release (it cannot change after).
- Renaming identifiers later is possible but needs care: headers and the SAMPLEON value are partner contracts,
  key prefixes appear in customers' secrets, and storage keys would sign people out of the mobile app.
