/**
 * The mobile app's view of the feature catalog. The super admin turns each key on or off per
 * subscription, organization and user (GET /api/me/entitlements?surface=mobile); the app shows a
 * screen only while its key is on. Keys match the API's catalog (apps/api/src/super-admin/features.ts,
 * GET /api/features); web-only keys (webhooks, api_keys, sso, governance) are never on for mobile.
 */
export const FEATURE_KEYS = [
  'dashboard',
  'projects',
  'surveys.view',
  'surveys.edit',
  'surveys.publish',
  'qa',
  'analysis',
  'reports',
  'exports',
  'fieldwork',
  'review_queue',
  'capi',
  'cati',
  'calls',
  'quality',
  'translations',
  'distribution',
  'automation',
  'notifications',
  'library',
  'team',
  'integrations',
  'ai_assist',
  'audit_log',
  'appearance',
  'settings',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  /** One line shown in menus and on the "not in your plan" screen. */
  blurb: string;
  group: 'Work' | 'Fieldwork' | 'Insights' | 'Organization';
}

export const FEATURES: Record<FeatureKey, FeatureInfo> = {
  dashboard: { key: 'dashboard', label: 'Dashboard', blurb: 'Live totals, trends and recent surveys', group: 'Work' },
  projects: { key: 'projects', label: 'Projects', blurb: 'Projects, their surveys and vendors', group: 'Work' },
  'surveys.view': { key: 'surveys.view', label: 'Surveys', blurb: 'Survey outline, quotas and responses', group: 'Work' },
  'surveys.edit': { key: 'surveys.edit', label: 'Edit surveys', blurb: 'Change question wording and options', group: 'Work' },
  'surveys.publish': { key: 'surveys.publish', label: 'Publish', blurb: 'Publish, pause, resume and close surveys', group: 'Work' },
  qa: { key: 'qa', label: 'QA lab', blurb: 'Run automated QA and test cases', group: 'Work' },
  analysis: { key: 'analysis', label: 'Analysis', blurb: 'Frequencies and crosstabs', group: 'Insights' },
  reports: { key: 'reports', label: 'Reports', blurb: 'Saved reports and their results', group: 'Insights' },
  exports: { key: 'exports', label: 'Exports', blurb: 'Start data exports and download files', group: 'Insights' },
  fieldwork: { key: 'fieldwork', label: 'Fieldwork', blurb: 'Supervisor view, back-checks and appeals', group: 'Fieldwork' },
  review_queue: { key: 'review_queue', label: 'Review queue', blurb: 'Accept or reject flagged interviews', group: 'Fieldwork' },
  capi: { key: 'capi', label: 'CAPI interviewing', blurb: 'Face-to-face interviews, also offline', group: 'Fieldwork' },
  cati: { key: 'cati', label: 'Phone interviewing', blurb: 'Take the next call, record outcomes, call progress', group: 'Fieldwork' },
  calls: { key: 'calls', label: 'Dialer calls', blurb: 'Click-to-call through the telephony provider', group: 'Fieldwork' },
  quality: { key: 'quality', label: 'Quality & fraud', blurb: 'Fraud blocks and captured evidence', group: 'Fieldwork' },
  translations: { key: 'translations', label: 'Translations', blurb: 'Translation memory, glossary and QA', group: 'Work' },
  distribution: { key: 'distribution', label: 'Distribution', blurb: 'Email and SMS invitation waves', group: 'Fieldwork' },
  automation: { key: 'automation', label: 'Automation', blurb: 'Rules, runs waiting for approval', group: 'Organization' },
  notifications: { key: 'notifications', label: 'Notifications', blurb: 'Alerts from automation and fieldwork', group: 'Organization' },
  library: { key: 'library', label: 'Library', blurb: 'Question bank and templates', group: 'Work' },
  team: { key: 'team', label: 'Team', blurb: 'Members and their roles', group: 'Organization' },
  integrations: {
    key: 'integrations',
    label: 'Vendors & redirects',
    blurb: 'Sample vendors, redirects and callbacks',
    group: 'Organization',
  },
  ai_assist: { key: 'ai_assist', label: 'AI assist', blurb: 'Describe a change, review and apply it', group: 'Work' },
  audit_log: { key: 'audit_log', label: 'Audit log', blurb: 'Who changed what, and when', group: 'Organization' },
  appearance: { key: 'appearance', label: 'Themes & appearance', blurb: 'Organization theme presets', group: 'Organization' },
  settings: { key: 'settings', label: 'Organization settings', blurb: 'Plan, billing and AI usage', group: 'Organization' },
};

export const isFeatureKey = (k: string): k is FeatureKey => (FEATURE_KEYS as readonly string[]).includes(k);
