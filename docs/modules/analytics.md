# Analysis and reports (Milestone 10)

Open a survey and choose **Analysis**. Everyone on the team can run tables; admins and programmers
can save them as reports.

## Who to include

- **Interview status**: completes only by default. Tick terminates, partials and so on to analyse
  them instead or as well.
- **Mode**: online (CAWI), face to face (CAPI) or phone (CATI). None ticked means all.
- **Started from / to**: interview start date.
- Test interviews and completes **rejected in quality review** are left out unless you tick them.

## Frequencies

One card per question: count and share of the people who answered (the base). Multiple choice
shares can add up to more than 100%. Numeric questions show mean, median, standard deviation,
minimum and maximum. Open questions show the latest 20 answers. Grid questions get one table per
row. Choose questions with the checkboxes, or leave them all unticked for every question.

## Crosstabs

Pick a **banner** (columns: any single or multiple choice question, or vendor, mode, language,
device, status) and the **rows** (stubs). Every table has a Total column and one column per banner
answer, each with a letter.

**Significance letters.** A letter next to a value means it is significantly higher than the value
in the column with that letter, at the confidence you chose (90, 95 or 99%). "71.3% B" in the Man
(A) column means men are significantly more likely than women (B). Percentages use a two-proportion
z-test; means use Welch's test.

Not tested:

- columns with a base under 30 (marked **low**);
- tables with a multiple choice banner, since people can be in several columns.

Results are unweighted unless you add weighting (below).

## Weighting

**Weighting** (left column) corrects a sample whose mix differs from the population, e.g. too many
men. Add one or more single-answer variables (single choice or scale questions, grid rows, or mode,
vendor, language, device), enter the target share of each category, and **Check weights**. SampCode
rakes the selected interviews (rim weighting, iterative proportional fitting) until every variable
matches its targets, and shows:

- whether the targets were met, and after how many passes;
- **efficiency**: how much the weighting costs. 75% means the weighted results are as precise as
  an unweighted sample of three quarters the size (the **effective base**);
- the lowest and highest weight, and how many interviews sit at a cap;
- per category: the target, the sample share and the weighted share.

Then **Run**. Counts, shares, means, medians and NPS use the weights. Each table still shows the
unweighted base (what was interviewed), and significance letters are tested on the effective base,
so weighting never makes a result look more certain than the interviews allow. Low base (under 30)
is judged on the unweighted base.

Rules worth knowing:

- Targets are percentages of the people who answered that variable; interviews without an answer
  keep their weight for it. Targets that do not add up to 100 are rescaled.
- Weights are kept between the **lowest** and **highest weight** (default 0.2 to 5) and average 1,
  so the weighted total equals the number of interviews. Tight caps or conflicting targets can stop
  the targets being met; SampCode says so rather than hiding it.
- A category with a target but no interviews cannot be weighted up; it is reported, and its target
  is shared over the other categories.
- Weights are computed on each run for the interviews selected by the filters, so a report always
  matches its current data. Saved reports keep their weighting, and the Excel file states it.

## Saved reports

Type a name and **Save report**. Saved reports keep the filters and table setup, and are rerun on
the latest data each time you open them. **Excel** downloads the report as a workbook (aggregates
only, no respondent data). **Save changes** updates the open report; **Save as new** copies it.

## API

| Method and path                              | Who                                  | What                                                             |
| -------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `GET /api/surveys/:id/analysis/variables`    | admin, programmer, viewer            | Variables and the number of completes                            |
| `POST /api/surveys/:id/analysis/frequencies` | admin, programmer, viewer            | `{ filters?, variables?, weighting? }`                           |
| `POST /api/surveys/:id/analysis/crosstab`    | admin, programmer, viewer            | `{ filters?, banner, stubs, confidence?, weighting? }`           |
| `POST /api/surveys/:id/analysis/weights`     | admin, programmer, viewer            | `{ filters?, weighting }`: check a weighting scheme              |
| `GET /api/surveys/:id/reports`               | admin, programmer, viewer            | Saved reports                                                    |
| `POST /api/surveys/:id/reports`              | admin, programmer                    | `{ name, config }`, config `type` is `frequencies` or `crosstab` |
| `GET`, `PUT`, `DELETE /api/reports/:id`      | read: all; change: admin, programmer | One report                                                       |
| `POST /api/reports/:id/run`                  | admin, programmer, viewer            | Run on the latest data                                           |
| `GET /api/reports/:id/export.xlsx`           | admin, programmer, viewer            | Excel workbook (audited)                                         |

`filters`: `{ statuses: ['COMPLETE'], includeTest: false, includeRejected: false, vendors?: [code],
modes?: ['CAWI'|'CAPI'|'CATI'], from?, to? }`.

## Limits

- Up to 200,000 interviews per analysis (narrow the filters or export above that).
  `weighting`: `{ dimensions: [{ variable, targets: [{ code, pct }] }], minWeight?: 0.2, maxWeight?: 5 }`,
  up to 10 variables.

- No nets, banner books, charts or scheduled delivery yet. Data exports do not include a weight
  column yet. See
  [ADR 0016](../adr/0016-analysis-and-reports.md).
