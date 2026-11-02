/**
 * Plans and their limits (Milestone 8). A limit of `null` means unlimited. Limits live in code so
 * they are reviewed like any other change; an organization's plan is set by an operator
 * (`node dist/cli/set-plan.js`). There is no billing integration: nothing here charges anyone.
 */
export const PLAN_CODES = ['free', 'team', 'business', 'enterprise'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanLimits {
  /** Active members other than interviewers. */
  seats: number | null;
  /** Active interviewers (CAPI). */
  interviewers: number | null;
  /** Surveys that are live at the same time. */
  liveSurveys: number | null;
  /** Completed interviews per calendar month (UTC), test interviews excluded. */
  completesPerMonth: number | null;
  sso: boolean;
  scim: boolean;
}

export const PLANS: Record<PlanCode, { name: string; limits: PlanLimits }> = {
  free: { name: 'Free', limits: { seats: 3, interviewers: 2, liveSurveys: 2, completesPerMonth: 250, sso: false, scim: false } },
  team: { name: 'Team', limits: { seats: 10, interviewers: 10, liveSurveys: 10, completesPerMonth: 5_000, sso: false, scim: false } },
  business: {
    name: 'Business',
    limits: { seats: 50, interviewers: 100, liveSurveys: 50, completesPerMonth: 50_000, sso: true, scim: false },
  },
  enterprise: {
    name: 'Enterprise',
    limits: { seats: null, interviewers: null, liveSurveys: null, completesPerMonth: null, sso: true, scim: true },
  },
};

export const isPlanCode = (v: string): v is PlanCode => (PLAN_CODES as readonly string[]).includes(v);

/** Unknown plan codes (e.g. a plan removed from code) fall back to the most restrictive plan. */
export const planOf = (code: string) => PLANS[isPlanCode(code) ? code : 'free'];

/** Start of the current calendar month in UTC. */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
