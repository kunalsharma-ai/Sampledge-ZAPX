# SampCode brand assets

SampCode (formerly ZAPX) is Sampledge's survey programming platform. Tagline: **Write. Run. Ship.**
Brand line: **by Sampledge**.

| File                               | Use                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `sampcode-logo-light.svg` / `.png` | Full logo (icon, wordmark, tagline, "by Sampledge") on light backgrounds. Animated SVG; honours reduced motion.                  |
| `sampcode-logo-dark.svg` / `.png`  | The same for dark backgrounds.                                                                                                   |
| `sampcode-icon.svg`                | Animated icon (marketing, hero areas).                                                                                           |
| `sampcode-icon-static.svg`         | Still icon: favicons, the app sidebar, anywhere it must not move. Made from `sampcode-icon.svg` by removing its `<style>` block. |
| `sampcode-icon-512.png`            | Raster icon, transparent background.                                                                                             |

The PNG logos are 1416×384 (6× the SVG size).

## Where the assets are used

- **Studio (CRM web app):** `apps/studio/public/brand/` (served at `/brand/...`), favicon `apps/studio/app/icon.svg`,
  home-screen icon `apps/studio/app/apple-icon.png`. Components: `components/neon/Brand.tsx`
  (`BrandMark`, `BrandWordmark`, `BrandLogo`). The sidebar uses the still mark and a text wordmark ("Samp" in the
  theme's text colour, "Code" in the brand gradient); the sign-in page shows the animated full logo, light or dark
  to match the colour scheme.
- **Interviewer app (CAPI):** `apps/capi/public/icon.svg`, `icon-192.png`, `icon-512.png` (PWA manifest).
- **Mobile app:** `apps/mobile/assets/images/` (`icon.png` 1024, Android adaptive foreground/background/monochrome,
  `splash-icon.png`, `favicon.png`). The display name is set in `apps/mobile/app.json` (`expo.name`).

## Brand colours

| Token                               | Hex       |
| ----------------------------------- | --------- |
| Cyan                                | `#22D3EE` |
| Indigo                              | `#6366F1` |
| Violet                              | `#A855F7` |
| Slate (the "Samp" in light artwork) | `#64748B` |
| App icon background                 | `#090620` |

"Code" in the wordmark uses a cyan → indigo → violet gradient.

## Regenerating the PNG app icons

The mobile and CAPI PNGs were rendered from `sampcode-icon-static.svg` with Chromium (Playwright): icon 1024 on
`#090620` at full size, Android foreground and monochrome at 78% on transparent (inside the adaptive-icon safe zone),
splash 512 on transparent, CAPI 192 and 512 on `#090620`. Any SVG renderer that supports filters gives the same result.

## Names that were not changed

These still say `zapx` because changing them would break existing data, installs or partner integrations. They are
not shown to end users. Rename them only with a migration plan:

- npm workspace packages `@zapx/*` and the root package name
- database, user and schema names in `.env.example`, Docker Compose and Terraform; Terraform resource names and
  the `zapx-*` image and repository names
- environment variables `ZAPX_API_URL`, `ZAPX_RUNTIME_URL`, `ZAPX_EMAIL`, `ZAPX_PASSWORD`
- HTTP headers `X-Zapx-Signature`, `X-Zapx-Timestamp`, `X-Zapx-Event`, `X-Zapx-Delivery`, `X-Zapx-Truncated`,
  `X-ZAPX-Client`, `x-zapx-csrf`; User-Agents `ZAPX-Callbacks/1`, `ZAPX-Webhooks/1`
- API key and SCIM token prefixes `zapx_` and `zapx_scim_`; the `vid=ZAPX_EMAIL` invitation source
- the SAMPLEON source platform value `ZAPX` (shared contract with SAMPLEON)
- the mobile bundle id / package `com.sampledge.zapx`, the Expo slug and URL scheme `zapx`, the `zapxServer`
  setting and secure-store keys
- the server identity `service: "zapx"` the mobile app checks, browser storage and cache names (`zapx-capi-*`,
  `zapx.*` keys), the `zapx` theme preset key, the `toZapxXml` / `fromZapxXml` function names
- the GitHub repository name `Sampledge-ZAPX`
- historical documents: ADRs 0001 to 0037 and old changelog entries keep the name they were written with.
