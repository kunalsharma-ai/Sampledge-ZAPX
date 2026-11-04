/**
 * The job worker (Milestone 7): runs exports, large QA runs and AI drafts outside web requests.
 *
 * It runs in-process when JOB_WORKER=on (the default, for simple local setups) and in its own
 * process with `node dist/worker.js` (docker compose and production, with JOB_WORKER=off on the
 * API). Jobs are claimed with FOR UPDATE SKIP LOCKED and a lease that progress updates extend, so
 * several workers can run, and a job whose worker died is picked up again once its lease expires.
 * The same pass does housekeeping once an hour: expired files, old jobs, old webhook deliveries.
 */
import { HttpException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Job, Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { CaptureService } from '../captures/capture.service';
import { TranscriptionError, TranscriptionService } from '../captures/transcription.service';
import { TelephonyService } from '../cati/telephony.service';
import { config } from '../config';
import type { AuthUser } from '../auth/auth.types';
import { AiError, type AiDocument } from '../ai/ai-provider';
import { ProposeService } from '../ai/propose.service';
import { notConfigured } from '../ai/claude.provider';
import { ExportRunner, type ExportOptions } from '../exports/export-runner.service';
import { QaService, type QaRunInput } from '../qa/qa.service';
import { FilesService } from './files.service';
import { JOB_TYPES } from './jobs.service';
import { DistributionService } from '../distribution/distribution.service';

const LEASE_MS = 5 * 60_000;
const RETRY_DELAY_MS = 30_000;
const HOUSEKEEPING_MS = 60 * 60_000;

class JobCancelled extends Error {}
/** A failure retrying cannot fix (bad input, no access, AI refused). Shown to the member as is. */
class JobFailed extends Error {}

export interface JobContext {
  job: Job;
  user: AuthUser;
  progress(percent: number, note?: string): Promise<void>;
}

export interface WorkerPass {
  succeeded: number;
  failed: number;
  retrying: number;
  cancelled: number;
}

@Injectable()
export class JobWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<WorkerPass> | null = null;
  private lastHousekeeping = 0;
  readonly workerId = `w-${randomBytes(4).toString('hex')}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly exports: ExportRunner,
    private readonly qa: QaService,
    private readonly proposer: ProposeService,
    private readonly captures: CaptureService,
    private readonly transcription: TranscriptionService,
    private readonly telephony: TelephonyService,
    private readonly distribution: DistributionService,
  ) {}

  onApplicationBootstrap() {
    if (config().JOB_WORKER !== 'on') return;
    this.start();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(
      () => void this.runOnce().catch((e) => this.log.error(`Job pass failed: ${(e as Error).message}`)),
      config().JOB_POLL_MS,
    );
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  /** One pass. Concurrent calls share the pass in progress. */
  runOnce(): Promise<WorkerPass> {
    if (!this.running) {
      this.running = this.pass().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async pass(): Promise<WorkerPass> {
    const out: WorkerPass = { succeeded: 0, failed: 0, retrying: 0, cancelled: 0 };
    for (let i = 0; i < 20; i++) {
      const job = await this.claim();
      if (!job) break;
      out[await this.execute(job)]++;
    }
    // Blueprint phase 3: scheduled invitation emails and reminders.
    await this.distribution.pass().catch((e) => this.log.error(`Email pass failed: ${(e as Error).message}`));
    if (Date.now() - this.lastHousekeeping > HOUSEKEEPING_MS) {
      this.lastHousekeeping = Date.now();
      await this.housekeeping().catch((e) => this.log.error(`Housekeeping failed: ${(e as Error).message}`));
    }
    return out;
  }

  /** Job types this process can run: a worker without a speech provider leaves transcription to one that has it. */
  private handledTypes(): string[] {
    return JOB_TYPES.filter((t) => t !== 'transcribe' || !!this.transcription.current());
  }

  private async claim(): Promise<Job | null> {
    const types = this.handledTypes();
    const [job] = await this.prisma.$queryRaw<Job[]>`
      UPDATE "Job" SET status = 'RUNNING', attempts = attempts + 1, "lockedUntil" = now() + (${LEASE_MS} * interval '1 millisecond'),
        "startedAt" = COALESCE("startedAt", now()), "progressNote" = 'Started', "updatedAt" = now()
      WHERE id = (
        SELECT id FROM "Job"
        WHERE ((status = 'QUEUED' AND "runAfter" <= now()) OR (status = 'RUNNING' AND "lockedUntil" < now()))
          AND "type" = ANY(${types})
        ORDER BY "runAfter" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    return job ?? null;
  }

  private async finish(job: Job, data: Prisma.JobUpdateInput) {
    await this.prisma.job.update({ where: { id: job.id }, data: { ...data, lockedUntil: null } });
  }

  private async execute(job: Job): Promise<keyof WorkerPass> {
    // attempts was incremented by the claim; more than maxAttempts means earlier workers died mid-run.
    if (job.attempts > job.maxAttempts) {
      await this.finish(job, { status: 'FAILED', error: 'The job stopped unexpectedly several times.', finishedAt: new Date() });
      return 'failed';
    }
    try {
      const user = await this.memberOf(job);
      let lastWrite = 0;
      const ctx: JobContext = {
        job,
        user,
        progress: async (percent, note) => {
          const p = Math.max(0, Math.min(99, Math.round(percent)));
          if (Date.now() - lastWrite < 500 && p < 99) return;
          lastWrite = Date.now();
          const cur = await this.prisma.job.update({
            where: { id: job.id },
            data: { progress: p, ...(note ? { progressNote: note } : {}), lockedUntil: new Date(Date.now() + LEASE_MS) },
            select: { cancelRequested: true },
          });
          if (cur.cancelRequested) throw new JobCancelled();
        },
      };
      if ((await this.prisma.job.findUniqueOrThrow({ where: { id: job.id }, select: { cancelRequested: true } })).cancelRequested)
        throw new JobCancelled();
      const result = await this.handle(ctx);
      await this.finish(job, {
        status: 'SUCCEEDED',
        progress: 100,
        progressNote: 'Done',
        result: result as Prisma.InputJsonValue,
        error: null,
        finishedAt: new Date(),
      });
      return 'succeeded';
    } catch (e) {
      if (e instanceof JobCancelled) {
        await this.finish(job, { status: 'CANCELLED', progressNote: 'Cancelled', finishedAt: new Date() });
        return 'cancelled';
      }
      const known = e instanceof JobFailed || e instanceof HttpException || e instanceof AiError;
      const message = known ? messageOf(e) : `Unexpected error (reference ${job.id.slice(-8)}). It was logged.`;
      if (!known) this.log.error(`Job ${job.id} (${job.type}) failed: ${(e as Error).stack ?? e}`);
      if (!known && job.attempts < job.maxAttempts) {
        await this.finish(job, {
          status: 'QUEUED',
          error: message,
          progressNote: 'Will retry',
          runAfter: new Date(Date.now() + RETRY_DELAY_MS),
        });
        return 'retrying';
      }
      await this.finish(job, { status: 'FAILED', error: message.slice(0, 1000), finishedAt: new Date() });
      return 'failed';
    }
  }

  /** The member the job runs as, with their current role and project access. */
  private async memberOf(job: Job): Promise<AuthUser> {
    const u = await this.prisma.user.findUnique({
      where: { id: job.createdById },
      select: { id: true, tenantId: true, role: true, email: true, projectScope: true },
    });
    if (!u || u.tenantId !== job.tenantId || u.role === 'INTERVIEWER')
      throw new JobFailed('The member who started this job no longer has access.');
    if (job.type !== 'export' && u.role === 'VIEWER') throw new JobFailed('The member who started this job can no longer edit surveys.');
    return u;
  }

  private async handle(ctx: JobContext): Promise<Record<string, unknown>> {
    const { job, user } = ctx;
    const surveyId = job.surveyId!;
    switch (job.type) {
      case 'export': {
        const opts = job.input as unknown as ExportOptions;
        await ctx.progress(1, 'Reading responses');
        const out = await this.exports.build(user, surveyId, opts, {
          via: `job:${job.id}`,
          onProgress: (done, total) => ctx.progress(total ? (done / total) * 80 : 80, `Read ${done} of ${total} responses`),
        });
        await ctx.progress(90, 'Saving the file');
        const file = await this.files.save({
          tenantId: job.tenantId,
          surveyId,
          jobId: job.id,
          purpose: 'export',
          name: out.name,
          contentType: out.contentType,
          data: out.data,
          ttlMs: config().EXPORT_FILE_TTL_HOURS * 3_600_000,
          createdById: user.id,
        });
        return {
          fileId: file.id,
          name: file.name,
          size: file.size,
          rows: out.rows,
          format: opts.format,
          expiresAt: file.expiresAt.toISOString(),
        };
      }
      case 'qa_run': {
        const input = job.input as unknown as QaRunInput;
        await ctx.progress(5, `Simulating ${input.respondents} respondents`);
        const run = await this.qa.run(user, surveyId, input, { via: `job:${job.id}` });
        return {
          runId: run.id,
          version: run.version,
          passed: run.report.passed,
          coverage: run.report.coverage.percent,
          respondents: run.report.respondents,
        };
      }
      case 'ai_propose': {
        if (!this.proposer.configured) throw new JobFailed(notConfigured().message);
        const input = job.input as { instruction: string; documentFileId?: string; fileName?: string };
        const documents: AiDocument[] = [];
        if (input.documentFileId) {
          const { data } = await this.files.read(job.tenantId, input.documentFileId).catch(() => {
            throw new JobFailed('The attached document has expired. Start the AI draft again.');
          });
          documents.push(JSON.parse(data.toString('utf8')) as AiDocument);
        }
        await ctx.progress(10, 'The AI is drafting');
        const cs = await this.proposer.propose(user, surveyId, { instruction: input.instruction, documents, fileName: input.fileName });
        return { changeSetId: cs.id, title: cs.title };
      }
      case 'transcribe': {
        // Recordings of this survey without a transcript, or the ones asked for (Milestone 17).
        if (!this.transcription.current()) throw new JobFailed('Transcription is not turned on for this installation.');
        const input = job.input as { captureIds?: string[] };
        const todo = await this.prisma.capture.findMany({
          where: {
            tenantId: job.tenantId,
            surveyId,
            kind: 'audio',
            deletedAt: null,
            responseId: { not: null },
            ...(input.captureIds?.length ? { id: { in: input.captureIds } } : { transcribedAt: null }),
          },
          orderBy: { createdAt: 'asc' },
          take: TRANSCRIBE_PER_JOB,
          select: { id: true },
        });
        let done = 0;
        const failed: Array<{ id: string; reason: string }> = [];
        for (const [i, c] of todo.entries()) {
          await ctx.progress((i / Math.max(1, todo.length)) * 100, `Transcribing recording ${i + 1} of ${todo.length}`);
          try {
            await this.transcription.transcribe(job.tenantId, c.id);
            done++;
          } catch (e) {
            if (!(e instanceof TranscriptionError)) throw e;
            failed.push({ id: c.id, reason: e.message });
          }
        }
        if (todo.length && !done) throw new JobFailed(failed[0]?.reason ?? 'No recording could be transcribed');
        return { transcribed: done, failed: failed.length, failures: failed.slice(0, 20), remaining: todo.length === TRANSCRIBE_PER_JOB };
      }
      default:
        throw new JobFailed(`Unknown job type ${job.type}`);
    }
  }

  /** Delete expired files, old finished jobs, old webhook deliveries and photos and recordings past CAPTURE_RETENTION_DAYS. */
  async housekeeping() {
    const cfg = config();
    const files = await this.files.purgeExpired();
    const jobCutoff = new Date(Date.now() - cfg.JOB_RETENTION_DAYS * 86_400_000);
    const jobs = await this.prisma.job.deleteMany({
      where: { status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] }, finishedAt: { lt: jobCutoff } },
    });
    const hookCutoff = new Date(Date.now() - cfg.WEBHOOK_DELIVERY_RETENTION_DAYS * 86_400_000);
    const deliveries = await this.prisma.webhookDelivery.deleteMany({
      where: { state: { in: ['DELIVERED', 'FAILED', 'DEAD'] }, createdAt: { lt: hookCutoff } },
    });
    const captures = await this.captures.purgeExpired();
    // Unfinished SAML sign-ins (Milestone 13) and applied billing events older than 90 days.
    const ssoRequests = await this.prisma.ssoRequest.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.billingEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
    // Dialer call recordings (Milestone 19) that could not be copied from the provider yet.
    const callRecordings = await this.telephony.retryRecordings();
    const out = { files, jobs: jobs.count, webhookDeliveries: deliveries.count, captures, ssoRequests: ssoRequests.count, callRecordings };
    if (files || jobs.count || deliveries.count || captures || ssoRequests.count || callRecordings)
      this.log.log(`Housekeeping removed ${JSON.stringify(out)}`);
    return out;
  }
}

/** Recordings one transcription job handles; start another for the rest. */
const TRANSCRIBE_PER_JOB = 200;

function messageOf(e: unknown): string {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    if (typeof r === 'string') return r;
    const m = (r as { message?: string | string[] }).message;
    return Array.isArray(m) ? m.join(', ') : (m ?? e.message);
  }
  return (e as Error).message;
}
