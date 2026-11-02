# ZAPX Quantum Design System

Design architecture and modernization plan for the ZAPX studio (the staff application). It covers the
audit of what exists, the design system, the information architecture, and the phased plan. Phase 1
(audit) and the first part of Phase 2 (tokens, theme engine, core components) are implemented; every
later phase is a separate, independently testable pull request.

Principle: **extraordinary to experience, effortless to operate.** Visual effects never delay typing,
saving, validation or navigation, and every control is wired to real state.

## 1. Audit of the current application

### What exists and is preserved

| Area                 | Where                                       | Notes                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Studio (staff app)   | `apps/studio`, Next.js 15, React 19         | 8 routes, 20 components, one stylesheet (`app/globals.css`)                                                                                                                                                                                                              |
| Respondent runtime   | `apps/runtime` + `packages/survey-renderer` | Has its own survey-level theme system (Milestone 3). Not restyled by Quantum: respondents see the survey's theme, not the programmer's.                                                                                                                                  |
| CAPI interviewer app | `apps/capi` (Vite PWA)                      | Separate offline app; can adopt `@zapx/quantum` tokens later.                                                                                                                                                                                                            |
| API                  | `apps/api` NestJS modular monolith          | All business logic stays here; Quantum adds only appearance storage.                                                                                                                                                                                                     |
| Survey model         | `packages/survey-schema`                    | One canonical definition used by the visual editor and the JSON editor. This is the single model the Logic Studio will also use.                                                                                                                                         |
| Logic engine         | `packages/logic-engine`                     | Expressions, routing, `analyzeSurvey` (never-shown questions, constant conditions, unmatched quotas, unreachable terminations), `simulate` (random respondents), `diffSurveys`, `replay`. These power the planned Logic Risk Radar, Journey Simulator and version diffs. |
| Analysis             | `packages/analysis-core`                    | Frequencies, crosstabs with significance, weighting.                                                                                                                                                                                                                     |

Studio routes today: `/` (projects), `/projects/[id]`, `/surveys/[id]` (12 tabs: Build, JSON, AI & import,
Design, Languages, Preview, QA lab, Links & status, Interviewers, Quality & fieldwork, Quotas & data,
Analysis), `/calls` (CATI), `/settings`, `/settings/audit`, `/login`.

Survey-programming capability already in the product (to enhance, not rebuild): three-column visual editor
(outline, canvas, properties), JSON code view on the same model, AI architect with human-approved change
sets, questionnaire import, QA lab with simulated respondents, respondent themes and device rules,
translations with review, desktop/tablet/phone preview, quality review queue and fraud signals, CAPI and
CATI fieldwork, exports, analysis, webhooks, API keys, audit log, SSO/SCIM.

### Design issues found

1. **One fixed look.** Colours were 11 CSS variables with light/dark from the operating system only. No user
   or organization theming, density, contrast or motion settings.
2. **Flat hierarchy.** Every container is the same white panel with a 1px border; primary actions are a flat
   blue; headings are small. Pages read as a generic admin template.
3. **Navigation is a top bar plus a 12-tab strip** on the survey page. No global search, command palette,
   recent items or favourites; the survey page (698 lines) carries every workflow.
4. **No dashboard.** The home page is a project table; there is no overview of live, testing or blocked work.
5. **No icon system** and system fonts only.
6. **235 inline `style={{…}}` objects** across pages, which makes spacing inconsistent and density impossible
   to control. These are migrated page by page in later phases, not in one risky sweep.
7. **Accessibility basics are good** (labelled fields, `role="tab"`, focus outlines) and are kept; contrast was
   never verified programmatically.

### Constraints carried forward

No Tailwind or component library exists, and 17 end-to-end specs select by role, label, test id and a few
class names. Quantum therefore keeps the existing class names and markup, re-points the old CSS variables
at the new tokens, and adds new components alongside. No page logic, route or API was changed to restyle
the app.

## 2. Design system architecture

```
@zapx/quantum (packages/quantum)     pure TypeScript, no framework
  presets.ts    10 theme presets: key colours for a dark and a light scheme each
  appearance.ts Appearance settings type, defaults, tolerant sanitize + strict validate
  engine.ts     resolveTheme(appearance, environment) -> CSS variables + attributes,
                contrast correction, contrastReport()
  boot.ts       cache format + a 600-byte head script that paints the saved theme before hydration

apps/studio
  app/layout.tsx           server-renders the default theme's variables, runs the boot script,
                           wraps the app in ThemeProvider, loads Geist Sans/Mono (self-hosted)
  lib/theme/ThemeProvider  live theme state; follows OS dark mode and reduce-motion changes;
                           saves to the member's account (debounced); org default fallback
  app/globals.css          base styles on --q-* tokens; legacy aliases (--bg, --panel, --accent...)
  app/quantum.css          component styles
  components/quantum/      component library
  app/appearance/          personal appearance settings + live component preview

apps/api
  PreferencesController    GET/PUT /api/me/preferences, DELETE /api/me/preferences/appearance,
                           PUT/DELETE /api/tenant/appearance (admins; audited)
  User.preferences, Tenant.appearanceDefaults (JSONB, migration 20261110000000_quantum_appearance)
```

Resolution order for a member: their own saved appearance, else the organization default, else Quantum
Midnight on the system colour mode. Signed-out pages (login) use the device's cached theme.

### Tokens

All colour tokens are computed per theme, scheme and setting; layout tokens are fixed.

| Group     | Tokens                                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces  | `--q-bg`, `--q-surface`, `--q-surface-2`, `--q-surface-3`, `--q-glass`, `--q-glass-2`, `--q-glass-blur`                                                                          |
| Text      | `--q-text`, `--q-text-muted`                                                                                                                                                     |
| Lines     | `--q-border`, `--q-border-strong` (inputs, 3:1), `--q-focus` (3:1)                                                                                                               |
| Accent    | `--q-accent` (fills), `--q-accent-text` (links on surfaces), `--q-on-accent`, `--q-accent-soft`, `--q-accent-2`, `--q-accent-3`, `--q-gradient`, `--q-gradient-text`, `--q-glow` |
| Light     | `--q-mesh-1..3` (background light, fixed, never animated)                                                                                                                        |
| Status    | `--q-good`, `--q-warn`, `--q-bad`, `--q-info` and `-soft` backgrounds                                                                                                            |
| Elevation | `--q-shadow`, `--q-shadow-pop`                                                                                                                                                   |
| Density   | `--q-control-h`, `--q-pad-x`, `--q-pad-y`, `--q-cell-y`, `--q-gap`, `--q-panel-pad`                                                                                              |
| Motion    | `--q-dur-fast` 140ms, `--q-dur-base` 200ms, `--q-dur-slow` 320ms, `--q-move` (1 = movement allowed, 0 = fade only), `--q-ease`, `--q-ease-spring`                                |
| Type      | `--q-font` Geist Sans, `--mono` Geist Mono, `--q-text-xs..2xl` (11.5 / 12.5 / 14 / 16 / 20 / 26 px)                                                                              |
| Shape     | `--radius-sm` 8, `--radius` 12, `--radius-lg` 16                                                                                                                                 |

### Theme engine

Ten presets: Quantum Midnight, Aurora Intelligence, Obsidian Elite, Cyber Pulse, Arctic Glass, Royal
Amethyst, Solar Titanium, Oceanic Intelligence, Minimal Executive, Adaptive Dynamic (built from the
member's accent colour; neutrals are tinted with it). Every preset has both a dark and a light scheme, so
**Light / Dark / System** works with all of them.

Settings: preset, mode, custom accent (any preset), background light 0-100, glass 0-100 (0 = solid panels),
gradient 0-100, density (compact / comfortable / spacious), high contrast, animation (system / full /
subtle / off). Changes apply instantly with no reload; colours cross-fade over `--q-dur-slow`.

**Contrast is enforced, not hoped for.** The engine measures WCAG ratios and nudges any colour that would
fail (body and secondary text, links, status text 4.5:1; 7:1 in high contrast; button labels 4.5:1 against
both gradient ends; input borders and focus ring 3:1). A custom accent of pure yellow or white still yields
readable buttons and links. The unit tests check all 10 presets in six variants each plus extreme custom
accents, and the Appearance page shows the live contrast report.

High contrast turns off glass, blur and background light, uses pure text colours and strong borders.

Glass means translucent panels over the background light. Blur (`--q-glass-blur`) is applied only to the
sticky top bar and floating layers, never to every panel, because blurring every surface slows painting on
long pages.

### Motion specification

| Use                                                  | Duration   | Notes                                                                               |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| Hover, press, focus, toggles                         | 140 ms     | colour, border, 1px lift                                                            |
| Tabs indicator, segmented thumb, switch, field label | 200 ms     | transform only (GPU)                                                                |
| Theme cross-fade, meters, larger reveals             | 320 ms     |                                                                                     |
| KPI count-up                                         | 700 ms     | ease-out cubic, only at full motion, final value always available to screen readers |
| Page transitions (Phase 3)                           | 220-400 ms | via Motion for React, direction-aware                                               |

Rules: animate only `transform`, `opacity`, colours and `filter`; nothing in dense tables or editors
animates continuously; `--q-move: 0` (subtle) keeps fades and drops all slides, scales and pings; `off`
sets every duration to 0. The OS reduce-motion setting maps to subtle unless the member chooses otherwise.
The background light is static by design.

### Iconography and typography

Icons: `lucide-react` (1.5-2px strokes, 14-18px in UI, `aria-hidden` when decorative, always beside a text
label or with an accessible name). Type: Geist Sans for UI and Geist Mono for codes, expressions and
numbers in code-like contexts, both self-hosted through `next/font` (no external font requests). Headings
use slight negative tracking; tables use tabular numbers.

### Components (this PR)

`Button` (primary / secondary / ghost / danger, sizes, loading), `TextField` (floating label, hint,
announced error), `Switch`, `Checkbox` (native input, animated mark), `SegmentedControl` (radio group,
sliding thumb, arrow keys), `SelectionCards` (cards or compact list, radio group semantics), `Badge` (tones,
live pulse), `Surface` (glass / solid / raised, interactive lift), `KpiTile` (count-up, delta, drill-down
link), `ProgressMeter` (quota/plan thresholds), `Skeleton`, `Slider`, `ColorField`.

Existing screens adopt the new look through the token aliases and restyled base elements (top bar, panels,
buttons, inputs, tables, badges, tabs, meters). New components replace page markup progressively.

## 3. Information architecture (target)

Primary navigation (collapsible sidebar, Phase 3): Command Center, Survey Projects, Survey Builder, Logic
Studio, Script Editor, AI Copilot, Testing and QA, Live Surveys, Analytics, Templates, Team and
Collaboration, Integrations, Settings. Every item maps to an existing module first:

| Navigation item              | Built on                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| Command Center               | new dashboard over existing projects, surveys, response counts, QA and quality data |
| Survey Projects              | `/`, `/projects/[id]` (adds kanban, table, calendar, timeline views)                |
| Survey Builder               | survey page Build tab (VisualEditor), Preview, Design, Languages                    |
| Logic Studio                 | new node view over the same `SurveyDefinition`, with `analyzeSurvey` results        |
| Script Editor                | JSON tab upgraded to Monaco; expression language from `logic-engine`                |
| AI Copilot                   | AI & import tab (architect, change sets) as a side panel available everywhere       |
| Testing and QA               | QA lab tab + `simulate` + `replay`                                                  |
| Live Surveys                 | Links & status, Quotas & data, Quality & fieldwork tabs                             |
| Analytics                    | Analysis tab                                                                        |
| Team, Integrations, Settings | `/settings` sections (team, access, SSO/SCIM, vendors, webhooks, API keys, audit)   |

Workspace modes (Phase 3 preference, adapts navigation and density): Visual Creator, Professional
Programmer (compact, keyboard-first), QA Tester, Project Manager, Client Review.

## 4. Implementation milestones

Each is its own pull request, verified with `pnpm check`, with screenshots.

| Phase                                              | Scope                                                                                                                                                                                                                                                                        | Builds on |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **Q1 Audit** (done)                                | This document                                                                                                                                                                                                                                                                |           |
| **Q2a Tokens, themes, first components** (this PR) | `@zapx/quantum`, theme engine, appearance API and storage, 13 components, Appearance page, app-wide restyle via tokens                                                                                                                                                       |           |
| Q2b Component library completion                   | Select/combobox, searchable multiselect, tag input, date/time picker, tooltip, popover, dialog with confirm patterns, toast, tabs component, data table with virtualization and column chooser, file drop zone, empty states; Radix primitives for behaviour; Storybook docs | Q2a       |
| Q3 Application shell                               | Sidebar navigation, breadcrumbs, global search, command palette (Cmd/Ctrl-K), recent and favourite items, workspace modes, keyboard shortcuts, route transitions (Motion for React), mobile navigation; migrate inline styles on shell pages                                 | Q2b       |
| Q4 AI Command Center                               | Home dashboard: KPIs with drill-down (real counts only), my work, readiness, deadlines, AI findings from `analyzeSurvey`/QA with severity and suggested action                                                                                                               | Q3        |
| Q5 Survey Programming Studio                       | Resizable, collapsible three-panel builder, inline titles, drag handles, autosave status, undo/redo, question bank and templates, focus mode, device preview frames                                                                                                          | Q3        |
| Q6 Logic and Script Studio                         | React Flow logic graph on the same survey model (minimap, auto-layout, error and branch highlighting, unreachable/circular detection), Monaco script view with diagnostics and autocomplete from the expression grammar                                                      | Q5        |
| Q7 AI Copilot                                      | Side panel and command-palette actions over the existing AI gateway; every change previewed as a diff and approved (existing change sets)                                                                                                                                    | Q3, Q6    |
| Q8 Testing and Live Operations                     | QA command center (coverage, untested paths, history, click-through to question), Journey Simulator, Launch Control (soft launch, pause/resume with confirmation, live quotas and alerts)                                                                                    | Q5        |
| Q9 Analytics and visualizations                    | ECharts dashboards (funnels, dropout, quota heatmaps, trends) with table alternatives; Survey DNA and Logic Risk Radar; 3D only where it adds analytical value, always with a 2D alternative                                                                                 | Q8        |
| Q10 Hardening                                      | Axe accessibility checks in e2e, performance budgets (route JS, interaction latency), visual regression screenshots, responsive validation, docs                                                                                                                             | all       |

## 5. How to test this phase

- `pnpm --filter @zapx/quantum test`: theme engine, contrast for every preset and variant, settings validation.
- `apps/api/test/quantum.test.ts`: saving, validation errors, admin-only organization default, tenant isolation, reset.
- Studio: open **Appearance** in the top bar. Switch presets, modes, density, motion, sliders, high contrast;
  the whole app changes without a reload. Reload or sign in on another browser: your choice follows you.
  As an admin, _Make this the organization default_, then sign in as a member who has not chosen a theme.
- Every existing page and end-to-end spec works unchanged.

## 6. Known limitations of this phase

- Inline styles in existing pages still set some spacing directly, so density changes affect controls,
  tables and panels but not every gap yet (migrated per page in Q3-Q5).
- Motion for React, GSAP, Radix, React Flow, Monaco and ECharts are not added yet; each arrives with the
  phase that needs it, so no library ships without a use.
- The CAPI app and respondent runtime keep their own styles.
- Organization default is a full appearance (preset and settings); locking members to it is not offered.
