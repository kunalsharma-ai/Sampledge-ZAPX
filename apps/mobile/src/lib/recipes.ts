/**
 * Ready-made recipes: pick one, pick a survey and a number, and it is live. Each becomes an ordinary
 * automation rule (same engine as the web), so it can be refined on the web later.
 */
export const RECIPES = [
  {
    key: 'quota_full',
    label: 'Tell me when a quota fills',
    needsNumber: false,
    build: (surveyId: string | null) => ({
      name: 'Quota full alert',
      surveyId,
      trigger: 'quota.full',
      actions: [{ type: 'notify', to: 'rule_owner', message: 'A quota is full.' }],
    }),
  },
  {
    key: 'pause_at',
    label: 'Pause the survey at N completes',
    needsNumber: true,
    numberLabel: 'Completes',
    build: (surveyId: string | null, n: number) => ({
      name: `Pause at ${n} completes`,
      surveyId,
      trigger: 'response.finished',
      conditions: [{ field: 'metrics.completes', op: 'gte', value: n }],
      actions: [
        { type: 'set_survey_status', status: 'PAUSED' },
        { type: 'notify', to: 'project_team', message: `The survey reached ${n} completes and was paused.` },
      ],
    }),
  },
  {
    key: 'stalled',
    label: 'Daily alert when completes stall for N hours',
    needsNumber: true,
    numberLabel: 'Hours',
    build: (surveyId: string | null, n: number) => ({
      name: `No completes for ${n}h`,
      surveyId,
      trigger: 'schedule',
      schedule: { every: 'day', at: '09:00' },
      conditions: [{ field: 'metrics.hoursSinceLastComplete', op: 'gte', value: n }],
      actions: [{ type: 'notify', to: 'project_team', message: `No completes in the last ${n} hours.` }],
    }),
  },
  {
    key: 'quality',
    label: 'Alert when quality fails exceed N%',
    needsNumber: true,
    numberLabel: 'Percent',
    build: (surveyId: string | null, n: number) => ({
      name: `Quality fails above ${n}%`,
      surveyId,
      trigger: 'response.finished',
      conditions: [{ field: 'metrics.qualityFailRate', op: 'gt', value: n }],
      actions: [{ type: 'notify', to: 'admins', message: `Quality fail rate is above ${n}%.` }],
      cooldownMinutes: 240,
    }),
  },
] as const;
