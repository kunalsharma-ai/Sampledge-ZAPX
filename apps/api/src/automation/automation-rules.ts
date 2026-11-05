/**
 * Blueprint phase 5: the automation rule language. Pure functions (no database), so the rules,
 * conditions and schedules are tested on their own.
 *
 * A rule is: trigger (a survey event or a schedule) → conditions (all must hold) → actions. Events
 * are the webhook events, so an automation sees exactly what a webhook receiver would. Conditions
 * read the event's fields (`event.status`) or the survey's live numbers (`metrics.completes`).
 */
import { z } from 'zod';

export const RULE_EVENTS = [
  'response.finished',
  'response.review_decided',
  'quota.full',
  'survey.published',
  'survey.status_changed',
] as const;
export const TRIGGERS = [...RULE_EVENTS, 'schedule'] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** Survey numbers a condition can test. Computed only when a condition needs them. */
export const METRICS = [
  'completes',
  'completesToday',
  'terminates',
  'quotaFulls',
  'qualityFails',
  /** completes / (completes + terminates + quota fulls), 0-100. */
  'incidence',
  /** quality fails / (completes + quality fails), 0-100. */
  'qualityFailRate',
  /** Hours since the last complete (large when there is none). */
  'hoursSinceLastComplete',
] as const;
export type Metric = (typeof METRICS)[number];

export const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const;
export type Op = (typeof OPS)[number];

const FIELD = /^(event\.[A-Za-z][A-Za-z0-9_]{0,39}|metrics\.[A-Za-z]+)$/;

export const conditionSchema = z
  .object({
    field: z.string().regex(FIELD, 'A condition field is event.<name> or metrics.<name>'),
    op: z.enum(OPS),
    value: z.union([z.number(), z.string().max(200), z.boolean()]),
  })
  .refine((c) => !c.field.startsWith('metrics.') || (METRICS as readonly string[]).includes(c.field.slice(8)), {
    message: `Survey numbers are: ${METRICS.join(', ')}`,
  });
export type Condition = z.infer<typeof conditionSchema>;

export const AUDIENCES = ['admins', 'project_team', 'rule_owner'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify'), to: z.enum(AUDIENCES), message: z.string().trim().max(500).optional() }),
  z.object({ type: z.literal('email'), to: z.enum(AUDIENCES), message: z.string().trim().max(2000).optional() }),
  /** Sends the signed `automation.fired` webhook event to subscribed receivers. */
  z.object({ type: z.literal('webhook') }),
  z.object({ type: z.literal('set_survey_status'), status: z.enum(['LIVE', 'PAUSED', 'CLOSED']) }),
]);
export type Action = z.infer<typeof actionSchema>;

export const scheduleSchema = z
  .object({
    every: z.enum(['hour', 'day', 'week']),
    at: z
      .string()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM (24 hours, UTC)')
      .optional(),
    weekday: z.number().int().min(0).max(6).optional(),
  })
  .refine((s) => s.every !== 'week' || s.weekday !== undefined, { message: 'A weekly schedule needs a weekday' });
export type Schedule = z.infer<typeof scheduleSchema>;

export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(true),
    surveyId: z.string().max(64).nullable().default(null),
    trigger: z.enum(TRIGGERS),
    schedule: scheduleSchema.nullable().default(null),
    conditions: z.array(conditionSchema).max(10).default([]),
    actions: z.array(actionSchema).min(1).max(5),
    requiresApproval: z.boolean().default(false),
    cooldownMinutes: z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 7)
      .default(0),
  })
  .superRefine((r, ctx) => {
    if (r.trigger === 'schedule' && !r.schedule)
      ctx.addIssue({ code: 'custom', path: ['schedule'], message: 'Say when the schedule runs' });
    if (r.trigger === 'schedule' && !r.surveyId)
      ctx.addIssue({ code: 'custom', path: ['surveyId'], message: 'A scheduled rule watches one survey' });
    if (r.trigger === 'schedule' && r.conditions.some((c) => c.field.startsWith('event.')))
      ctx.addIssue({ code: 'custom', path: ['conditions'], message: 'A schedule has no event; test survey numbers (metrics.*)' });
    if (r.actions.some((a) => a.type === 'set_survey_status') && !r.surveyId)
      ctx.addIssue({ code: 'custom', path: ['actions'], message: 'Changing a survey status needs the rule to watch one survey' });
  });
export type RuleInput = z.infer<typeof ruleSchema>;

export interface ConditionResult {
  condition: Condition;
  actual: unknown;
  ok: boolean;
}

function compare(actual: unknown, op: Op, expected: number | string | boolean): boolean {
  if (actual === undefined || actual === null) return op === 'ne';
  if (typeof expected === 'number') {
    const a = typeof actual === 'number' ? actual : Number(actual);
    if (!Number.isFinite(a)) return op === 'ne';
    switch (op) {
      case 'eq':
        return a === expected;
      case 'ne':
        return a !== expected;
      case 'gt':
        return a > expected;
      case 'gte':
        return a >= expected;
      case 'lt':
        return a < expected;
      case 'lte':
        return a <= expected;
    }
  }
  // Text and yes/no compare case-insensitively; only eq and ne apply.
  const a = String(actual).toLowerCase();
  const e = String(expected).toLowerCase();
  if (op === 'eq') return a === e;
  if (op === 'ne') return a !== e;
  return false;
}

/** Evaluate every condition (no short-circuit, so the run log shows each value seen). */
export function evaluateConditions(
  conditions: Condition[],
  event: Record<string, unknown>,
  metrics: Partial<Record<Metric, number>>,
): { ok: boolean; results: ConditionResult[] } {
  const results = conditions.map((condition) => {
    const [scope, key] = [condition.field.slice(0, condition.field.indexOf('.')), condition.field.slice(condition.field.indexOf('.') + 1)];
    const actual = scope === 'event' ? event[key] : metrics[key as Metric];
    return { condition, actual, ok: compare(actual, condition.op, condition.value) };
  });
  return { ok: results.every((r) => r.ok), results };
}

/** The survey numbers the conditions read (so the runner only queries what it needs). */
export function metricsNeeded(conditions: Condition[]): Metric[] {
  return [...new Set(conditions.filter((c) => c.field.startsWith('metrics.')).map((c) => c.field.slice(8) as Metric))];
}

export function computeMetrics(
  counts: { completes: number; completesToday: number; terminates: number; quotaFulls: number; qualityFails: number },
  lastCompleteAt: Date | null,
  now: Date,
): Record<Metric, number> {
  const screened = counts.completes + counts.terminates + counts.quotaFulls;
  const judged = counts.completes + counts.qualityFails;
  return {
    ...counts,
    incidence: screened ? Math.round((1000 * counts.completes) / screened) / 10 : 0,
    qualityFailRate: judged ? Math.round((1000 * counts.qualityFails) / judged) / 10 : 0,
    hoursSinceLastComplete: lastCompleteAt ? Math.floor((now.getTime() - lastCompleteAt.getTime()) / 3_600_000) : 100_000,
  };
}

/** The first run of a schedule strictly after `after` (UTC). */
export function nextRun(schedule: Schedule, after: Date): Date {
  const [h, m] = (schedule.at ?? '00:00').split(':').map(Number) as [number, number];
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  if (schedule.every === 'hour') {
    t.setUTCMinutes(m);
    if (t <= after) t.setUTCHours(t.getUTCHours() + 1);
    return t;
  }
  t.setUTCHours(h, m);
  if (schedule.every === 'day') {
    if (t <= after) t.setUTCDate(t.getUTCDate() + 1);
    return t;
  }
  const ahead = (schedule.weekday! - t.getUTCDay() + 7) % 7;
  t.setUTCDate(t.getUTCDate() + ahead);
  if (t <= after) t.setUTCDate(t.getUTCDate() + 7);
  return t;
}

const OP_TEXT: Record<Op, string> = { eq: 'is', ne: 'is not', gt: 'is above', gte: 'is at least', lt: 'is below', lte: 'is at most' };

/** Plain-language description of a rule, shown in the studio and in notifications. */
export function describeRule(r: Pick<RuleInput, 'trigger' | 'schedule' | 'conditions' | 'actions' | 'requiresApproval'>): string {
  const when =
    r.trigger === 'schedule' && r.schedule
      ? r.schedule.every === 'hour'
        ? `Every hour at :${(r.schedule.at ?? '00:00').slice(3)}`
        : r.schedule.every === 'day'
          ? `Every day at ${r.schedule.at ?? '00:00'} UTC`
          : `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][r.schedule.weekday ?? 0]} at ${r.schedule.at ?? '00:00'} UTC`
      : `When ${r.trigger}`;
  const ifs = r.conditions.length ? `, if ${r.conditions.map((c) => `${c.field} ${OP_TEXT[c.op]} ${String(c.value)}`).join(' and ')}` : '';
  const acts = r.actions
    .map((a) =>
      a.type === 'notify'
        ? `notify ${a.to.replace('_', ' ')}`
        : a.type === 'email'
          ? `email ${a.to.replace('_', ' ')}`
          : a.type === 'webhook'
            ? 'send the automation.fired webhook'
            : `set the survey to ${a.status.toLowerCase()}`,
    )
    .join(', ');
  return `${when}${ifs}: ${acts}${r.requiresApproval ? ' (after an administrator approves)' : ''}.`;
}

/** Readable summary of the event that fired a rule. */
export function describeEvent(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case 'response.finished':
      return `A respondent finished as ${String(data.status ?? 'unknown')}${data.vendor ? ` (source ${String(data.vendor)})` : ''}.`;
    case 'response.review_decided':
      return `A quality review was decided: ${String(data.decision ?? '')}.`;
    case 'quota.full':
      return `Quota ${String(data.label ?? data.quotaId ?? '')} is full (${String(data.count ?? '')} of ${String(data.target ?? '')}).`;
    case 'survey.published':
      return `Version ${String(data.version ?? '')} was published.`;
    case 'survey.status_changed':
      return `The survey went from ${String(data.from ?? '').toLowerCase()} to ${String(data.to ?? '').toLowerCase()}.`;
    case 'schedule':
      return 'Scheduled check.';
    default:
      return event;
  }
}
