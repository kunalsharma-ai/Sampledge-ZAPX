# ADR 0028: Neon AI theme, sidebar shell and data dashboard

Status: accepted (2026-11-04)

## Context

Kunal shared mockups of a neon, glass-style ZAPX dashboard: a left sidebar, an AI hero with a "Create survey"
call to action, KPI tiles, performance and outcome charts, a respondent funnel, device and country breakdowns,
capability tiles, recent projects, an AI Copilot panel, a live survey preview and a theme picker. The mockups
contain illustrative numbers and some features ZAPX does not have (templates library, eye tracking, webcam
recording, notifications). The studio home was a plain projects list.

## Decision

1. **A new Quantum preset, not a separate theme system.** "Neon AI" (deep indigo, violet, magenta, cyan) is
   added to `@zapx/quantum` and becomes the default (dark). The contrast engine still applies, so light mode
   and high contrast keep working, and every other preset works with the new layout.
2. **Sidebar app shell for every page.** `components/Shell.tsx` now has a sidebar (Dashboard, Projects, Calls,
   Appearance, Settings / API keys, Audit log by role), the plan and this month's completes from `/api/plan`, a
   top bar with search (Ctrl+K) and the theme menu. It collapses into a drawer below 1024px.
3. **Only real data and real features.** `GET /api/dashboard` returns counts computed from the organization's
   data, limited to the projects the member can see, with test responses left out and respondent rows read
   under row-level security. Every tile, Copilot action and capability links to a working screen (usually a
   tab of the latest survey via `/surveys/:id?tab=`). Features from the mockups that ZAPX does not have are
   left out. The robot and globe are decorative SVG.
4. **Charts are plain SVG.** No chart library: two-series area chart with a hover read-out, donut, funnel and
   share bars, coloured from a palette validated for colour-blind separation (`--viz-*` in `app/neon.css`).
5. **Projects list moves to `/projects`**; the dashboard keeps the latest projects and the "New project" form.

## Consequences

- People who never chose a theme see Neon AI dark; saved personal and organization appearances are unchanged.
- `GET /api/dashboard/search?q=` searches projects (name, client) and surveys by name.
- The dashboard summary is computed on each load; for very large organizations it may need caching later.
