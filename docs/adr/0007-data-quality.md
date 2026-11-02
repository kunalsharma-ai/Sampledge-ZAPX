# 0007: Data quality scoring with human review

Status: Accepted (Milestone 5)

## Context

Survey data loses value when speeders, straightliners, bots and copy-pasted answers get in. Sample
vendors are paid per complete, so a quality decision changes money and must be explainable,
reversible only before the vendor is told, and never silent. ZAPX already has one logic engine and
one outcome model (eight statuses shared with PROJEXA), and quality must not become a second engine.

## Decision

- A framework-free package, `@zapx/quality-core`, scores each complete from 0 to 100 and lists the
  reasons: hard and relative speeding, straightlining, open-end gibberish, very short answers,
  open answers identical to another respondent's, several completes from one network, and
  survey-specific checks written in the existing logic language (attention and consistency checks).
  It is pure: the API supplies the median length, the open-answer fingerprints and the network count.
- Quality settings live in the versioned survey definition (`settings.quality`), so they are
  diffed, logic-checked and published like any other rule.
- Two thresholds: below `reviewBelow` (default 70) a complete waits in a review queue; below
  `rejectBelow` (default 0, off) it ends inside the survey as `quality_fail`, redirected as such and
  never counted toward quotas. By default nothing is rejected automatically.
- A person decides in the review queue. Rejecting turns the complete into `quality_fail`, releases the
  quota place, queues a `quality_fail` callback through the existing outbox, and is audited. It is
  final, because the vendor may already have acted on it.
- Privacy: the network check stores a keyed HMAC of the address (key derived from the server secret,
  scoped per organization), never the address. Open answers are fingerprinted (SHA-256 of normalized
  text, 25 characters or more) only within one survey.

## Consequences

- Versions published before this milestone have no `settings.quality`; code reads it through
  `qualitySettingsOf()`, which applies the defaults. Those surveys now get scores and a review queue,
  but no respondent is treated differently.
- Heuristics are deliberately conservative and Latin-script oriented for gibberish; other scripts are
  only checked for repetition. A flag is evidence for a reviewer, not a verdict.
- PROJEXA's documented contract treats a second, different outcome for a token as a conflict (409),
  so a post-review `quality_fail` for a PROJEXA vendor is recorded as a failed callback until PROJEXA
  supports reconciliation. Direct vendors receive it normally.
- The fieldwork dashboard computes from response rows in the API process; at very large volumes it
  moves to SQL aggregates or a reporting store.
