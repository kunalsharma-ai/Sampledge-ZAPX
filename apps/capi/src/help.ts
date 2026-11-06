/**
 * Text of the "i" help cards in the SampCode Interviewer app, in one place so it is easy to edit.
 * Same shape as the web CRM's apps/studio/lib/help.ts: what it is for, how to use it, where/when.
 */
export interface HelpEntry {
  title: string;
  what: string;
  how: string[];
  where: string;
}

const entries = {
  surveys: {
    title: 'Surveys',
    what: 'The surveys your project manager assigned to you, downloaded to this device so you can interview without a connection.',
    how: ['Tap "Sync now" while online to get the latest surveys.', 'Tap "Start interview" on a survey to begin.'],
    where: 'Use it at the start of each interview. Sync at least once a day when you have a connection.',
  },
  interviews: {
    title: 'Interviews on this device',
    what: 'Every interview you made on this device and whether it has been sent to the server yet.',
    how: ['Finished interviews are sent automatically when you are online, or with "Sync now".', 'Resume a paused interview from here.'],
    where: 'Check it before handing in or resetting the device: nothing should be waiting to sync.',
  },
  results: {
    title: 'Results and appeals',
    what: 'What happened to your interviews after the quality checks and back-checks.',
    how: ['Read why an interview was rejected.', 'Appeal once if you think it was a mistake; a supervisor looks at it again.'],
    where: 'Check it after each sync to learn from feedback.',
  },
} satisfies Record<string, HelpEntry>;

export type HelpKey = keyof typeof entries;
export const HELP: Record<HelpKey, HelpEntry> = entries;
