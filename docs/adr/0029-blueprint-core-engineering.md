# ADR 0029: Blueprint phase 1, core survey engineering on the one engine

Status: accepted (2026-11-04)

## Context

Kunal's ZAPX blueprint asks for Decipher/Qualtrics-level programming: loops, randomized blocks, hidden
variables, carry-forward lists, interlocking and live-adjustable quotas, a professional code workspace (XML,
debugger, version diff), a question bank and templates, card sort and hot-spot questions. It also says one
canonical schema must back both the visual builder and code mode, unsupported constructs must be reported,
not dropped, and working code must be kept. The audit (`docs/product/blueprint-parity.md`) found the existing
schema and logic engine already serve the server, studio, runtime, QA lab and CAPI app.

## Decision

1. **Extend the canonical schema, compile the rest away.** `loops`, `blocks` and `variables` are new optional
   arrays on the definition. Loops are expanded by `compileSurvey` into ordinary pages with suffixed variable
   names (`RATING_3`) and a gate condition, so the renderer, quotas, quality checks, exports and analysis need
   no loop logic. Every runtime path calls `prepareSurvey` (cached, idempotent); authoring keeps the
   un-expanded form. Translation is applied before compiling, so loop copies inherit it.
2. **Block order is seeded per respondent.** `pageOrder(def, seed)` shuffles (and picks N of) a block's pages
   with the response id, CAPI client id or preview seed, so a respondent sees the same order on resume, in
   offline replay and on the server. The response id is generated before insert for this reason. Least-fill
   balancing is not built yet; the parity doc says so.
3. **Calculated variables are lazy symbols.** They are evaluated in `contextFor`, guarded against cycles,
   checked for forward references, and exported as columns.
4. **Live quota targets are a count-table override.** `QuotaCount.targetOverride` changes a target without a
   new version; quota checks use `COALESCE(targetOverride, target)` and every change is audited.
5. **XML is a view, not a second source of truth.** `toZapxXml` / `fromZapxXml` round-trip the canonical
   definition. The parser refuses DTDs and unknown entities. Unknown elements and attributes are warnings with
   line numbers. Decipher-style XML is migrated with an explicit warnings list (exec, styles, unsupported
   conditions); nothing is executed.
6. **Question bank is tenant-scoped JSON.** `LibraryItem` stores a validated question or whole survey per
   organization. Inserted questions get a free variable name. Built-in templates live in
   `@zapx/survey-schema` and each one must pass the logic check and a 50-respondent simulation in tests.

## Consequences

- Loops and blocks work everywhere the engine runs without changes to the renderer or data model.
- Variable names produced by loops are stable (`Q_code`), so data and exports stay readable across versions.
- Custom Python or JavaScript remains unsupported until an isolated runtime exists (see the parity doc §5).
- The sidebar gains "Question bank" and uses the mockups' module wording where a real page exists
  ("Fieldwork calls", "Themes & appearance"). Modules without a page yet are not shown.
