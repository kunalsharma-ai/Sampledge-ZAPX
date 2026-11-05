# 0037: The ZAPX mobile app (Android and iOS)

Status: Accepted (2026-11-05)

## Context

The owner asked for Android and iOS apps with the CRM's features, where the super admin decides per
subscription which features each organization and member gets on mobile, and where switching a feature
on or off takes effect at once, on the web and in the app. The super admin work (ADR on the
`super-admin` branch) supplies the entitlements API; this record covers the app.

## Decision

1. **Expo (React Native, SDK 58) with Expo Router** in `apps/mobile`, TypeScript strict. One codebase
   builds the Android and iOS apps (EAS Build) and a web preview used for screenshots and checks.
   It is its own npm project, outside the pnpm workspace, because Metro and EAS work best with a flat
   `node_modules`; `pnpm check` runs its type check and tests.
2. **API client, not a second backend.** The app calls the same `/api` as the studio with the session
   token as a Bearer token kept in the Keychain/Keystore (`expo-secure-store`), and sends
   `X-ZAPX-Client: mobile` so the server applies the mobile feature set.
3. **Live feature gating.** `GET /api/me/entitlements?surface=mobile` decides every tab, menu entry,
   survey section and button. Changes arrive over `GET /api/me/entitlements/stream` (SSE) at once,
   with an ETag poll (15 s, 60 s while the stream is up), a refresh on returning to the foreground,
   and a refresh on any `403 FEATURE_DISABLED / ORG_SUSPENDED / MOBILE_DISABLED`. Unknown keys are
   off. The server refuses gated routes anyway, so a modified app gains nothing.
4. **Neon AI design** from the CRM's default Quantum preset (`neon-ai`), dark and light.
5. **CAPI stays one engine.** Face-to-face interviewing hosts the existing offline CAPI web app in a
   WebView (camera, microphone and location allowed) instead of a second, native interview engine.
   CATI opens each interview in the in-app browser and records outcomes natively.
6. **Mobile-sized scope per feature.** Structural survey programming (logic, loops, the code
   workspace), file imports, vendor set-up, SSO/SCIM, API keys, webhooks and governance stay on the
   web; the app reads them where useful and offers wording edits, AI change sets, QA runs, launch
   control, live quota targets, review decisions, invitations, calling, automation recipes and team
   management. Web-only features are never on for mobile in the catalog.
7. **Server additions:** `GET /api/mobile/version` (public: identifies a ZAPX server and the minimum app
   version, `MOBILE_MIN_VERSION`), `GET /api/mobile/config` (CAPI and runtime addresses), and the new
   token in the `change-password` answer for Bearer clients.

## Consequences

- Store releases need the owner's Apple Developer and Google Play accounts and an Expo account
  (docs/operations/mobile-release.md). Nothing has been built on a real device in this environment:
  the Android/iOS JavaScript bundles compile, the native projects generate, and the web build was
  driven end to end against a local server.
- Single sign-on is not available in the app yet (it needs a deep-link return from the identity
  provider); SSO organizations use the web.
- Push notifications are not built; the in-app inbox and live updates cover alerts while the app is open.
