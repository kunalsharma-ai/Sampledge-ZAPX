/**
 * Background work of the integration module, run in-process on a timer:
 *   1. deliver due callbacks from the outbox (retries with backoff, dead letter),
 *   2. record stale unfinished interviews as partial and queue their callbacks.
 *
 * Safe with several API instances: callbacks are claimed with FOR UPDATE SKIP LOCKED and a
 * lease, and the partial sweep uses a conditional update. On AWS the same runOnce() can be
 * driven by a dedicated worker task or an SQS consumer instead (docs/adr/0005-aws-deployment.md).
 */
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { OutboundCallback } from '@zapx/db';
import { adapterFor, retryDelayMs, DEFAULT_RETRY_POLICY, type PlannedCallback } from '@zapx/redirect-core';
import { config } from '../config';
import { SecretBox } from '../platform/secret-box';
import { toIntegrationConfig } from './integration-config';
import { RedirectRepository } from './redirect.repository';
import { RedirectService } from './redirect.service';
import { HttpDelivery } from './http-delivery';

const LEASE_MS = 120_000;
const BATCH = 25;

export interface WorkerRun {
  delivered: number;
  retrying: number;
  failed: number;
  dead: number;
  abandoned: number;
}

@Injectable()
export class CallbackWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Callbacks');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<WorkerRun> | null = null;

  constructor(
    private readonly repo: RedirectRepository,
    private readonly redirects: RedirectService,
    private readonly http: HttpDelivery,
    private readonly box: SecretBox,
  ) {}

  onApplicationBootstrap() {
    const cfg = config();
    if (cfg.CALLBACK_WORKER !== 'on') return;
    this.timer = setInterval(
      () => void this.runOnce().catch((e) => this.log.error(`Worker run failed: ${(e as Error).message}`)),
      cfg.CALLBACK_POLL_MS,
    );
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  /** One pass. Concurrent calls share the pass in progress. */
  runOnce(): Promise<WorkerRun> {
    if (!this.running) {
      this.running = this.pass().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async pass(): Promise<WorkerRun> {
    const run: WorkerRun = { delivered: 0, retrying: 0, failed: 0, dead: 0, abandoned: 0 };
    const cutoff = new Date(Date.now() - config().ABANDON_AFTER_MINUTES * 60_000);
    for (const r of await this.repo.abandonStale(cutoff, 200)) {
      run.abandoned++;
      await this.redirects.outcomeRecorded(r, 'partial');
    }
    for (let round = 0; round < 4; round++) {
      const due = await this.repo.claimDue(BATCH, LEASE_MS);
      if (due.length === 0) break;
      for (const cb of due) run[await this.deliver(cb)]++;
    }
    return run;
  }

  private async deliver(cb: OutboundCallback): Promise<'delivered' | 'retrying' | 'failed' | 'dead'> {
    const ctx = await this.repo.vendorContext(cb.vendorId);
    const now = new Date();
    const finish = async (
      state: OutboundCallback['state'],
      httpStatus: number | null,
      error: string | null,
      ms: number,
      next: Date | null = null,
    ) => {
      await this.repo.saveAttempt(cb, {
        state,
        httpStatus,
        error,
        nextAttemptAt: next,
        log: { at: now.toISOString(), httpStatus, error, ms },
      });
    };
    if (!ctx) {
      await finish('FAILED', null, 'vendor no longer exists', 0);
      return 'failed';
    }
    const cfg = toIntegrationConfig(ctx.vendor, ctx.project, ctx.tenant, this.box);
    if (cfg.kind !== cb.integration) {
      await finish('FAILED', null, `vendor integration changed to ${cfg.kind}`, 0);
      return 'failed';
    }
    if (cfg.kind === 'PROJEXA' && !cfg.clientSecret) {
      await finish('FAILED', null, 'PROJEXA client secret is missing or cannot be decrypted', 0);
      return 'failed';
    }
    const adapter = adapterFor(cfg);
    const planned: PlannedCallback = {
      method: cb.method as PlannedCallback['method'],
      url: cb.url,
      payload: cb.payload as Record<string, string> | null,
    };
    const spec = adapter.prepare(cfg, planned, cb.idempotencyKey, now.getTime());
    const result = await this.http.send(spec);
    const verdict = result.permanent ? 'permanent' : adapter.classify(result.httpStatus);

    if (verdict === 'delivered') {
      await finish('DELIVERED', result.httpStatus, null, result.ms);
      return 'delivered';
    }
    if (verdict === 'permanent' || verdict === 'conflict') {
      const error = verdict === 'conflict' ? 'conflict: the partner already recorded a different status' : result.error;
      await finish('FAILED', result.httpStatus, error, result.ms);
      this.log.warn(`Callback ${cb.id} failed permanently: ${error}`);
      return 'failed';
    }
    const attempts = cb.attempts + 1;
    if (attempts >= cb.maxAttempts) {
      await finish('DEAD', result.httpStatus, result.error, result.ms);
      this.log.warn(`Callback ${cb.id} dead-lettered after ${attempts} attempts: ${result.error}`);
      return 'dead';
    }
    const next = new Date(Date.now() + retryDelayMs(attempts, { ...DEFAULT_RETRY_POLICY, maxAttempts: cb.maxAttempts }));
    await finish('PENDING', result.httpStatus, result.error, result.ms, next);
    return 'retrying';
  }
}
