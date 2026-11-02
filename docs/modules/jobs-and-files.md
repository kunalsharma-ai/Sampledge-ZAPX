# Background jobs and files (Milestone 7)

Long work runs on a job worker instead of inside a browser request: response exports, QA runs above
2,000 synthetic respondents, and AI drafts (typed instructions or a Word, PDF or text
questionnaire). Design and trade-offs: [ADR 0013](../adr/0013-background-jobs-and-file-storage.md).

## In the studio

- **Quotas & data → Responses.** _Export CSV_ and _Export Excel_ still download at once for up to
  10,000 rows. _Background CSV_ and _Background Excel_ start a job; the table shows progress, then a
  _Download_ link with the file name, row count and size. Files are kept for 72 hours.
- **QA lab.** Up to 10,000 respondents. Above 2,000 the run goes to the worker with a progress bar,
  and the report opens when it finishes. You can leave the page; the run appears under _Past runs_.
- **AI & import.** _Draft proposal_ and Word, PDF or text imports run as jobs, so a slow model call
  never times out the page. Excel and CSV template imports stay instant.

## API

All queue endpoints answer `202 Accepted` with the job. Poll `GET /api/jobs/:id` until `status` is
`SUCCEEDED`, `FAILED` or `CANCELLED`.

| Method and path                     | Who                        | Body                                                                     |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `POST /api/surveys/:id/jobs/export` | anyone who sees the survey | `{ "format": "csv" \| "xlsx", "includeTest": false, "statuses": [...] }` |
| `POST /api/surveys/:id/jobs/qa`     | admin, programmer          | `{ "respondents": 1-10000, "seed": "...", "target": "draft" \| "live" }` |
| `POST /api/surveys/:id/jobs/ai`     | admin, programmer          | multipart: `instruction`, optional `file` (docx, pdf, txt, md)           |
| `GET /api/surveys/:id/jobs?type=`   | anyone who sees the survey | newest first, up to 20                                                   |
| `GET /api/jobs/:id`                 | anyone who sees the survey |                                                                          |
| `POST /api/jobs/:id/cancel`         | the creator or an admin    | queued jobs stop at once, running ones at the next step                  |
| `GET /api/files/:id`                | anyone who sees the survey | the export file; `X-Content-SHA256` header; audited                      |

A job looks like this (inputs are never returned):

```json
{
  "id": "cm...",
  "type": "export",
  "status": "SUCCEEDED",
  "progress": 100,
  "progressNote": "Done",
  "result": { "fileId": "cm...", "name": "Brand_screener_W1.csv", "rows": 48210, "size": 9123456, "expiresAt": "..." },
  "error": null,
  "attempts": 1
}
```

Results by type: `export` gives `fileId`, `name`, `rows`, `size`, `format`, `expiresAt`; `qa_run`
gives `runId` (open it with `GET /api/qa/runs/:id`), `passed`, `coverage`, `respondents`;
`ai_propose` gives `changeSetId` and `title` (review it like any other change set; nothing is applied
automatically).

A direct `GET /api/surveys/:id/export` above `EXPORT_SYNC_MAX_ROWS` answers `413` and asks you to use
a background export.

## Running the worker

- One machine: nothing to do. The API runs the worker in-process (`JOB_WORKER=on`).
- Separate process: `node apps/api/dist/worker.js` (same environment as the API). Run the API with
  `JOB_WORKER=off` and `CALLBACK_WORKER=off`. `docker compose up` does this with the `worker`
  service and a shared `files` volume.
- Several workers are safe: each job is claimed by one worker with `SKIP LOCKED`.

| Setting                           | Default       | Meaning                                                                   |
| --------------------------------- | ------------- | ------------------------------------------------------------------------- |
| `JOB_WORKER`                      | `on`          | Run jobs inside the API process                                           |
| `JOB_POLL_MS`                     | `2000`        | How often an idle worker looks for jobs                                   |
| `FILES_DIR`                       | `.data/files` | Where the local file store writes (must be shared by API and worker)      |
| `EXPORT_SYNC_MAX_ROWS`            | `10000`       | Largest direct export; above it, use a background export                  |
| `EXPORT_FILE_TTL_HOURS`           | `72`          | How long export files can be downloaded                                   |
| `JOB_RETENTION_DAYS`              | `30`          | Finished jobs older than this are deleted                                 |
| `WEBHOOK_DELIVERY_RETENTION_DAYS` | `30`          | Delivered, failed and dead webhook deliveries older than this are deleted |

## Limits

- With `FILE_STORE=local` files live on a disk the API and the worker must share. `FILE_STORE=s3`
  (Milestone 13) keeps them in a private bucket instead: every object is written with SSE-KMS
  (`S3_KMS_KEY_ID`) or SSE-S3, keys are `<S3_PREFIX>/<organization>/...`, credentials come from the
  standard AWS chain (the ECS task role on AWS). It is tested with the real AWS SDK against a fake S3
  server (`apps/api/test/support/mock-s3.ts`), **not yet against AWS S3 itself**. Moving from local
  to S3 does not copy existing files; copy `FILES_DIR` into the bucket under the prefix first
  (`aws s3 sync .data/files s3://bucket/prefix/`).
- The worker runs one job at a time per process; run more processes for more throughput.
- Cancelling a running export or AI draft takes effect at its next progress step; an AI call already
  sent to the model is not interrupted.
