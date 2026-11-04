# ZAPX blueprint: audit, parity matrix and phased gap plan

Status date: 2026-11-04 · Source: Kunal's "SAMPLEDGE ZAPX — Ultimate AI-Powered Survey Programming,
Fieldwork & Research Intelligence Platform" blueprint (24 modules) · Base: branch `neon-ai-dashboard`
(PR #29, on top of PR #27).

This document is the maintained checklist the blueprint asks for. It records what ZAPX does **today**
(tested in this repository), what each phase adds, and what cannot honestly be built from this
repository. Nothing here is marked "built" unless there is working code and an automated test for it.

## 1. Audit summary

ZAPX is not a mock-up. Milestones M1 to M20 shipped a working platform on one canonical survey
schema (`packages/survey-schema`) and one logic engine (`packages/logic-engine`) used by the server,
the studio preview, the respondent runtime, the QA lab and the offline CAPI app. That is exactly
the "one underlying survey engine" the blueprint calls the most important decision, so the plan
keeps it and extends it. Nothing is rewritten for the sake of it.

Strong today: schema and logic engine, versioning and publish, quotas, redirects and vendors, AI
change sets (AI proposes, people approve), file import, QA simulation, translation overlay with
human review, themes, CAPI offline web app with GPS and consented audio, data quality and fraud
scoring with a review queue, CATI with Twilio dialer, analysis with crosstabs, significance and rim
weighting, exports, SSO (OIDC + SAML), SCIM, API keys, webhooks, audit log, row-level security,
Neon/Quantum design system with 11 theme presets.

Phase 1 (this branch, `blueprint-p1-core`) closed most of the core engineering gaps; the module
matrix below shows the current status.

Biggest gaps before Phase 1: loops, randomized blocks, calculated (hidden) variables, dynamic
answer lists, MaxDiff and conjoint, card sort, heatmap/image hot-spots, a professional code
workspace (XML, debugger, version diff), a question bank and templates, voice commands, translation
memory/glossary/RTL, distribution scheduling and reminders, an automation engine, field supervisor
dashboards, eye tracking, an AI research assistant, and a Theme Studio with 16 families and
per-module overrides.

## 2. Status legend

| Status           | Meaning                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **Built**        | Working code with automated tests in this repo.                                              |
| **Partial**      | Some of the capability works; the gap is named.                                              |
| **Planned (Pn)** | Not built; scheduled in phase n below.                                                       |
| **Adapter**      | Built behind a provider adapter; tested against a local stand-in, needs Kunal's account/key. |
| **Out of reach** | Cannot be built or verified from this repository; the reason is given.                       |

## 3. Module matrix (the 24 blueprint modules)

| #   | Module                     | Today                                                                                                                                                                                                                                                                                                                                          | Status                       | Gap to close                                                                                                                                       | Phase |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | AI Survey Creation         | Prompt-to-survey and document import as reviewable change sets (M2); voice commands in the survey header (P2): navigation and save run directly, any other words go to the AI architect as an instruction for a reviewable change set.                                                                                                         | Partial · Adapter (Claude)   | AI suggestions panel, quota suggestions. Voice uses the browser's speech recognition (Chrome/Edge/Safari); not offered where the browser has none. | P4    |
| 2   | Visual No-Code Builder     | Form editor, live preview, JSON tab; drag-and-drop outline (pages and questions, across pages); question bank (save, search, insert with a fresh variable name); 6 tested survey templates; organization templates from saved surveys (P1).                                                                                                    | Built (core)                 | Reusable multi-question blocks in the bank.                                                                                                        | P2    |
| 3   | Professional Programmer    | Programmer tab (P1): ZAPX XML editor (CodeMirror: highlighting, autocomplete, lint by line, search, folding), XML ↔ schema round-trip with unknown-construct warnings, expression debugger and variable inspector, route explainer, dependency explorer, version list and structured diff, Decipher-style XML migration with a warnings list. | Built (core)                 | Python/JS custom code: see §5.                                                                                                                     | —     |
| 4   | Advanced Question Library  | Previous types plus card sort (drag and drop with an accessible per-card select) and image hot-spot (coded regions drawn on the image) (P1).                                                                                                                                                                                                   | Partial                      | MaxDiff, conjoint (CBC), text highlighter. Hot-spot stores region codes, not raw click coordinates.                                                | P4    |
| 5   | Logic & Routing            | Loops, randomized page blocks (random order, pick N, seeded per respondent; least-fill balancing counted by the server, P2), calculated variables, URL variables from the survey link (P2), dynamic answer lists.                                                                                                                              | Built (core)                 | Least-fill falls back to random in offline CAPI interviews.                                                                                        | —     |
| 6   | Quota Management           | Expression quotas with live counts; live target change and reset without republishing (audited, API-tested); quota table builder that writes one quota per cell (P1).                                                                                                                                                                          | Partial                      | Quota table builder has no automated test yet; least-fill quota balancing (choosing which quota cell a respondent qualifies for).                  | P4    |
| 7   | Survey Design Studio       | Respondent themes, fonts, motion, logo, density, progress (M3).                                                                                                                                                                                                                                                                                | Partial                      | Premium respondent templates.                                                                                                                      | P2    |
| 8   | Multilingual Overlay       | Overlay with human review and outdated detection; side-by-side editor; translation memory reusing approved translations across the organization's surveys; organization glossary sent with AI translation and checked; per-language QA (blockers, glossary, length, unchanged text); right-to-left rendering and locale number formats (P2).   | Built (core)                 | Locale date formats (no date question type yet).                                                                                                   | —     |
| 9   | F2F / CAPI Fieldwork       | Offline PWA, assignments, IndexedDB, resumable interviews, GPS start/end, consented audio, photo, server replay. P3: interview areas (geofences checked on the device and again on the server), page timestamps, interruption log with a pause button, signature and barcode/QR questions.                                                     | Partial                      | Consented video capture. Barcode scanning uses the browser's BarcodeDetector (Chrome on Android and others); elsewhere the code is typed.          | P4    |
| 10  | CATI & CAWI                | CAWI runtime; CATI call lists, dispositions, calling hours, DNC, Twilio click-to-call (M9, M18, M19).                                                                                                                                                                                                                                          | Built · Adapter (Twilio)     | —                                                                                                                                                  | —     |
| 11  | Respondent Security        | Speeders, straightlining, open-end gibberish/dupes, same network/device, bot/honeypot, paste, IPinfo VPN, block list, explainable score, review queue. P3: outside-area and interruption flags for CAPI, back-checks, appeals with reinstatement.                                                                                              | Built · Adapter (IPinfo)     | —                                                                                                                                                  | —     |
| 12  | Eye Tracking               | None.                                                                                                                                                                                                                                                                                                                                          | Planned (P4) · see §5        | Webcam gaze estimation (labelled approximate), calibration, AOIs, heatmaps, consent, retention.                                                    | P4    |
| 13  | Voice & Video Intelligence | Consented audio capture, Twilio call recording, Deepgram transcription (M17).                                                                                                                                                                                                                                                                  | Partial · Adapter (Deepgram) | Video capture with consent, translated transcripts, subtitles.                                                                                     | P3    |
| 14  | AI Quality Assurance       | Synthetic respondents, coverage, defects, background runs; saved test cases (answers plus expected route, ending, variables and quotas) run as a regression suite (P2).                                                                                                                                                                        | Partial                      | AI-generated test cases, device matrix preview, accessibility checks.                                                                              | P4    |
| 15  | Field Team Management      | Interviewer role, assignments with targets, CAPI sync. P3: supervisor dashboard (completes vs target, per-interviewer productivity, median length, quality, exceptions, interruptions, back-check results), map of interview start points and areas, daily completes.                                                                          | Partial                      | The map plots positions to scale without map tiles (no map provider is called); daily targets per interviewer.                                     | P5    |
| 16  | Sampling & Distribution    | Vendor links with signatures, vendor API. P3: contacts per survey (CSV), scheduled email waves with personal links, reminders only to people who have not finished, one-click unsubscribe, personal links download.                                                                                                                            | Built · Adapter (SendGrid)   | SMS invitations. Email is sent through SendGrid only when EMAIL_PROVIDER=sendgrid; tested against a local stand-in, not the live service.          | P5    |
| 17  | Redirect Management        | 8 statuses (complete, terminate, quota-full, quality-fail, security-reject, duplicate, partial, technical error), signed S2S, callbacks, PROJEXA adapter.                                                                                                                                                                                      | Built · Adapter (PROJEXA)    | PROJEXA live verification needs a deployed PROJEXA.                                                                                                | P5    |
| 18  | Data Processing            | Exports (CSV/XLSX with value labels), rim weighting, quality cleaning.                                                                                                                                                                                                                                                                         | Partial                      | Recodes, derived variables in data, cleaning rules with lineage.                                                                                   | P4    |
| 19  | Analytics & Crosstabs      | Frequencies, crosstabs, significance letters, weighted tables, saved reports, Excel.                                                                                                                                                                                                                                                           | Built (core)                 | Segmentation filters, dashboards with charts.                                                                                                      | P4    |
| 20  | AI Research Assistant      | None.                                                                                                                                                                                                                                                                                                                                          | Planned (P4) · Adapter       | Ask questions of tabulated results; summaries grounded in computed tables.                                                                         | P4    |
| 21  | Automation Engine          | Background jobs, webhooks.                                                                                                                                                                                                                                                                                                                     | Partial                      | Rules (trigger → condition → action), schedules, approvals, in-app notifications.                                                                  | P5    |
| 22  | Integrations & APIs        | REST API + keys, webhooks, PROJEXA adapter, vendor API. CRM-managed provider keys (PR #28).                                                                                                                                                                                                                                                    | Partial                      | SAMPLEON and Bidzo adapters (contracts needed from Kunal).                                                                                         | P5    |
| 23  | Enterprise Administration  | RBAC, project access, OIDC/SAML SSO, SCIM, audit log, RLS, plans/billing, AWS Terraform.                                                                                                                                                                                                                                                       | Built · Adapter              | Data residency setting, retention policies.                                                                                                        | P5    |
| 24  | Global Theme Studio        | 16 Quantum theme families (Neon AI default, plus Holographic Glass, Forest Intelligence, Sunset Fusion, Obsidian Gold, Crimson Carbon in P2), light/dark, custom accent, density, motion, contrast enforcement tested for every family.                                                                                                        | Partial                      | Per-module theme overrides and saved workspace presets.                                                                                            | P5    |

## 4. Competitor parity checklist (programming-relevant capabilities)

References are the vendors' public help centres:
Decipher (Forsta) — <https://forstasurveys.zendesk.com/hc/en-us/sections/5915505052955-Survey-Programming>;
Qualtrics — <https://www.qualtrics.com/support/survey-platform/>. Feature rows are from those help
centres' public sections; specific article links will be added as each row's acceptance test is written.

| Capability (competitor)                                       | ZAPX equivalent                               | Status             | Acceptance test                                                                                                          | Dependency            |
| ------------------------------------------------------------- | --------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| XML survey definition (Decipher)                              | ZAPX XML ↔ canonical schema                  | Built              | `xml.test.ts`: full definition round-trips; unknown elements reported by line                                            | —                     |
| Loop / Loop & Merge (both)                                    | Page loops over a list or prior answers       | Built              | `flow.test.ts` loops; `blueprint.test.ts` live API interview                                                             | —                     |
| Randomizer / randomized blocks, evenly present (both)         | Page groups: random order, pick N, least-fill | Built              | `flow.test.ts` even first position; least fill: engine test and `blueprint2.test.ts` live (3/3/3)                        | —                     |
| Embedded data / exec variables (both)                         | Calculated variables + URL variables          | Built              | `flow.test.ts` URL and calculated variables; `blueprint2.test.ts` live routing, piping and export                        | —                     |
| Carry forward choices (Qualtrics), dynamic lists              | `optionsFrom` selected / not selected         | Built              | `flow.test.ts` dynamic lists; `blueprint.test.ts` live interview                                                         | —                     |
| Quotas incl. interlocking / least-fill                        | Quota tables generate cells                   | Partial            | Live target change: `blueprint.test.ts`. Table builder: no automated test yet                                            | —                     |
| Survey versions / compare                                     | Version history + structured diff             | Built              | `diff.test.ts`; versions endpoint in `blueprint.test.ts`                                                                 | —                     |
| Library / question bank                                       | Organization question library                 | Built              | `blueprint.test.ts` (API) and `blueprint.spec.ts` (browser: save, insert as `AGE_2`)                                     | —                     |
| Heat map / hot spot (Qualtrics)                               | Image hot-spot question                       | Partial            | `flow.test.ts`: region codes validated and simulated; raw click coordinates not stored                                   | —                     |
| Card sort / pick group rank (Qualtrics)                       | Card sort question                            | Built              | `flow.test.ts`; analysis gives one variable per card                                                                     | —                     |
| MaxDiff (both)                                                | MaxDiff with balanced design + counts scores  | Planned (P4)       | Design balance test; counting scores match hand calculation                                                              | HB estimation: later  |
| Conjoint (CBC) (both)                                         | CBC with random/balanced design + counts      | Planned (P4)       | Level balance; part-worth by counts/logit                                                                                | HB estimation: later  |
| Translation / multiple languages (both)                       | Overlay + review                              | Built              | `localize.test.ts`, `translation-tools.test.ts`, `blueprint2.test.ts` (memory, glossary, QA), `blueprint2.spec.ts` (RTL) | Claude for AI         |
| Test data / QA (both)                                         | QA lab simulation                             | Built              | `simulate.test.ts`; saved test cases: `flow.test.ts`, `blueprint2.test.ts`, `blueprint2.spec.ts`                         | —                     |
| Fraud / bot detection (both; RelevantID in Qualtrics)         | quality-core fraud signals                    | Built              | `fraud.test.ts`                                                                                                          | IPinfo optional       |
| Crosstabs (Decipher Crosstabs, Qualtrics Results)             | analysis-core                                 | Built              | `analysis.test.ts`                                                                                                       | —                     |
| Weighting                                                     | Rim weighting                                 | Built              | `weighting.test.ts`                                                                                                      | —                     |
| Distribution: email, schedules, reminders                     | Contacts + invitations                        | Built (P3)         | `blueprint3.test.ts`: reminder sent only to non-finishers, opt-outs skipped; e2e `blueprint3.spec.ts`                    | SendGrid account      |
| Offline app (Qualtrics Offline App)                           | CAPI PWA                                      | Partial            | e2e milestone 5 + 12                                                                                                     | Native apps: §5       |
| SSO / SCIM / RBAC                                             | Built                                         | Built              | m8 / m13 tests                                                                                                           | IdP                   |
| Python / JavaScript custom code (Decipher exec, Qualtrics JS) | See §5                                        | Out of reach (now) | —                                                                                                                        | Isolated runtime      |
| Dashboards / Stats iQ / Text iQ (Qualtrics)                   | Analysis + AI research assistant              | Partial / P4       | —                                                                                                                        | Licensing (Qualtrics) |

## 5. Honest limits

- **Native Android/iOS apps.** This repo ships an installable offline web app (PWA) that runs on
  Android and iOS browsers. Store-distributed native apps need app-store accounts, signing keys and a
  native toolchain this environment does not have. The PWA covers GPS, camera, microphone, offline
  storage and sync; background sync while the app is closed is limited on iOS.
- **Eye tracking.** Webcam gaze estimation can be built in the browser (P4) but is approximate (typically
  several degrees of error) and will be labelled so in the product. Research-grade hardware (Tobii etc.)
  needs the device and its SDK; ZAPX will define an import format for hardware exports, not claim live
  integration.
- **Python and arbitrary JavaScript in surveys.** Running customer code safely needs an isolated runtime
  (separate process/container with no network, time and memory limits). Until that exists, the
  sandboxed ZAPX expression language is the scripting layer, and imported XML that contains exec/Python
  blocks is flagged, never silently dropped.
- **AI features** run through the AI gateway with Claude and need an Anthropic key set in Settings;
  without it they answer "not configured". Voice commands use the browser's speech recognition where
  available (Chrome/Edge/Safari), and every resulting change is a change set a person approves.
- **Certifications** (ISO 27001, SOC 2, HIPAA) are organizational audits, not code. None are claimed.
- **SAMPLEON, Bidzo, PROJEXA live**: adapters need the systems' API contracts and deployed endpoints.

## 6. Phased plan (stacked PRs on top of PR #29, all in the neon design)

**P1 — Core survey engineering.** Engine: loops, page groups (random order, pick N, least-fill),
calculated variables, dynamic answer lists, card sort and image hot-spot questions. Quotas:
interlocking tables, live target adjustment. Professional Programmer workspace: ZAPX XML import/export
with unsupported-construct warnings, highlighted editor with lint, expression debugger with variable
inspector, dependency explorer, version history with diff. Question bank and survey templates. Sidebar
reorganized into the mockups' module navigation (real pages only).

Phase 1 left for later phases: least-fill block and quota balancing, URL/embedded variables, an
automated test for the quota table builder, reusable multi-question blocks in the bank, calculated
variables in the analysis tables (they are in exports already).

Phase 2 (branch `blueprint-p2-ai-multilingual`) built least-fill blocks and URL variables from that
list. Still open: least-fill quota balancing, the quota table builder test, multi-question bank blocks
and calculated variables in analysis tables (moved to P4); AI-generated test cases and the device
matrix preview (P4); per-module theme overrides and workspace presets (P5).

**P2 — AI automation & multilingual.** Voice command bar (speech → AI change set), AI suggestions,
translation memory + glossary, RTL rendering, locale formats, side-by-side translation editor,
per-language QA, saved QA test cases with regression runs, AI-generated test cases, Theme Studio to 16
families with per-module overrides and workspace presets.

Phase 3 (branch `blueprint-p3-fieldwork`) built the P3 list below except consented video, which moves
to P4 with the eye-tracking camera work (same consent and capture pipeline).

**P3 — Fieldwork & security.** CAPI geofencing, question timestamps, signature, barcode/QR, consented
video, interruption log, back-checks and supervisor verification, supervisor dashboard with map and
productivity, quality appeals, distribution (contacts, invitations, schedules, reminders).

**P4 — Research intelligence.** MaxDiff and conjoint (design + analysis), webcam eye-tracking study
module (consent, calibration, AOIs, heatmaps, accuracy labels), recodes/derived variables with lineage,
segmentation, chart dashboards, AI research assistant grounded in computed tables.

**P5 — Enterprise scale.** Automation engine (rules, schedules, approvals, notifications), SAMPLEON and
Bidzo adapters on versioned contracts, data residency + retention settings, observability and
hardening.

Each phase is verified with `pnpm check` (format, lint, build, typecheck, unit/API tests, e2e) before
its PR is opened. Merging waits for Kunal.
