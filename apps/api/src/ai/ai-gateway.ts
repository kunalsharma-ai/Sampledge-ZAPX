/**
 * AI model gateway. Every AI call in ZAPX goes through `run()`, which applies, in order:
 *
 *   1. provider and model selection per task (configuration only, nothing hardcoded),
 *   2. tenant permissions (AI on/off, allowed tasks),
 *   3. per-tenant rate limits (per minute, per day) and a monthly spend cap,
 *   4. a circuit breaker per provider and model,
 *   5. usage and cost accounting (AiUsage) and an audit event for every call.
 *
 * Retries of transient provider errors happen inside the provider SDK (AI_MAX_RETRIES).
 * Redaction is applied by callers that send user-supplied free text (see redact.ts), because
 * only they know which inputs are data that may contain personal information.
 * The gateway never applies AI output: results are proposals a person reviews (change sets,
 * machine translations).
 */
import { Injectable, Logger } from '@nestjs/common';
import { config, type ModelPrice } from '../config';
import { AuditService } from '../common/audit.service';
import { AiError, AiProvider, type AiTokenUsage } from './ai-provider';
import { notConfigured } from './claude.provider';
import { AiUsageRepository } from './ai-usage.repository';
import { CircuitBreaker } from './circuit-breaker';

export const AI_TASKS = ['architect', 'translate', 'insights'] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface AiActor {
  tenantId: string;
  userId?: string | null;
}

export interface EffectivePolicy {
  enabled: boolean;
  allowedTasks: AiTask[];
  requestsPerMinute: number;
  requestsPerDay: number;
  monthlyBudgetMicroUsd: bigint;
  redactPii: boolean;
  /** True when the tenant has no policy of its own and server defaults apply. */
  isDefault: boolean;
}

/** micro-USD for one call, from the AI_PRICING table (USD per million tokens). */
export function costMicroUsd(price: ModelPrice | undefined, u: AiTokenUsage | undefined): bigint {
  if (!price || !u) return 0n;
  const usd =
    (u.inputTokens * price.input +
      u.outputTokens * price.output +
      (u.cacheReadTokens ?? 0) * (price.cacheRead ?? price.input) +
      (u.cacheWriteTokens ?? 0) * (price.cacheWrite ?? price.input)) /
    1_000_000;
  return BigInt(Math.round(usd * 1_000_000));
}

const startOfMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

@Injectable()
export class AiGateway {
  private readonly log = new Logger('AiGateway');
  readonly breaker: CircuitBreaker;

  constructor(
    private readonly provider: AiProvider,
    private readonly usage: AiUsageRepository,
    private readonly audit: AuditService,
  ) {
    const cfg = config();
    this.breaker = new CircuitBreaker(cfg.AI_BREAKER_FAILURES, cfg.AI_BREAKER_OPEN_MS);
  }

  /** Model for a task: AI_MODEL_<TASK>, else AI_MODEL (the provider's default). */
  modelFor(task: AiTask): string {
    const cfg = config();
    const perTask = { architect: cfg.AI_MODEL_ARCHITECT, translate: cfg.AI_MODEL_TRANSLATE, insights: cfg.AI_MODEL_INSIGHTS }[task];
    return perTask ?? this.provider.model;
  }

  get configured(): boolean {
    return this.provider.configured && AI_TASKS.every((t) => !!this.modelFor(t));
  }

  async policy(tenantId: string): Promise<EffectivePolicy> {
    const p = await this.usage.policy(tenantId);
    const cfg = config();
    if (!p) {
      return {
        enabled: true,
        allowedTasks: [...AI_TASKS],
        requestsPerMinute: cfg.AI_DEFAULT_RPM,
        requestsPerDay: cfg.AI_DEFAULT_RPD,
        monthlyBudgetMicroUsd: 0n,
        redactPii: true,
        isDefault: true,
      };
    }
    return {
      enabled: p.enabled,
      allowedTasks: p.allowedTasks.filter((t): t is AiTask => (AI_TASKS as readonly string[]).includes(t)),
      requestsPerMinute: p.requestsPerMinute,
      requestsPerDay: p.requestsPerDay,
      monthlyBudgetMicroUsd: p.monthlyBudgetMicroUsd,
      redactPii: p.redactPii,
      isDefault: false,
    };
  }

  /** What the studio needs to know to enable or explain AI features. */
  async status(tenantId: string) {
    const policy = await this.policy(tenantId);
    const tasks = Object.fromEntries(
      AI_TASKS.map((t) => [t, { model: this.modelFor(t) || null, permitted: policy.enabled && policy.allowedTasks.includes(t) }]),
    );
    return {
      configured: this.configured,
      provider: this.provider.name,
      model: this.provider.model || null,
      tasks,
      redactPii: policy.redactPii,
    };
  }

  /** Throws before calling the provider when the call is not allowed. Records the refusal. */
  async admit(task: AiTask, actor: AiActor, surveyId?: string): Promise<{ model: string; policy: EffectivePolicy }> {
    const model = this.modelFor(task);
    if (!this.provider.configured || !model) throw notConfigured();
    const policy = await this.policy(actor.tenantId);
    const deny = async (outcome: string, err: AiError) => {
      await this.ledger(task, actor, model, outcome, err.code, undefined, 0, surveyId, 0);
      throw err;
    };
    if (await this.usage.blocksExternal(actor.tenantId)) {
      await deny(
        'not_permitted',
        new AiError(
          'Your organization keeps data inside this deployment, so AI (an outside service) is turned off. An administrator can change this in Data governance.',
          403,
          'BLOCKED_BY_RESIDENCY',
        ),
      );
    }
    if (!policy.enabled || !policy.allowedTasks.includes(task)) {
      await deny(
        'not_permitted',
        new AiError(
          'AI is turned off for this task in your organization. An administrator can change this in AI settings.',
          403,
          'NOT_PERMITTED',
        ),
      );
    }
    const now = Date.now();
    if (policy.requestsPerMinute > 0 && (await this.usage.countSince(actor.tenantId, new Date(now - 60_000))) >= policy.requestsPerMinute) {
      await deny(
        'rate_limited',
        new AiError('Your organization has reached its AI requests per minute. Try again in a minute.', 429, 'RATE_LIMITED'),
      );
    }
    if (policy.requestsPerDay > 0 && (await this.usage.countSince(actor.tenantId, new Date(now - 86_400_000))) >= policy.requestsPerDay) {
      await deny('rate_limited', new AiError('Your organization has reached its AI requests for today.', 429, 'RATE_LIMITED'));
    }
    if (policy.monthlyBudgetMicroUsd > 0n && (await this.usage.costSince(actor.tenantId, startOfMonth())) >= policy.monthlyBudgetMicroUsd) {
      await deny(
        'budget_exceeded',
        new AiError(
          "Your organization has used this month's AI budget. An administrator can raise it in AI settings.",
          429,
          'BUDGET_EXCEEDED',
        ),
      );
    }
    if (!this.breaker.allow(this.breakerKey(model))) {
      await deny(
        'circuit_open',
        new AiError(
          'The AI service is failing right now, so ZAPX paused AI requests for a minute. Try again shortly.',
          503,
          'CIRCUIT_OPEN',
        ),
      );
    }
    return { model, policy };
  }

  /**
   * Run one AI call for a task. `call` receives the model to use and must return the served
   * model and token usage, which are recorded with the cost.
   */
  async run<T extends { model: string; usage?: AiTokenUsage }>(
    task: AiTask,
    actor: AiActor,
    call: (model: string, policy: EffectivePolicy) => Promise<T>,
    opts: { surveyId?: string; redactions?: number; admitted?: { model: string; policy: EffectivePolicy } } = {},
  ): Promise<T> {
    const { model, policy } = opts.admitted ?? (await this.admit(task, actor, opts.surveyId));
    const started = Date.now();
    try {
      const result = await call(model, policy);
      this.breaker.success(this.breakerKey(model));
      await this.ledger(
        task,
        actor,
        result.model || model,
        'ok',
        null,
        result.usage,
        Date.now() - started,
        opts.surveyId,
        opts.redactions ?? 0,
      );
      return result;
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('The AI service could not be reached. Try again shortly.', 503, 'UNAVAILABLE');
      if (err.code === 'UNAVAILABLE' || err.code === 'RATE_LIMITED') this.breaker.failure(this.breakerKey(model));
      await this.ledger(
        task,
        actor,
        model,
        err.code === 'REFUSED' ? 'refused' : 'error',
        err.code,
        undefined,
        Date.now() - started,
        opts.surveyId,
        opts.redactions ?? 0,
      );
      throw err;
    }
  }

  private breakerKey(model: string) {
    return `${this.provider.name}:${model}`;
  }

  private async ledger(
    task: AiTask,
    actor: AiActor,
    model: string,
    outcome: string,
    errorCode: string | null,
    u: AiTokenUsage | undefined,
    latencyMs: number,
    surveyId: string | undefined,
    redactions: number,
  ) {
    try {
      const row = await this.usage.record({
        tenantId: actor.tenantId,
        userId: actor.userId ?? null,
        task,
        provider: this.provider.name,
        model,
        outcome,
        errorCode,
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
        cacheReadTokens: u?.cacheReadTokens ?? 0,
        cacheWriteTokens: u?.cacheWriteTokens ?? 0,
        costMicroUsd: costMicroUsd(config().AI_PRICING[model], u),
        latencyMs,
        surveyId: surveyId ?? null,
        redactions,
      });
      await this.audit.record({ tenantId: actor.tenantId, id: actor.userId ?? null }, `ai.${task}.${outcome}`, 'ai_usage', row.id, {
        model,
        surveyId: surveyId ?? null,
        errorCode,
      });
    } catch (e) {
      this.log.error(`Could not record AI usage: ${(e as Error).message}`);
    }
  }
}
