# ADR 0032: Blueprint phase 4, research intelligence

Status: accepted (2026-11-04)

## Context

Phase 4 of the ZAPX blueprint asks for research depth: MaxDiff and choice-based conjoint, recodes and
derived variables with lineage, an AI research assistant grounded in computed tables, webcam eye
tracking, and consented CAPI video. Earlier phases left a few items here too: least-fill quota
balancing, a test for the quota table builder, multi-question blocks in the question bank, calculated
variables in analysis tables, AI test cases and a device matrix preview. The blueprint forbids fake
integrations, untested parity claims and invented AI capabilities.

## Decision

1. **Designs are computed, never stored.** MaxDiff and conjoint designs are deterministic functions of
   the question (`choice-design.ts`), so the device, the server, the export and the analysis see the
   same sets. Each respondent gets one version from their seed. The generators are greedy balancing
   heuristics, not D-optimal search: every item or level is shown as evenly as possible, MaxDiff pairs
   are spread, conjoint tasks avoid repeating a level and never repeat a concept. Answers store the
   version (`{v, b1, w1, ...}` and `{v, t1, ...}` with 0 for "none"), and validation checks each pick
   against that version's set.
2. **Estimation is aggregate and says so.** MaxDiff uses counting scores ((best − worst) / shown).
   Conjoint uses a multinomial logit with effects coding, fitted by Newton-Raphson with step halving;
   importances are shares of part-worth ranges. Tests recover known utilities from a synthetic
   population. Hierarchical Bayes (individual utilities) is not built and the UI does not claim it.
3. **Recodes are analysis variables, not data edits.** `def.recodes` groups another variable's values
   (codes or numeric ranges, an optional "other" group); a recode may use an earlier recode or a
   calculated variable. Analysis-core builds them with `derivation` and `lineage` (nearest source
   first), the same tables and significance tests apply, and exports carry them as columns. Answers
   are never changed. Calculated variables are worked out per record and shown with their formula.
4. **The research assistant only reads tables ZAPX computed.** A new `insights` AI task (own model
   setting `AI_MODEL_INSIGHTS`, own permission in AI settings) receives frequencies or crosstabs by a
   banner as text with bases, low-base marks and significance letters. Open answers are never sent; the
   question is redacted like a brief. The model must cite table ids; findings citing nothing or a table
   that was not sent are dropped and the answer says how many. The tables are always shown beside the
   answer, and the researcher can see them before asking (no AI call). Tested with a stand-in provider.
   Organizations with their own AI policy must allow the new task in AI settings.
5. **Consented video reuses the recording pipeline.** `settings.capi.video` asks for sound and video in
   the same consent; without a camera the app records sound only and says so. The server keeps a
   recording as video only when the survey asks for video (the type is still decided from the bytes),
   and the review queue plays it. At about 300 kbit/s an hour is roughly 135 MB, so long interviews
   need `CAPTURE_MAX_MB` raised.
6. **Least-fill quota groups.** Quotas sharing a `group` are alternatives: a respondent who matches
   several counts toward one, the least filled (count / target) that has room, and is over quota only
   when all of them are full. One helper (`quotas/quota-places.ts`) takes places for web completes,
   CAPI sync and reinstated appeals, and stores the cells taken in `Response.quotaCells`, so a quality
   reject or failed back-check releases the same cell. Completes stored earlier have no cells and
   release their matching quotas as before.
7. **Suggested test cases come from simulation, not AI.** Simulated respondents are chosen greedily so
   every ending, page and quota they reached is covered; each case pins that respondent's route,
   ending, variables and quotas, and is offered only if it passes now. The UI calls them suggested,
   not AI-generated.
8. **The device matrix uses real viewport sizes.** The preview renders the page into three iframes
   (375, 768 and 1280 px wide) so the theme's media rules apply, and flags content wider than the
   screen. Its first run found a P1 bug: the card sort's `.zx-card` style also applied to every survey
   page card (now `.zx-sort-card`).
9. **Bank blocks are pages.** A `BLOCK` library item holds one or more pages. Inserting one renames
   clashing page ids and variable names (Q1 becomes Q1_2) and rewrites the block's own conditions,
   validations, piping and dynamic lists; logic that points outside the block is left for the survey
   analysis to check.

## Not built in this phase

- **Webcam eye tracking** moves to P5. A browser face-landmark model would have to be served from ZAPX
  and checked on real webcams for its accuracy label; this environment can do neither, and shipping it
  untested would be the parity claim the blueprint forbids.
- Chart dashboards and segmentation filters, rule-based cleaning, AI-written test cases (P5).

## Consequences

- One column (`Response.quotaCells`) and one enum value (`LibraryItemKind.BLOCK`), migrations
  `20261115000000_blueprint_p4` and `20261115000001_blueprint_p4_bank_blocks`.
- New schema: `maxdiff` and `conjoint` question types, `recodes`, `quota.group`, `capi.video`, ZAPX XML
  for all of them.
- Tests: `logic-engine` `choice.test.ts`, `recode.test.ts`, `quota-table.test.ts`, `bank-block.test.ts`,
  `suggest-cases.test.ts`; `analysis-core` `derived.test.ts`; `apps/api/test/blueprint4.test.ts`
  (15 tests); `e2e/tests/blueprint4.spec.ts`.
