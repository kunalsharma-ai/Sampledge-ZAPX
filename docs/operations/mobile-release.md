# Releasing the ZAPX mobile app

The app is built and signed in the cloud with Expo Application Services (EAS); no Mac or Android
Studio is needed. These steps need accounts only the owner can create.

## What you need (one time)

| Account                 | Cost                         | Why                                              |
| ----------------------- | ---------------------------- | ------------------------------------------------ |
| Expo account (expo.dev) | Free tier is enough to start | Runs the Android and iOS builds and submits them |
| Google Play Console     | USD 25 once                  | Publishing on Google Play                        |
| Apple Developer Program | USD 99 a year                | Publishing on the App Store and TestFlight       |

Also decide: the app name on the stores (now "ZAPX"), the bundle id `com.sampledge.zapx` (change in
`apps/mobile/app.json` before the first upload; it cannot change afterwards), a privacy policy URL,
a support URL and a support email. Store listings also need screenshots (the ones in
`/mnt/project-files/zapx/mobile/` can be used as a start) and a short description.

## First build

```bash
cd apps/mobile
npm ci
npx eas-cli@latest login
npx eas-cli@latest init                 # links the app to your Expo project (writes the project id)
npx eas-cli@latest build --profile preview --platform android   # an .apk you can install directly
npx eas-cli@latest build --profile production --platform all    # store builds (.aab and .ipa)
```

EAS asks to create the Android upload key and the iOS certificates and profiles; let it manage them.

To ship a default server address with the app, set `expo.extra.zapxServer` in `app.json`
(for example `https://zapx.sampledge.com`); people can still change it on the sign-in screen.

## Submitting

- **Google Play:** create the app in Play Console, upload the first `.aab` by hand once, then
  `npx eas-cli@latest submit --platform android` (needs a Google service account key; EAS links the
  steps). The `production` submit profile sends to the internal testing track as a draft.
- **App Store:** create the app in App Store Connect with the bundle id, then
  `npx eas-cli@latest submit --platform ios`. It goes to TestFlight first; submit for review from
  App Store Connect.

Review notes for both stores: give the reviewers a demo login on a reachable ZAPX server, and
explain that camera, microphone and location are used only in face-to-face interviews with consent.

## Updates

- JavaScript-only changes: `npx eas-cli@latest update --channel production` (over the air, no review).
- Native changes (new native module, permissions, SDK upgrade): a new store build.
- To force old apps to update, set `MOBILE_MIN_VERSION` on the API (e.g. `1.1.0`); older apps then
  refuse to sign in and ask the member to update.

## Server side

Nothing extra to deploy: the app talks to the same `/api` through the studio address. The super admin
controls who may use the app and which features it shows (Super admin console: plans, organizations,
members). CAPI interviewing in the app opens `CAPI_APP_URL`, which must be reachable from phones.
