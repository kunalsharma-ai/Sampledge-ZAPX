/**
 * Super admin: the feature catalog, which API routes each feature covers, and how a member's
 * features are worked out. A feature is on for a member when
 *
 *   1. their organization's plan includes it for that surface (web CRM or mobile app),
 *   2. the organization's override does not switch it off (an override can also switch on a
 *      feature the plan does not include), and
 *   3. the member's own override does not switch it off (a member can only lose features).
 *
 * A suspended organization, or a member without mobile access on the mobile surface, has no features.
 * Unknown keys are off ("fail closed").
 */
import { createHash } from 'node:crypto';

export const SURFACES = ['web', 'mobile'] as const;
export type Surface = (typeof SURFACES)[number];
export const isSurface = (v: unknown): v is Surface => v === 'web' || v === 'mobile';

export interface FeatureDef {
  key: string;
  label: string;
  group: string;
  description: string;
  surfaces: Surface[];
}

const BOTH: Surface[] = ['web', 'mobile'];
const WEB: Surface[] = ['web'];

export const FEATURES: FeatureDef[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'Workspace', description: 'The home dashboard and search.', surfaces: BOTH },
  { key: 'projects', label: 'Projects', group: 'Workspace', description: 'Projects and their members.', surfaces: BOTH },
  { key: 'library', label: 'Question bank', group: 'Workspace', description: 'Question bank and survey templates.', surfaces: BOTH },
  { key: 'notifications', label: 'Notifications', group: 'Workspace', description: 'The notification bell.', surfaces: BOTH },
  { key: 'appearance', label: 'Themes & appearance', group: 'Workspace', description: 'Organization themes and presets.', surfaces: BOTH },
  { key: 'surveys.view', label: 'View surveys', group: 'Surveys', description: 'Open surveys, drafts and versions.', surfaces: BOTH },
  {
    key: 'surveys.edit',
    label: 'Edit surveys',
    group: 'Surveys',
    description: 'Create and change surveys, media and imports.',
    surfaces: BOTH,
  },
  {
    key: 'surveys.publish',
    label: 'Publish surveys',
    group: 'Surveys',
    description: 'Publish versions and change survey status.',
    surfaces: BOTH,
  },
  {
    key: 'translations',
    label: 'Translations',
    group: 'Surveys',
    description: 'Translation, memory, glossary and translation QA.',
    surfaces: BOTH,
  },
  {
    key: 'qa',
    label: 'QA lab & test cases',
    group: 'Surveys',
    description: 'Logic checks, simulated runs and test cases.',
    surfaces: BOTH,
  },
  {
    key: 'ai_assist',
    label: 'AI assistant',
    group: 'Surveys',
    description: 'AI survey proposals and the research assistant.',
    surfaces: BOTH,
  },
  { key: 'analysis', label: 'Analysis', group: 'Data', description: 'Frequencies, crosstabs, weighting and dashboards.', surfaces: BOTH },
  { key: 'reports', label: 'Saved reports', group: 'Data', description: 'Saved reports and running them.', surfaces: BOTH },
  { key: 'exports', label: 'Exports', group: 'Data', description: 'Data exports and report downloads.', surfaces: BOTH },
  { key: 'quality', label: 'Quality & fraud', group: 'Data', description: 'Fraud blocks and captured evidence.', surfaces: BOTH },
  {
    key: 'review_queue',
    label: 'Review queue',
    group: 'Data',
    description: 'Reviewing and deciding on flagged interviews.',
    surfaces: BOTH,
  },
  {
    key: 'fieldwork',
    label: 'Fieldwork',
    group: 'Fieldwork',
    description: 'Fieldwork, supervisor, back-checks and appeals.',
    surfaces: BOTH,
  },
  { key: 'distribution', label: 'Distribution', group: 'Fieldwork', description: 'Links, contacts, email and SMS waves.', surfaces: BOTH },
  {
    key: 'capi',
    label: 'CAPI (face to face)',
    group: 'Fieldwork',
    description: 'Interviewer assignments and the offline CAPI app.',
    surfaces: BOTH,
  },
  { key: 'cati', label: 'CATI (phone)', group: 'Fieldwork', description: 'Call lists, calling hours and do-not-call.', surfaces: BOTH },
  {
    key: 'calls',
    label: 'Dialer calls',
    group: 'Fieldwork',
    description: 'Click-to-call dialing through the telephony provider.',
    surfaces: BOTH,
  },
  { key: 'automation', label: 'Automation', group: 'Automation', description: 'Organization automation rules and runs.', surfaces: BOTH },
  { key: 'team', label: 'Team', group: 'Organization', description: 'Members, roles and password resets.', surfaces: BOTH },
  {
    key: 'integrations',
    label: 'Vendors & redirects',
    group: 'Organization',
    description: 'Sample vendors, redirects and callbacks.',
    surfaces: BOTH,
  },
  { key: 'webhooks', label: 'Webhooks', group: 'Organization', description: 'Outgoing webhooks.', surfaces: WEB },
  { key: 'api_keys', label: 'API keys', group: 'Organization', description: 'Organization API keys.', surfaces: WEB },
  {
    key: 'sso',
    label: 'Single sign-on & SCIM',
    group: 'Organization',
    description: 'OIDC/SAML sign-on and SCIM provisioning.',
    surfaces: WEB,
  },
  { key: 'audit_log', label: 'Audit log', group: 'Organization', description: 'The organization audit log.', surfaces: BOTH },
  {
    key: 'governance',
    label: 'Data governance',
    group: 'Organization',
    description: 'Residency, retention and processors.',
    surfaces: WEB,
  },
  {
    key: 'settings',
    label: 'Settings',
    group: 'Organization',
    description: 'Organization settings, AI settings and billing.',
    surfaces: BOTH,
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
const KNOWN = new Set(FEATURE_KEYS);
export const isFeatureKey = (v: unknown): v is string => typeof v === 'string' && KNOWN.has(v);

/** Every feature a surface can have: the default for a new plan. */
export const allFeatures = (surface: Surface) => FEATURES.filter((f) => f.surfaces.includes(surface)).map((f) => f.key);

/** Features that need another one: without the second, the first is off too. */
const NEEDS: Record<string, string> = { 'surveys.edit': 'surveys.view', 'surveys.publish': 'surveys.view' };

export type Overrides = Partial<Record<Surface, Record<string, boolean>>>;

/** Stored JSON read leniently: only known surfaces, known keys and boolean values survive. */
export function readOverrides(raw: unknown): Overrides {
  const out: Overrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const s of SURFACES) {
    const v = (raw as Record<string, unknown>)[s];
    if (!v || typeof v !== 'object') continue;
    const m: Record<string, boolean> = {};
    for (const [k, on] of Object.entries(v as Record<string, unknown>)) if (isFeatureKey(k) && typeof on === 'boolean') m[k] = on;
    if (Object.keys(m).length) out[s] = m;
  }
  return out;
}

export interface EntitlementInput {
  surface: Surface;
  plan: { code: string; webFeatures: string[]; mobileFeatures: string[] } | null;
  tenant: { suspendedAt: Date | null; featureOverrides: unknown };
  user: { superAdmin: boolean; mobileAccess: boolean; featureOverrides: unknown };
}

export interface Entitlements {
  version: string;
  plan: string | null;
  surface: Surface;
  suspended: boolean;
  /** False when the member may not use the mobile app (only meaningful for surface=mobile). */
  surfaceAllowed: boolean;
  features: Record<string, boolean>;
}

export function resolveEntitlements(input: EntitlementInput): Entitlements {
  const { surface, plan, tenant, user } = input;
  const suspended = !!tenant.suspendedAt && !user.superAdmin;
  const surfaceAllowed = surface === 'web' || user.mobileAccess || user.superAdmin;
  const fromPlan = new Set(plan ? (surface === 'web' ? plan.webFeatures : plan.mobileFeatures) : []);
  const org = readOverrides(tenant.featureOverrides)[surface] ?? {};
  const own = readOverrides(user.featureOverrides)[surface] ?? {};
  const features: Record<string, boolean> = {};
  for (const f of FEATURES) {
    let on = f.surfaces.includes(surface) && (org[f.key] ?? fromPlan.has(f.key));
    if (own[f.key] === false) on = false;
    // The super admin always has everything, so they can never lock themselves out.
    if (user.superAdmin) on = f.surfaces.includes(surface);
    features[f.key] = on && !suspended && surfaceAllowed;
  }
  for (const [k, needs] of Object.entries(NEEDS)) if (!features[needs]) features[k] = false;
  const body = { plan: plan?.code ?? null, surface, suspended, surfaceAllowed, features };
  const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { version, ...body };
}

// ---- Which routes each feature covers ----------------------------------------------------------

interface RouteRule {
  /** Matched against the route path without the /api prefix, e.g. "surveys/:id/analysis/frequencies". */
  pattern: RegExp;
  /** The feature for reads (GET/HEAD) and for writes; a string means the same for both. */
  feature: string | { read: string; write: string };
}

const rw = (read: string, write: string) => ({ read, write });

/**
 * First match wins, so specific paths come before general ones. Routes that match nothing are not
 * gated: sign-in, the member's own preferences, respondent links (public/*), provider webhooks,
 * SCIM (own token), the platform integrations and the super admin console (checked separately).
 */
const RULES: RouteRule[] = [
  { pattern: /^dashboard(\/|$)/, feature: 'dashboard' },
  { pattern: /^notifications(\/|$)/, feature: 'notifications' },
  { pattern: /^library(\/|$)/, feature: 'library' },
  { pattern: /^(tenant\/appearance|tenant\/appearance-presets)(\/|$)/, feature: 'appearance' },
  { pattern: /^glossary(\/|$)/, feature: 'translations' },
  { pattern: /^projects\/:id\/audit$/, feature: 'audit_log' },
  { pattern: /^projects\/:projectId\/vendors/, feature: 'integrations' },
  { pattern: /^projects\/:id\/redirect-defaults/, feature: 'integrations' },
  { pattern: /^projects\/:projectId\/surveys/, feature: rw('surveys.view', 'surveys.edit') },
  { pattern: /^projects(\/|$)/, feature: 'projects' },
  { pattern: /^surveys\/:id\/analysis\/assistant/, feature: 'ai_assist' },
  { pattern: /^surveys\/:id\/analysis(\/|$)/, feature: 'analysis' },
  { pattern: /^surveys\/:id\/reports/, feature: 'reports' },
  { pattern: /^reports\/:id\/export\.xlsx$/, feature: 'exports' },
  { pattern: /^reports(\/|$)/, feature: 'reports' },
  { pattern: /^surveys\/:id\/(export|jobs\/export)$/, feature: 'exports' },
  { pattern: /^surveys\/:id\/(ai\/propose|jobs\/ai)$/, feature: 'ai_assist' },
  { pattern: /^surveys\/:id\/(qa|test-cases|jobs\/qa|check)(\/|$)/, feature: 'qa' },
  { pattern: /^qa\/runs/, feature: 'qa' },
  { pattern: /^surveys\/:id\/(translate|translation-memory|translation-qa)$/, feature: 'translations' },
  { pattern: /^surveys\/:id\/quality/, feature: 'review_queue' },
  { pattern: /^(quality\/blocks|captures)(\/|$)/, feature: 'quality' },
  { pattern: /^surveys\/:id\/captures/, feature: 'quality' },
  { pattern: /^surveys\/:id\/(fieldwork|supervisor|backchecks|appeals)(\/|$)/, feature: 'fieldwork' },
  { pattern: /^capi\/appeals$/, feature: 'fieldwork' },
  { pattern: /^surveys\/:id\/capi/, feature: 'capi' },
  { pattern: /^capi(\/|$)/, feature: 'capi' },
  { pattern: /^cati\/(cases\/:id\/dial|dials|me)(\/|$)/, feature: 'calls' },
  { pattern: /^surveys\/:id\/cati/, feature: 'cati' },
  { pattern: /^cati(\/|$)/, feature: 'cati' },
  { pattern: /^surveys\/:id\/(distributions|contacts|links)(\/|$)/, feature: 'distribution' },
  { pattern: /^automation(\/|$)/, feature: 'automation' },
  { pattern: /^surveys\/:id\/(publish|status)$/, feature: 'surveys.publish' },
  { pattern: /^(surveys|changesets)(\/|$)/, feature: rw('surveys.view', 'surveys.edit') },
  { pattern: /^imports\//, feature: 'surveys.edit' },
  { pattern: /^users(\/|$)/, feature: 'team' },
  { pattern: /^api-keys(\/|$)/, feature: 'api_keys' },
  { pattern: /^(webhooks|webhook-events|webhook-deliveries)(\/|$)/, feature: 'webhooks' },
  { pattern: /^(sso|scim\/token)$/, feature: 'sso' },
  { pattern: /^audit(\/|$)/, feature: 'audit_log' },
  { pattern: /^organization\/governance/, feature: 'governance' },
  { pattern: /^organization\/redirect-defaults/, feature: 'integrations' },
  { pattern: /^(vendors|vendor-presets|callbacks|v1\/vendor)(\/|$)/, feature: 'integrations' },
  { pattern: /^organization\/ai/, feature: 'settings' },
  { pattern: /^billing\/(checkout|portal)$/, feature: 'settings' },
  { pattern: /^billing$/, feature: 'settings' },
];

/** The feature an API route needs, or null when the route is not gated. */
export function featureForRoute(method: string, routePath: string): string | null {
  const path = routePath.replace(/^\/?api\//, '').replace(/\/$/, '');
  const read = method === 'GET' || method === 'HEAD';
  for (const r of RULES) {
    if (!r.pattern.test(path)) continue;
    return typeof r.feature === 'string' ? r.feature : read ? r.feature.read : r.feature.write;
  }
  return null;
}
