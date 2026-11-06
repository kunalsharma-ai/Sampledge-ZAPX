# SampCode mobile app (Android and iOS)

Expo (React Native) app with the CRM's features in the Neon AI design. Every screen is gated by the
features the super admin gives the member's organization and the member on mobile, and changes show
up live (see docs/adr/0037-mobile-app.md).

## Run it

```bash
cd apps/mobile
npm ci
npm start            # Expo dev server: scan the QR code with Expo Go, or press w for the web preview
npm run typecheck
npm test
```

Sign in with the address of a SampCode server (the studio address, e.g. `https://zapx.example.com`; on a
local network `http://192.168.x.x:3000` also works), and an email and password. Single sign-on
organizations use the web for now.

To preview against a local API: `npx expo export --platform web --output-dir dist`, then serve `dist`
with `/api` proxied to the API (port 4000).

## Layout

- `src/app/` screens (Expo Router): `(tabs)/` Home, Projects, Fieldwork, Inbox, More; `survey/[id]`
  with sections in `src/screens/survey/`; calling, CAPI, automation, team, library, audit, account.
- `src/lib/entitlements.ts` live feature store (stream + ETag poll), `entitlements-context.tsx` hooks,
  `components/gate.tsx` the `<Gate>` / `<IfFeature>` wrappers.
- `src/lib/features.ts` feature keys; a test checks they match the server catalog.
- `src/lib/api.ts` API client (Bearer token, `X-ZAPX-Client: mobile`).

## Release

Builds and store submission run on EAS: docs/operations/mobile-release.md.
