/**
 * Quality assessment of one completed interview. Pure: the caller supplies everything that needs
 * the database (median length of interview, which open answers were already seen, how many other
 * completes came from the same network), so the same function runs in the API, in tests and later
 * in the offline CAPI app.
 */
import { conditionHolds } from '@zapx/logic-engine';
import { allQuestions, qualitySettingsOf, type Answers, type QualitySettings, type SurveyDefinition } from '@zapx/survey-schema';
import { openEndFingerprint, openEndIssue } from './open-ends.js';

export const QUALITY_FLAG_CODES = [
  'speeder_hard',
  'speeder',
  'straightline',
  'open_gibberish',
  'open_low_effort',
  'open_duplicate',
  'same_network',
  'check_failed',
] as const;
export type QualityFlagCode = (typeof QUALITY_FLAG_CODES)[number];

export interface QualityFlag {
  code: QualityFlagCode;
  /** Question, grid or quality check the flag is about, when there is one. */
  ref?: string;
  /** Points taken off the score. */
  penalty: number;
  /** Plain-language reason, shown to reviewers. */
  detail: string;
}

export interface QualityResult {
  /** 0 to 100. 100 = nothing found. */
  score: number;
  flags: QualityFlag[];
}

/** Penalties for the built-in checks. Survey-specific checks carry their own weight. */
export const PENALTY = {
  speeder_hard: 60,
  speeder: 35,
  straightline: 15,
  open_gibberish: 20,
  open_low_effort: 5,
  open_duplicate: 25,
  same_network: 20,
} as const;

/** The relative speeder check needs a stable median. */
export const MIN_COMPLETES_FOR_MEDIAN = 20;

export interface QualityInput {
  def: SurveyDefinition;
  answers: Answers;
  /** Length of interview in milliseconds (first page shown to last page submitted). */
  durationMs: number | null;
  /** Median length of interview of earlier accepted completes, or null when there are too few. */
  medianMs: number | null;
  /** Open questions whose answer (fingerprint) another respondent already gave. */
  duplicateOpenEnds?: ReadonlySet<string>;
  /** Other completes of this survey from the same network. */
  sameNetworkCompletes?: number;
}

const seconds = (ms: number) => Math.round(ms / 100) / 10;

export function assessQuality(input: QualityInput): QualityResult {
  const q: QualitySettings = qualitySettingsOf(input.def);
  const flags: QualityFlag[] = [];
  if (!q.enabled) return { score: 100, flags };

  // Speeding
  const d = input.durationMs;
  if (d !== null && q.minSeconds && d < q.minSeconds * 1000) {
    flags.push({
      code: 'speeder_hard',
      penalty: PENALTY.speeder_hard,
      detail: `Finished in ${seconds(d)} s; the minimum is ${q.minSeconds} s.`,
    });
  } else if (d !== null && input.medianMs && q.speederRatio > 0 && d < input.medianMs * q.speederRatio) {
    flags.push({
      code: 'speeder',
      penalty: PENALTY.speeder,
      detail: `Finished in ${seconds(d)} s, under ${Math.round(q.speederRatio * 100)}% of the median ${seconds(input.medianMs)} s.`,
    });
  }

  // Straightlining and open ends
  for (const question of allQuestions(input.def)) {
    const value = input.answers[question.id];
    if (question.type === 'grid' && value && typeof value === 'object' && !Array.isArray(value)) {
      const given = Object.values(value);
      if (given.length >= q.straightlineMinRows && question.rows.length >= q.straightlineMinRows && new Set(given).size === 1) {
        const column = question.columns.find((c) => c.code === given[0]);
        flags.push({
          code: 'straightline',
          ref: question.id,
          penalty: PENALTY.straightline,
          detail: `${question.id}: the same answer${column ? ` (“${column.label}”)` : ''} in all ${given.length} rows.`,
        });
      }
    }
    if (question.type === 'open' && q.openEnds && typeof value === 'string') {
      const issue = openEndIssue(value);
      if (issue === 'gibberish')
        flags.push({
          code: 'open_gibberish',
          ref: question.id,
          penalty: PENALTY.open_gibberish,
          detail: `${question.id}: looks like gibberish.`,
        });
      else if (issue === 'low_effort')
        flags.push({
          code: 'open_low_effort',
          ref: question.id,
          penalty: PENALTY.open_low_effort,
          detail: `${question.id}: very short answer.`,
        });
      if (input.duplicateOpenEnds?.has(question.id))
        flags.push({
          code: 'open_duplicate',
          ref: question.id,
          penalty: PENALTY.open_duplicate,
          detail: `${question.id}: the same text was given by another respondent.`,
        });
    }
  }

  if (q.sameNetwork && (input.sameNetworkCompletes ?? 0) > 0) {
    const n = input.sameNetworkCompletes!;
    flags.push({
      code: 'same_network',
      penalty: PENALTY.same_network,
      detail: `${n} other complete${n === 1 ? '' : 's'} came from the same network.`,
    });
  }

  for (const check of q.checks) {
    if (conditionHolds(check.condition, input.def, input.answers))
      flags.push({ code: 'check_failed', ref: check.id, penalty: check.weight, detail: `${check.label ?? check.id} failed.` });
  }

  const score = Math.max(0, 100 - flags.reduce((sum, f) => sum + f.penalty, 0));
  return { score, flags };
}

export type QualityDecision = 'pass' | 'review' | 'reject';

/** What happens to a complete with this score under the survey's settings. */
export function qualityDecision(settings: QualitySettings, score: number): QualityDecision {
  if (!settings.enabled) return 'pass';
  if (settings.rejectBelow > 0 && score < settings.rejectBelow) return 'reject';
  if (score < settings.reviewBelow) return 'review';
  return 'pass';
}

/** Fingerprints of a respondent's open answers, keyed by question id (for duplicate detection). */
export function openEndFingerprints(def: SurveyDefinition, answers: Answers): Array<{ questionId: string; hash: string }> {
  const q = qualitySettingsOf(def);
  if (!q.enabled || !q.openEnds) return [];
  const out: Array<{ questionId: string; hash: string }> = [];
  for (const question of allQuestions(def)) {
    const value = answers[question.id];
    if (question.type !== 'open' || typeof value !== 'string') continue;
    const hash = openEndFingerprint(value);
    if (hash) out.push({ questionId: question.id, hash });
  }
  return out;
}

/** Median of a list of durations (ms). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
