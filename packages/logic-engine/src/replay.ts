/**
 * Server-side replay of an interview recorded elsewhere (the offline CAPI app). The device runs the
 * same engine, but its result is never trusted: the server walks the published version page by page
 * with the uploaded answers, re-validates every page and decides the outcome itself.
 */
import type { Answers, SurveyDefinition } from '@zapx/survey-schema';
import { firstMatchingTermination, nextPageIndex, validatePage, type FieldError } from './interview.js';
import { prepareSurvey } from './flow.js';

export type ReplayResult =
  | { outcome: 'complete'; answers: Answers; lastPageId: string }
  | { outcome: 'terminate' | 'quality_fail'; reason: string; answers: Answers; lastPageId: string }
  /** The interview stops at a page with no answers at all (broken off). */
  | { outcome: 'incomplete'; answers: Answers; lastPageId: string | null }
  /** The answers do not satisfy the published version (tampering, or a device bug). */
  | { outcome: 'invalid'; pageId: string; errors: FieldError[]; answers: Answers };

/** `seed` is the interview's id on the device, which also ordered its randomized blocks. */
export function replayInterview(source: SurveyDefinition, uploaded: Record<string, unknown>, seed = ''): ReplayResult {
  const def = prepareSurvey(source);
  let answers: Answers = {};
  let index = nextPageIndex(def, answers, -1, seed);
  let lastPageId: string | null = null;
  for (let guard = 0; index !== -1 && guard <= def.pages.length; guard++) {
    const page = def.pages[index]!;
    const submitted: Record<string, unknown> = {};
    let any = false;
    for (const q of page.questions) {
      if (q.type !== 'info' && uploaded[q.id] !== undefined && uploaded[q.id] !== null) {
        submitted[q.id] = uploaded[q.id];
        any = true;
      }
    }
    const result = validatePage(def, page, answers, submitted);
    if (!result.ok) {
      if (!any) return { outcome: 'incomplete', answers, lastPageId: page.id };
      return { outcome: 'invalid', pageId: page.id, errors: result.errors, answers };
    }
    answers = { ...answers, ...result.answers };
    lastPageId = page.id;
    const t = firstMatchingTermination(def, answers);
    if (t) return { outcome: t.status, reason: t.id, answers, lastPageId };
    index = nextPageIndex(def, answers, index, seed);
  }
  if (lastPageId === null) return { outcome: 'incomplete', answers, lastPageId: null };
  return { outcome: 'complete', answers, lastPageId };
}
