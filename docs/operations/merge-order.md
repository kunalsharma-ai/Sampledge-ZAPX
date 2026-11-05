# Merge order for the open pull requests

The open pull requests are a stack: each one is built on the one before, so they merge one at a time
from the bottom. Every branch is rebased on the one below it, has no conflicts, and passed
`./scripts/check.sh --quick` locally. The full browser suite (`e2e/`) passed on the top branch,
which contains all of them. There is no CI on this repository, so these local checks are the only
checks.

| Order | PR  | Branch                         | What it adds                                                                 |
| ----- | --- | ------------------------------ | ---------------------------------------------------------------------------- |
| 1     | #27 | `quantum-design-system`        | Quantum Design System and theme engine                                       |
| 2     | #29 | `neon-ai-dashboard`            | Neon AI theme, sidebar shell and dashboard                                   |
| 3     | #30 | `blueprint-p1-core`            | Blueprint phase 1: loops, blocks, variables, programmer workspace, bank      |
| 4     | #31 | `blueprint-p2-ai-multilingual` | Blueprint phase 2: multilingual tools, URL variables, least fill, test cases |
| 5     | #32 | `blueprint-p3-fieldwork`       | Blueprint phase 3: fieldwork evidence, supervision, appeals, email           |
| 6     | #33 | `blueprint-p4-research`        | Blueprint phase 4: MaxDiff, conjoint, recodes, AI research assistant         |
| 7     | #34 | `blueprint-p5-enterprise`      | Blueprint phase 5: automation, residency, cleaning, dashboards, SMS          |
| 8     | #35 | `docs-handbook`                | Maintainer handbook                                                          |
| 9     | #36 | `security-fixes`               | Security fixes: vendor secret, password change and reset, AWS secret list    |
| 10    | #37 | `blueprint-p6-eye-tracking`    | Webcam eye tracking (experimental, not validated on real webcams)            |
| 11    | #38 | `stack-integrations-in-crm`    | Brings #28 (integrations in the CRM) onto the stack, with conflicts resolved |

## How to merge

1. Merge with **Create a merge commit**, not **Squash and merge** or **Rebase and merge**. Both of those
   give `main` new copies of the commits, so the next PR in the stack would show conflicts.
2. Merge #27 into `main`. Then open #29: if GitHub has not moved its base to `main` by itself
   (it does when the merged branch is deleted), press **Edit** next to the title and set the base to
   `main`. Then merge it. Repeat for each PR in the table.
3. **#28 is not merged on its own.** Its branch was made from an older `main` and conflicts with the
   stack. #38 contains all of #28's commits with the conflicts resolved, so once #38 is merged,
   GitHub shows #28 as merged. If it does not, close #28.
4. After the last merge, run the database migrations on each environment (the deploy script does
   this). The new migrations run in name order, ending with `20261118000000_integrations_in_crm`.

## Not part of the stack

The Dependabot pull requests (#20 to #25) are separate and can wait until the stack is in:

- #22 to #25 update GitHub Actions steps, which do not run while Actions is off for this account.
- #20 (Node 26) and #21 (nginx 1.31) change the Docker images. Merge each on its own after the
  stack, then build the images and run the checks, since nothing here has been tested on them.

## Still waiting on something else

- SAMPLEON and Bidzo integrations wait for their API documentation; nothing is built for them.
- Eye tracking is experimental. It is opt-in and marked as not validated in the editor, on the
  respondent screen and in Analysis (ADR 0034). Try it with a few real respondents before relying on
  it.
