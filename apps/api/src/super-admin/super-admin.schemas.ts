import { z } from 'zod';
import { isCommonPassword } from '../auth/password-policy';
import { isFeatureKey } from './features';

const limit = z.number().int().min(0).max(100_000_000).nullable();
export const limitsSchema = z.object({
  seats: limit,
  interviewers: limit,
  liveSurveys: limit,
  completesPerMonth: limit,
  sso: z.boolean(),
  scim: z.boolean(),
});

const featureList = z.array(z.string().refine(isFeatureKey, 'Unknown feature')).max(100);

export const planSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().length(3).optional(),
  interval: z.enum(['month', 'year']).optional(),
  limits: limitsSchema,
  webFeatures: featureList,
  mobileFeatures: featureList,
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type PlanInput = z.infer<typeof planSchema>;

export const newPlanSchema = planSchema.extend({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lower-case letters, digits, - and _'),
});

export const STATUSES = ['active', 'trialing', 'expired', 'cancelled'] as const;
const status = z.enum(STATUSES);
const when = z.string().datetime({ offset: true }).nullable();

export const createOrgSchema = z.object({
  organization: z.string().min(1).max(120),
  adminName: z.string().min(1).max(120),
  adminEmail: z.string().email().toLowerCase(),
  /** Leave out to send the administrator a setup link instead. */
  adminPassword: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200)
    .refine((p) => !isCommonPassword(p), 'This password is too common. Choose another one.')
    .optional(),
  plan: z.string().min(1).max(40),
  subscriptionStatus: status.optional(),
  subscriptionEndsAt: when.optional(),
  notes: z.string().max(5000).optional(),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const orgPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    plan: z.string().min(1).max(40).optional(),
    subscriptionStatus: status.optional(),
    subscriptionEndsAt: when.optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export type OrgPatch = z.infer<typeof orgPatchSchema>;

const overrideMap = z.record(z.string().refine(isFeatureKey, 'Unknown feature'), z.boolean());
export const overridesSchema = z.object({ web: overrideMap.optional(), mobile: overrideMap.optional() });

export const suspendSchema = z.object({ reason: z.string().max(500).default('') });

export const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  role: z.enum(['ADMIN', 'PROGRAMMER', 'VIEWER', 'INTERVIEWER']),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const userPatchSchema = z
  .object({
    role: z.enum(['ADMIN', 'PROGRAMMER', 'VIEWER', 'INTERVIEWER']).optional(),
    disabled: z.boolean().optional(),
    superAdmin: z.boolean().optional(),
    mobileAccess: z.boolean().optional(),
    /** Features removed from this member; only false values are kept. */
    featureOverrides: overridesSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export type UserPatch = z.infer<typeof userPatchSchema>;

export const activitySchema = z.object({
  tenantId: z.string().max(64).optional(),
  userId: z.string().max(64).optional(),
  action: z.string().max(80).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ActivityQuery = z.infer<typeof activitySchema>;

export const featureChangeSchema = z.object({
  feature: z.string().refine(isFeatureKey, 'Unknown feature'),
  surface: z.enum(['web', 'mobile', 'both']).default('both'),
  /** null: back to what the plan says. */
  on: z.boolean().nullable(),
});
