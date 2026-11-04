/**
 * Suggested QA test cases (blueprint phase 4). Not AI: simulated respondents are run through the
 * survey, and a small set of them is picked so that every ending, every page and every quota that
 * the simulation reached is covered by at least one case. Each case records what that respondent
 * actually saw, so it passes today and fails when a later edit changes the route. A person reviews
 * the suggestions and saves the ones they want as regression tests.
 */
import type { Answers, QaTestCase, SurveyDefinition } from '@zapx/survey-schema';
import { runTestCase, traceRoute } from './debug.js';
import { prepareSurvey } from './flow.js';
import { computeVariables, firstMatchingTermination, matchingQuotas } from './interview.js';
import { simulateSurvey, type SimulatedInterview } from './simulate.js';

export interface SuggestedCase {
  case: QaTestCase;
  /** What this case covers that earlier suggestions did not. */
  covers: string[];
}

export interface SuggestOptions {
  respondents?: number;
  seed?: string;
  /** Most cases to suggest. */
  max?: number;
}

const ENDING_PREFIX = 'ending ';

export function suggestTestCases(source: SurveyDefinition, opts: SuggestOptions = {}): SuggestedCase[] {
  const seed = opts.seed ?? 'suggest';
  const max = Math.max(1, Math.min(50, opts.max ?? 12));
  const def = prepareSurvey(source);
  const interviews: SimulatedInterview[] = [];
  simulateSurvey(source, {
    respondents: Math.max(20, Math.min(2000, opts.respondents ?? 400)),
    seed,
    simulateQuotas: false,
    onInterview: (iv) => {
      if (iv.outcome !== 'stuck' && iv.outcome !== 'error') interviews.push(iv);
    },
  });

  const targetsOf = (iv: SimulatedInterview) => {
    const answers = iv.answers as Answers;
    const t = firstMatchingTermination(def, answers);
    const ending = t ? `${t.status}:${t.id}` : 'complete';
    return {
      ending,
      targets: [
        `${ENDING_PREFIX}${ending}`,
        ...iv.pages.map((p) => `page ${p}`),
        ...matchingQuotas(def, answers).map((q) => `quota ${q.id}`),
      ],
    };
  };
  const scored = interviews.map((iv) => ({ iv, ...targetsOf(iv) }));
  const covered = new Set<string>();
  const out: SuggestedCase[] = [];
  while (out.length < max) {
    let best: (typeof scored)[number] | null = null;
    let bestNew: string[] = [];
    for (const s of scored) {
      const fresh = s.targets.filter((t) => !covered.has(t));
      // A new ending counts most, so every ending gets its own case first.
      const weight = (xs: string[]) => xs.reduce((n, t) => n + (t.startsWith(ENDING_PREFIX) ? 100 : 1), 0);
      if (
        fresh.length &&
        (!best || weight(fresh) > weight(bestNew) || (weight(fresh) === weight(bestNew) && s.iv.pages.length < best.iv.pages.length))
      ) {
        best = s;
        bestNew = fresh;
      }
    }
    if (!best) break;
    for (const t of bestNew) covered.add(t);
    const answers = best.iv.answers as Answers;
    const seedFor = `${seed}:${best.iv.index}`;
    // The route as the regression runner traces it (the same rules as the live interview).
    const steps = traceRoute(source, answers, seedFor).steps;
    const variables = Object.fromEntries(
      Object.entries(computeVariables(def, answers)).filter(
        (e): e is [string, string | number | boolean | null] => e[1] === null || ['string', 'number', 'boolean'].includes(typeof e[1]),
      ),
    );
    const tc: QaTestCase = {
      name: `Suggested ${out.length + 1}: ends ${best.ending}${
        bestNew.some((t) => t.startsWith('quota '))
          ? `, ${bestNew
              .filter((t) => t.startsWith('quota '))
              .map((t) => t.slice(6))
              .join(', ')}`
          : ''
      }`.slice(0, 200),
      answers,
      seed: seedFor,
      expect: {
        outcome: best.ending,
        shows: steps
          .filter((x) => x.shown)
          .map((x) => x.pageId)
          .slice(0, 200),
        skips: steps
          .filter((x) => !x.shown)
          .map((x) => x.pageId)
          .slice(0, 200),
        variables,
        quotas: matchingQuotas(def, answers).map((q) => q.id),
      },
    };
    // Only suggest what passes now (the route replays exactly); anything else is a simulator gap.
    if (runTestCase(source, tc).passed) out.push({ case: tc, covers: bestNew.map((t) => t.replace(ENDING_PREFIX, 'ends ')) });
    scored.splice(scored.indexOf(best), 1);
  }
  return out;
}
