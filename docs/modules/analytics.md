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

Results are **unweighted**.

## Saved reports

Type a name and **Save report**. Saved reports keep the filters and table setup, and are rerun on
the latest data each time you open them. **Excel** downloads the report as a workbook (aggregates
only, no respondent data). **Save changes** updates the open report; **Save as new** copies it.

## API

| Method and path                              | Who                                  | What                                                             |
| -------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `GET /api/surveys/:id/analysis/variables`    | admin, programmer, viewer            | Variables and the number of completes                            |
| `POST /api/surveys/:id/analysis/frequencies` | admin, programmer, viewer            | `{ filters?, variables? }`                                       |
| `POST /api/surveys/:id/analysis/crosstab`    | admin, programmer, viewer            | `{ filters?, banner, stubs, confidence? }`                       |
| `GET /api/surveys/:id/reports`               | admin, programmer, viewer            | Saved reports                                                    |
| `POST /api/surveys/:id/reports`              | admin, programmer                    | `{ name, config }`, config `type` is `frequencies` or `crosstab` |
| `GET`, `PUT`, `DELETE /api/reports/:id`      | read: all; change: admin, programmer | One report                                                       |
| `POST /api/reports/:id/run`                  | admin, programmer, viewer            | Run on the latest data                                           |
| `GET /api/reports/:id/export.xlsx`           | admin, programmer, viewer            | Excel workbook (audited)                                         |

`filters`: `{ statuses: ['COMPLETE'], includeTest: false, includeRejected: false, vendors?: [code],
modes?: ['CAWI'|'CAPI'|'CATI'], from?, to? }`.

## Limits

- Up to 200,000 interviews per analysis (narrow the filters or export above that).
- No weighting, nets, banner books, charts or scheduled delivery yet. See
  [ADR 0016](../adr/0016-analysis-and-reports.md).
