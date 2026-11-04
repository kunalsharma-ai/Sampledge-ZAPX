# ADR 0030: Blueprint phase 2, multilingual tools, URL variables, least fill, test cases, voice

Status: accepted (2026-11-04)

## Context

Phase 2 of the ZAPX blueprint asks for AI automation and multilingual depth: translation memory,
glossaries, right-to-left languages, locale formats, per-language QA, saved QA test cases, voice
commands and a Theme Studio with 16 families. Phase 1 left least-fill blocks and URL variables open.

## Decision

1. **Translation memory is derived, not stored.** It is built on request from reviewed translations in
   the organization's 400 most recent survey versions, by exact source text (most frequent wins). Reused
   texts keep their reviewed status, because a person approved that exact source → translation pair; the
   reuse is audited. No new table, nothing to keep in sync.
2. **Glossary is a tenant table** (`GlossaryTerm`, unique per language and term). Terms found in a batch
   are sent with AI translation requests, and `translationQa` warns when a reviewed translation misses
   one. Glossary misses, long expansions and unchanged text are warnings; publishing still blocks only on
   missing, outdated, unreviewed or broken-placeholder texts, as before.
3. **Direction and numbers come from the language tag.** `textDirection(tag)` and `formatNumber` live in
   the schema package. The runtime, CAPI app and studio preview set `dir`; the renderer uses logical
   text alignment.
4. **URL variables are answers stored at entry.** `urlVariables` map link parameters to variables. Their
   values are written into the response's answers when it starts (web and CATI), so logic, quotas,
   piping, exports and replay need no special path. Reserved link parameters cannot be read.
5. **Least fill chooses the seed, not the order.** The server tries up to 32 seeds derived from the
   response id and keeps the one whose picked pages have been shown least (`BlockExposure` counts, test
   interviews not counted). The chosen seed is stored as `Response.orderSeed`, so resume and every later
   page see the same pages. Offline CAPI keeps seeded random.
6. **Test cases are data, run by the engine.** `QaTestCase` stores answers plus expectations (pages or
   questions shown/skipped, ending, variable values, quotas). `runTestCase` reports each expectation with
   what actually happened; an id that no longer exists fails rather than passing silently.
7. **Voice commands never change the survey by themselves.** `parseVoiceCommand` maps speech to
   navigation or "save draft"; anything else becomes an AI architect instruction, which produces a change
   set for review. Publishing is not a voice command. Speech recognition is the browser's own.
8. **Five more theme families** bring Quantum to 16. Every family passes the existing contrast tests in
   light, dark, high-contrast and full-gradient variants.

## Consequences

- Translation memory quality depends on reviews: machine translations never enter it.
- Exposure counts are per survey; republishing with different block pages starts new counters for new
  page ids.
