# 0013: Background jobs and file storage in PostgreSQL

Status: Accepted (Milestone 7)

## Context

Exports, large QA runs and AI drafts ran inside the HTTP request. A 50,000-row Excel export or an AI
draft of a long questionnaire can take longer than a load balancer's idle timeout, holds a Node
event loop busy, and is lost if the browser tab closes. We need a queue, a place to keep the
results, and a way to run the work in its own process, without adding infrastructure the project
does not have yet (no Redis, no SQS, and AWS is not provisioned).

## Decision

- **Queue in PostgreSQL.** A `Job` table holds type, input, status (`QUEUED`, `RUNNING`,
  `SUCCEEDED`, `FAILED`, `CANCELLED`), progress and result. Workers claim one job at a time with
  `FOR UPDATE SKIP LOCKED`, so any number of workers can run side by side.
- **Leases, not heartbeats.** A claim sets `lockedUntil` five minutes ahead and every progress update
  extends it. A `RUNNING` job whose lease has expired (the worker died) is claimed again. After
  `maxAttempts` claims it fails with "The job stopped unexpectedly several times." Errors the job
  understands (no access, survey not found, too many rows, AI errors) fail at once without retry;
  unexpected errors are retried once after 30 seconds. AI drafts are never retried (`maxAttempts` 1),
  so a model call is not paid for twice.
- **Jobs run as their creator.** The worker reloads the member from the database before running and
  goes through the same services as the HTTP endpoints, so project access, role and row-level
  security apply exactly as they would in the request. A member who lost access gets a failed job,
  not a file.
- **Files behind an interface.** `FileStore` (put, get, delete) with `LocalFileStore` writing under
  `FILES_DIR`. Metadata, SHA-256, owner, survey, job and an expiry live in `StoredFile`. Export files
  expire after `EXPORT_FILE_TTL_HOURS` (72); documents uploaded for an AI draft after 24 hours.
  Downloads check the member can still see the survey and are audited (`file.download`).
- **Housekeeping** runs hourly in the worker: purge expired files, delete finished jobs older than
  `JOB_RETENTION_DAYS`, and delete delivered or failed webhook deliveries older than
  `WEBHOOK_DELIVERY_RETENTION_DAYS` (closing a known limit from ADR 0011).
- **One process or two.** By default the API runs the worker in-process (`JOB_WORKER=on`), which is
  enough for one machine. `node dist/worker.js` runs jobs, vendor callbacks and webhooks without
  the HTTP server; `docker compose` runs it as the `worker` service with the API's workers turned
  off and a shared files volume.
- Direct exports still work up to `EXPORT_SYNC_MAX_ROWS` (10,000). Above that the endpoint answers
  413 and asks for a background export. QA runs answer in the request up to 2,000 respondents; the
  job takes up to 10,000.

## Consequences

- No new infrastructure; jobs are transactional with the rest of the data and visible with SQL.
- PostgreSQL polling (every `JOB_POLL_MS`, 2 seconds) is fine for hundreds of jobs an hour, not for
  thousands a second. If that changes, the `Job` table can be fed from SQS without changing callers.
- **S3 was not implemented at first** (since Milestone 13 it is: `FILE_STORE=s3`, ADR 0019). `LocalFileStore` needs a disk shared by the API and the worker (a
  volume in compose, EFS on AWS). An `S3FileStore` is the intended production store and plugs in
  behind `FileStore`; until it exists and is tested against a bucket, do not deploy more than one
  host without a shared disk.
- Files are not encrypted by ZAPX at rest; use an encrypted volume (or S3 with SSE once built).
