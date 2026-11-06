/**
 * Text of every "i" help card in the SampCode mobile app, in one place so it is easy to edit.
 * Same shape as the web CRM's apps/studio/lib/help.ts: what it is for, how to use it, where/when.
 * Keys: `section.*` the survey sections (same keys as SECTIONS in app/survey/[id].tsx), `h.*` headings.
 */
export interface HelpEntry {
  title: string;
  what: string;
  how: string[];
  where: string;
}

const entries = {
  'section.overview': {
    title: 'Overview',
    what: 'The survey at a glance: status, completes, versions and the launch controls.',
    how: ['Read the numbers at the top.', 'Use Launch control to go live, pause or close the survey.'],
    where: 'Open it first when you check a survey on the go.',
  },
  'section.quotas': {
    title: 'Quotas',
    what: 'How full each quota cell is right now.',
    how: ['Watch the bars; full cells send new people out as over quota.'],
    where: 'Check it during fieldwork to see which groups are still needed.',
  },
  'section.responses': {
    title: 'Responses',
    what: 'The list of interviews with their status and source.',
    how: ['Tap a response to see its answers.'],
    where: 'Use it to look into a single interview or a vendor question.',
  },
  'section.outline': {
    title: 'Questions',
    what: 'The questionnaire page by page, and quick text edits.',
    how: ['Scroll the pages; tap a question to change its wording or labels.'],
    where: 'Use it for quick wording fixes. Structural changes are made in the web CRM.',
  },
  'section.assist': {
    title: 'AI assist',
    what: 'Ask the AI to propose a change to the survey in plain language.',
    how: ['Type what you need and send it.', 'Review the proposal, then apply or reject it.'],
    where: 'Use it for edits while away from your desk. Nothing changes until you apply.',
  },
  'section.qa': {
    title: 'QA',
    what: 'Automatic testing with synthetic respondents that try every path of the survey.',
    how: ['Start a run and read the defects it finds.'],
    where: 'Run it before publishing a change. It saves no responses.',
  },
  'section.review': {
    title: 'Review',
    what: 'Completes flagged by the quality checks, waiting for a person to decide.',
    how: ['Open each one, read why it was flagged, then approve or reject.'],
    where: 'Clear it every day during fieldwork.',
  },
  'section.fieldwork': {
    title: 'Fieldwork',
    what: 'Interviewer progress, exceptions and appeals for face-to-face work.',
    how: ['Check each interviewer’s numbers and handle exceptions and appeals.'],
    where: 'Use it while supervising interviewers in the field.',
  },
  'section.analysis': {
    title: 'Analysis',
    what: 'Quick frequencies and crosstabs on the live data.',
    how: ['Pick the rows and a banner (columns) to build a table.'],
    where: 'Use it for top-line results during fieldwork.',
  },
  'section.reports': {
    title: 'Reports',
    what: 'Analysis reports saved in the web CRM, with fresh data.',
    how: ['Tap a report to open it.'],
    where: 'Use it to share daily numbers with the client.',
  },
  'section.exports': {
    title: 'Exports',
    what: 'Data files (CSV or Excel) of the responses.',
    how: ['Start an export and download it when it is ready.'],
    where: 'Use it to deliver data.',
  },
  'section.distribution': {
    title: 'Invitations',
    what: 'Email invitation waves to your own contacts, with reminders.',
    how: ['Create a wave, pick when it is sent, and follow its progress.'],
    where: 'Use it for customer and employee surveys.',
  },
  'section.cati': {
    title: 'CATI',
    what: 'Phone interviewing: call outcomes, recent calls and the call list.',
    how: ['Check outcomes and add people to the call list.'],
    where: 'Use it to supervise telephone fieldwork.',
  },
  'h.performance': {
    title: 'Survey performance',
    what: 'Completes over the last 30 days.',
    how: ['Read the trend to see if fieldwork is on track.'],
    where: 'Check it daily during fieldwork.',
  },
  'h.responseOverview': {
    title: 'Response overview',
    what: 'All responses split by status: complete, terminated, over quota and quality fail.',
    how: ['Compare the shares.'],
    where: 'A quick health check of fieldwork.',
  },
  'h.devices': {
    title: 'Device distribution',
    what: 'Which devices respondents use.',
    how: ['Compare phone, tablet and desktop shares.'],
    where: 'Use it to make sure the survey suits the devices people really use.',
  },
  'h.reach': {
    title: 'Global reach',
    what: 'The countries respondents answer from.',
    how: ['Check they match the markets you target.'],
    where: 'A quick targeting and fraud check.',
  },
  'h.recent': {
    title: 'Recent surveys',
    what: 'The surveys changed most recently.',
    how: ['Tap one to open it.'],
    where: 'The fastest way back to your work.',
  },
  'h.launch': {
    title: 'Launch control',
    what: 'Go live, pause or close the survey.',
    how: ['Tap the action you need and confirm.'],
    where: 'Close the survey when quotas are met.',
  },
  'h.versions': {
    title: 'Versions',
    what: 'Every published version of the survey.',
    how: ['See which version is live and when it was published.'],
    where: 'Use it to confirm a change went live.',
  },
  'h.rules': {
    title: 'Automation rules',
    what: 'Rules that act when something happens, such as a quota filling.',
    how: ['Switch rules on or off; approve actions that wait for you.'],
    where: 'Check approvals during fieldwork.',
  },
  'h.superviseSurvey': {
    title: 'Supervise a survey',
    what: 'Pick a survey to follow its interviewers in the field.',
    how: ['Tap a survey to open its fieldwork section.'],
    where: 'Use it while supervising face-to-face or phone teams.',
  },
  'h.limits': {
    title: 'Limits and usage',
    what: 'What your plan allows and how much is used this month.',
    how: ['Read the meters.'],
    where: 'Check it before starting a large study.',
  },
  'h.addMember': {
    title: 'Add a member',
    what: 'Invite a colleague and give them a role.',
    how: ['Enter their email, choose a role and add them.'],
    where: 'Use it when someone joins the team.',
  },
  'h.outcome': {
    title: 'Call outcome',
    what: 'What happened on this call: complete, callback, no answer, refusal or do not call.',
    how: ['Pick the outcome and save it; callbacks come back at the time you set.'],
    where: 'Save it after every call.',
  },
} satisfies Record<string, HelpEntry>;

export type HelpKey = keyof typeof entries;
export const HELP: Record<HelpKey, HelpEntry> = entries;
