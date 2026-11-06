/**
 * Super admin automation: simple "when this happens to an organization, do these things" rules.
 * Each trigger is checked against every organization on a schedule; a firing is recorded with a
 * dedupe key (for example the organization and the subscription end date) so it happens once.
 */
import { z } from 'zod';
import { isFeatureKey } from './features';
import { STATUSES } from './super-admin.schemas';

export const TRIGGERS = {
  org_created: {
    label: 'A new organization is registered',
    help: 'Organizations created after the rule was made.',
    params: [],
  },
  subscription_ending: {
    label: 'A subscription is about to end',
    help: 'The end date is within the next N days.',
    params: ['days', 'status'],
  },
  subscription_ended: {
    label: 'A subscription has ended',
    help: 'The end date has passed.',
    params: ['status'],
  },
  completes_used: {
    label: 'Monthly completes reach a share of the plan',
    help: 'Completed interviews this month reach N% of the plan limit.',
    params: ['percent'],
  },
  seats_full: {
    label: 'All team seats are taken',
    help: 'Active members reach the plan seat limit.',
    params: [],
  },
  admins_inactive: {
    label: 'Administrators have been inactive',
    help: 'No administrator of the organization signed in for N days.',
    params: ['days'],
  },
} as const;
export type TriggerKey = keyof typeof TRIGGERS;
export const TRIGGER_KEYS = Object.keys(TRIGGERS) as TriggerKey[];

export const paramsSchema = z
  .object({
    days: z.number().int().min(1).max(365).optional(),
    percent: z.number().int().min(1).max(100).optional(),
    /** Only organizations whose subscription has this status (e.g. trialing). */
    status: z.enum(STATUSES).optional(),
  })
  .default({});
export type TriggerParams = z.infer<typeof paramsSchema>;

const text = z.string().max(1000);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify_super_admins'), message: text.default('') }),
  z.object({ type: z.literal('email_org_admins'), subject: z.string().max(200).default(''), message: text.default('') }),
  z.object({ type: z.literal('change_plan'), plan: z.string().min(1).max(40) }),
  z.object({
    type: z.literal('set_subscription'),
    status: z.enum(STATUSES).optional(),
    /** Move the end date this many days later (from today when it has passed or is not set). */
    extendDays: z.number().int().min(1).max(3650).optional(),
    /** Remove the end date. */
    clearEnd: z.boolean().optional(),
  }),
  z.object({ type: z.literal('suspend_org'), reason: z.string().max(500).default('') }),
  z.object({ type: z.literal('reactivate_org') }),
  z.object({
    type: z.literal('set_feature'),
    feature: z.string().refine(isFeatureKey, 'Unknown feature'),
    surface: z.enum(['web', 'mobile', 'both']).default('both'),
    on: z.boolean(),
  }),
]);
export type PlatformAction = z.infer<typeof actionSchema>;

export const ACTION_LABELS: Record<PlatformAction['type'], string> = {
  notify_super_admins: 'Notify super admins',
  email_org_admins: "Email the organization's administrators",
  change_plan: 'Change plan',
  set_subscription: 'Change subscription status or end date',
  suspend_org: 'Suspend the organization',
  reactivate_org: 'Reactivate the organization',
  set_feature: 'Switch a feature on or off',
};

export const automationSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  trigger: z.enum(TRIGGER_KEYS as [TriggerKey, ...TriggerKey[]]),
  params: paramsSchema,
  actions: z.array(actionSchema).min(1).max(10),
});
export type AutomationInput = z.infer<typeof automationSchema>;

/** Ready-made rules the super admin adds with one click (and can change afterwards). */
export const TEMPLATES: Array<{ id: string; description: string; rule: AutomationInput }> = [
  {
    id: 'warn-before-end',
    description: 'Seven days before a subscription ends, tell the super admins and email the organization’s administrators.',
    rule: {
      name: 'Warn 7 days before a subscription ends',
      enabled: true,
      trigger: 'subscription_ending',
      params: { days: 7 },
      actions: [
        { type: 'notify_super_admins', message: '{organization}: the {plan} subscription ends on {endsAt}.' },
        {
          type: 'email_org_admins',
          subject: 'Your SampCode subscription ends soon',
          message: 'Hello, the {plan} subscription of {organization} ends on {endsAt}. Contact us to renew it.',
        },
      ],
    },
  },
  {
    id: 'expire-and-suspend',
    description: 'When a paid subscription ends, mark it expired and suspend the organization until it renews.',
    rule: {
      name: 'Expire and suspend when a subscription ends',
      enabled: true,
      trigger: 'subscription_ended',
      params: { status: 'active' },
      actions: [
        { type: 'set_subscription', status: 'expired' },
        { type: 'suspend_org', reason: 'Subscription ended' },
        { type: 'notify_super_admins', message: '{organization} was suspended: its {plan} subscription ended.' },
      ],
    },
  },
  {
    id: 'trial-start',
    description: 'Every new organization starts a 14-day trial.',
    rule: {
      name: 'New organizations start a 14-day trial',
      enabled: true,
      trigger: 'org_created',
      params: {},
      actions: [
        { type: 'set_subscription', status: 'trialing', extendDays: 14 },
        { type: 'notify_super_admins', message: 'New organization registered: {organization} ({plan}).' },
      ],
    },
  },
  {
    id: 'trial-to-free',
    description: 'When a trial ends, move the organization to the Free plan instead of suspending it.',
    rule: {
      name: 'Move to Free when a trial ends',
      enabled: true,
      trigger: 'subscription_ended',
      params: { status: 'trialing' },
      actions: [
        { type: 'change_plan', plan: 'free' },
        { type: 'set_subscription', status: 'active', clearEnd: true },
        { type: 'notify_super_admins', message: "{organization}'s trial ended; it is now on Free." },
      ],
    },
  },
  {
    id: 'completes-90',
    description: 'At 90% of the monthly completes, warn the super admins and the organization.',
    rule: {
      name: 'Alert at 90% of monthly completes',
      enabled: true,
      trigger: 'completes_used',
      params: { percent: 90 },
      actions: [
        { type: 'notify_super_admins', message: '{organization} used {percent}% of its monthly completes.' },
        {
          type: 'email_org_admins',
          subject: 'You have used most of this month’s completes',
          message: '{organization} has used {percent}% of the completes in the {plan} plan this month.',
        },
      ],
    },
  },
  {
    id: 'inactive-30',
    description: 'Tell the super admins when no administrator of an organization has signed in for 30 days.',
    rule: {
      name: 'Flag organizations inactive for 30 days',
      enabled: true,
      trigger: 'admins_inactive',
      params: { days: 30 },
      actions: [{ type: 'notify_super_admins', message: 'No administrator of {organization} has signed in for 30 days.' }],
    },
  },
];

/** Fills {organization}, {plan}, {endsAt} and {percent} in a message. */
export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

export function describeRule(r: { trigger: string; params: TriggerParams; actions: PlatformAction[] }) {
  const t = TRIGGERS[r.trigger as TriggerKey];
  const p = r.params;
  let when: string = t?.label ?? r.trigger;
  if (r.trigger === 'subscription_ending') when = `A subscription ends within ${p.days ?? 7} days`;
  if (r.trigger === 'completes_used') when = `Monthly completes reach ${p.percent ?? 90}% of the plan`;
  if (r.trigger === 'admins_inactive') when = `No administrator signed in for ${p.days ?? 30} days`;
  if (p.status) when += ` (status: ${p.status})`;
  return `${when} → ${r.actions.map((a) => ACTION_LABELS[a.type]).join(', ')}`;
}
