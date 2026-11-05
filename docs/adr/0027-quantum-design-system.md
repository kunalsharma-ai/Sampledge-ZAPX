# ADR 0027: Quantum Design System and theme engine

Status: accepted (2026-11-02)

## Context

The studio had a single look defined by 11 CSS variables, no component library, no icons and 235 inline
style objects. The product brief asks for a premium, themeable, accessible interface (ten presets, light /
dark / system, density, contrast, motion, personal and organization defaults) without breaking any working
feature, and for a unified design system rather than per-page redesigns.

## Decision

1. **Tokens computed by a pure package.** `@zapx/quantum` turns appearance settings into CSS custom
   properties. It has no framework dependency, so the studio, the API (validation) and later the CAPI app
   share it, and it is unit-tested.
2. **Contrast is enforced by the engine.** Colours that would miss WCAG 2.2 AA (AAA-level 7:1 in high
   contrast) are moved towards black or white until they pass. Custom accents are therefore safe.
3. **CSS custom properties, not a CSS framework.** The studio already uses plain CSS with variables; we keep
   that, alias the old variable names to the new tokens and restyle base elements. Every page re-themes
   with no markup change and the end-to-end specs keep working. Tailwind is not introduced: it would
   duplicate the token system and force a rewrite of every page.
4. **No flash, no dependency on scripts.** The layout server-renders the default theme; a tiny head script
   applies the cached personal theme before paint; `ThemeProvider` then syncs with the account.
5. **Storage.** `User.preferences.appearance` (follows the member across devices) and
   `Tenant.appearanceDefaults` (admins, audited). Both are JSONB validated by `validateAppearance`.
6. **Libraries arrive with their use.** Geist fonts (self-hosted) and Lucide icons now; Radix, Motion for
   React, React Flow, Monaco and ECharts in the phases that need them (docs/design/quantum-design-system.md).
7. **The respondent experience is out of scope.** Respondents see the survey's own theme (Milestone 3);
   programmer preferences never change what respondents see, including inside the studio's preview.

## Consequences

- Any new screen uses `--q-*` tokens and `components/quantum`; the legacy aliases stay until all pages are
  migrated.
- Theme presets are data: adding one means adding key colours and letting the tests prove contrast.
