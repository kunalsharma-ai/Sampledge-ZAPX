# 0016: Survey analysis and saved reports in the API

Status: Accepted (Milestone 10)

## Context

Researchers need toplines and banner tables while fieldwork runs, without exporting to SPSS or
Excel for every look. Until now ZAPX had fieldwork dashboards (counts, drop-off, quotas) and raw
data exports, but no frequencies, crosstabs or significance testing.

## Decision

- **A pure package, `@zapx/analysis-core`**, turns a survey definition and response records into
  variables, frequencies and crosstabs. No framework or database, so the same code can later run
  in a worker or a reporting store. It is unit-tested on hand-checked numbers.
- **Variables** come from the definition: single, multiple choice, numeric and open questions, one
  variable per grid row (`Q_row`), plus system variables (status, vendor, mode, language, device)
  whose categories are read from the data. Codes in the data that the current version no longer
  has are reported as "not in the current version", so nothing is silently dropped.
- **Bases** are people who answered the variable. Multiple choice shares are of people, so they
  can add up to more than 100%.
- **Significance**: every banner column is compared with every other. Column proportions use a
  pooled two-proportion z-test; column means use Welch's t with the normal critical value. Results
  are letters ("80% B": higher than column B) at 90, 95 or 99% confidence, two-sided. Columns with
  a base under 30 are flagged as low and not tested, and multiple choice banners are not tested
  (people can be in several columns). No correction for multiple comparisons, as is usual on
  banner tables; the note on every table says what was tested.
- **Unweighted.** Weighting (rim weighting to targets) is a later addition to the same package.
- **Filters**: interview status (default completes), test interviews and completes rejected in
  quality review left out by default, vendors, modes, and a start-date range.
- **Data access** goes through the tenant-scoped client, so row-level security applies, reading
  pages of 5,000 rows. One analysis handles up to 200,000 interviews (`413` above that, with a
  hint to narrow filters or export); larger studies need SQL aggregates or a reporting store.
- **Saved reports** (`Report`: name and a validated config) belong to a survey. Admins and
  programmers save, update and delete; viewers can run them and download Excel. Excel workbooks
  contain aggregates only, never respondent rows. Creating, changing, deleting and exporting
  reports are audited.

## Consequences

- Toplines and banner tables are available in the studio during fieldwork with no extra service.
- Every run reads the rows again; there is no caching. Fine for the sizes above, and the pure
  package keeps the move to a worker or reporting store small.
- Not built yet: weighting, nets and custom groupings, multiple banners per table (banner books),
  charts and dashboards, scheduled report delivery, and PowerPoint export.
