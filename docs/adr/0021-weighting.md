# 0021: Rim weighting in analysis

Status: Accepted (Milestone 15). Extends 0016.

## Context

Online and phone samples rarely match the population: quotas are loose, some groups answer more.
Researchers correct this with weights, usually rim weighting (raking) on a few demographics, and
expect weighted tables with honest significance tests. ZAPX analysis was unweighted.

## Decision

- **Raking (iterative proportional fitting) in `@zapx/analysis-core`**, a pure function next to the
  tables. Up to 10 single-answer variables, targets in percent per category, weights capped
  (default 0.2 to 5) and rescaled to a mean of 1 after every pass, stop at 0.01 points or 100 passes.
- **Computed per run, not stored.** Weights follow the selection (filters, new interviews), so a
  saved report is always consistent with its data. A scheme is part of the report configuration.
  Measured: 200,000 interviews on three variables rake in about 0.2 s when the targets fit, and the
  worst case (100 passes, conflicting targets) takes about 1 s.
- **Honest outputs.** Every table keeps the unweighted base; low base is judged on it. Column tests
  use the Kish effective base, (Σw)² / Σw², which is the standard design-effect approximation.
  Non-convergence, empty target cells and efficiency below 50% are reported, never hidden.
- **Interviews without an answer to a weighting variable keep their weight for it**, rather than
  being dropped or forced into a category.

## Consequences

- Results are reproducible from the report configuration and the data alone.
- The effective-base approximation ignores correlation between the weights and the measured
  variable; it is what tabulation packages use and is conservative enough for column tests.
- Not included: cell (target-by-cross) weighting beyond what raking gives, weights on data exports,
  and stored weight variables for use in other tools.
