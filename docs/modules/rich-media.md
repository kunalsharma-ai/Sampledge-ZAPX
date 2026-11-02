# Rich media and question types (Milestone 11)

## Question types

| Type in the editor  | JSON `type`                             | Stored as                                    | In logic                                         |
| ------------------- | --------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Rating scale / NPS  | `scale`                                 | the number chosen (or the "don't know" code) | `NPS >= 9`                                       |
| Ranking             | `ranking`                               | codes in rank order, e.g. `[2, 1]`           | `RANK.2 == 1` (item 2 ranked first), `3 in RANK` |
| Constant sum        | `sum`                                   | `{ "1": 60, "2": 40 }`                       | `SPEND.1 >= 50`                                  |
| Numeric as a slider | `numeric` with `display: "slider"`      | the number                                   | `TEMP > 70`                                      |
| Image choice        | `single` or `multi` with option `image` | the code                                     | as usual                                         |

- **Photo** (`photo`, Milestone 12): the answer is a reference to a private photo. Respondents
  take one with the camera or choose one; the device shrinks it to 1600 px and removes its
  metadata before upload. In logic, `SHELF != null`. Reviewers see photos in the review queue. See
  [ADR 0018](../adr/0018-fraud-detection-and-capi-capture.md).
- **Scale**: from/to (any whole numbers up to 20 points), end labels, and an optional answer
  outside the scale such as "Don't know". Tick **Net Promoter Score** for a 0-10 NPS question.
- **Ranking**: respondents tap items in order of preference and can move them up or down. Set
  **Rank only the top** to ask for a top 3 instead of every item.
- **Constant sum**: respondents share a total (100 points, 10 purchases, a budget) and see what is
  left as they type. Empty items count as 0.
- **Slider**: needs a minimum and maximum. A slider nobody touched has no answer, so required
  sliders must be moved.

## Media

In the Build tab, select a question and use **Image, video or audio** to upload a file or reuse
one uploaded before. Describe it for screen readers and add an optional caption. For video and
audio you can require respondents to play it to the end before they continue.

For **image choice**, open a single or multiple choice question and pick or upload a **Picture**
for each answer. The answer label stays visible and is what screen readers read.

Accepted files: PNG, JPEG, WebP or GIF images up to 10 MB; MP3, M4A, OGG or WAV audio up to 25 MB;
MP4 or WebM video up to `MEDIA_MAX_MB` (100 MB by default). Files are checked by their content.
SVG is not accepted.

Files are public to anyone with their link (they are shown to respondents, who have no account),
so do not upload material that must stay confidential. A file used by a published version cannot
be deleted, and a survey cannot be published with a missing file.

The interviewer app downloads media with the survey, so interviews with media work offline.

## Read aloud

Design → Devices → **Offer "Read aloud" on every question** adds a button that reads the question
and its answers with the voices installed on the respondent's device, in the survey language when
one is available. Nothing is uploaded. Recorded voice-over and transcription of spoken answers are
not built yet (they need a speech provider).

## Data and analysis

- Exports: `NPS` one column; ranking `RANK_1`, `RANK_2`, ... (rank of each item, empty when not
  ranked); constant sum `SPEND_1`, `SPEND_2`, ... (amount per item).
- Analysis: scales show shares per point, a mean that leaves out "don't know", and the NPS
  (promoters 9-10 minus detractors 0-6). Ranks and amounts are numeric variables with means.

## API

| Method and path               | Who               | What                                          |
| ----------------------------- | ----------------- | --------------------------------------------- |
| `GET /api/surveys/:id/media`  | team members      | The survey's media files                      |
| `POST /api/surveys/:id/media` | admin, programmer | Upload (`multipart/form-data`, `file`)        |
| `DELETE /api/media/:id`       | admin, programmer | Delete a file no version uses (409 otherwise) |
| `GET /api/public/media/:id`   | anyone            | The file, cacheable, with byte ranges         |

See [ADR 0017](../adr/0017-rich-media-and-question-types.md).
