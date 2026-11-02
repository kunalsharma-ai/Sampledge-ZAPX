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
  // Milestone 12: fraud signals
  'automation',
  'honeypot',
  'no_interaction',
  'open_pasted',
  'same_device',
  'geo_mismatch',
  'blocked_device',
  'blocked_network',
  // Milestone 16: network reputation (needs a provider)
  'anonymous_network',
  'datacenter_network',
  // Milestone 12: face-to-face (CAPI) checks
  'gps_missing',
  'gps_moved',
  'interviewer_overlap',
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
  automation: 60,
  honeypot: 60,
  no_interaction: 30,
  open_pasted: 10,
  same_device: 25,
  geo_mismatch: 30,
  blocked_device: 60,
  blocked_network: 40,
  anonymous_network: 30,
  datacenter_network: 20,
  gps_missing: 30,
  gps_moved: 15,
  interviewer_overlap: 40,
} as const;

/** Pages answered with no keyboard, pointer or touch input before no_interaction is flagged. */
export const QUIET_PAGES_FOR_FLAG = 2;
/** Start and end of a CAPI interview further apart than this are flagged (metres). */
export const GPS_MOVED_METRES = 1000;

/** What the respondent's browser reported while answering (online interviews). */
export interface BrowserSignals {
  /** navigator.webdriver was true: the browser is controlled by automation software. */
  automation?: boolean;
  /** Times the hidden honeypot field was filled in. */
  honeypot?: number;
  /** Pages submitted with answers but without any keyboard, pointer or touch input. */
  quietPages?: number;
  /** Open questions whose answer was pasted in. */
  pasted?: string[];
}

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Metres, as reported by the device. */
  accuracy?: number | null;
}

/** Inputs for the fraud and capture checks. Everything is optional; missing evidence never adds points. */
export interface FraudInput {
  browser?: BrowserSignals;
  /** Other completes of this survey from the same device (keyed hash of browser traits). */
  sameDeviceCompletes?: number;
  /** Country reported by the edge network, and the countries expected for this respondent. */
  geo?: { country: string; expected: string[] };
  /** What the network reputation service said about the address: vpn, proxy, tor, relay, hosting. */
  network?: string[];
  /** The device or network is on the organization's block list. */
  blocked?: { device?: boolean; network?: boolean };
  /** CAPI only. */
  capi?: {
    gpsRequired: boolean;
    start?: GeoPoint | null;
    end?: GeoPoint | null;
    /** Other interviews by the same interviewer whose times overlap this one. */
    overlapping?: number;
  };
}

/** Great-circle distance in metres. */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
  fraud?: FraudInput;
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

  flags.push(...fraudFlags(q, input.fraud ?? {}));

  for (const check of q.checks) {
    if (conditionHolds(check.condition, input.def, input.answers))
      flags.push({ code: 'check_failed', ref: check.id, penalty: check.weight, detail: `${check.label ?? check.id} failed.` });
  }

  const score = Math.max(0, 100 - flags.reduce((sum, f) => sum + f.penalty, 0));
  return { score, flags };
}

function fraudFlags(q: QualitySettings, f: FraudInput): QualityFlag[] {
  const out: QualityFlag[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (q.fraud) {
    const b = f.browser ?? {};
    if (b.automation)
      out.push({ code: 'automation', penalty: PENALTY.automation, detail: 'The browser reported that automation software controls it.' });
    if ((b.honeypot ?? 0) > 0)
      out.push({ code: 'honeypot', penalty: PENALTY.honeypot, detail: 'A hidden field that people cannot see was filled in.' });
    if ((b.quietPages ?? 0) >= QUIET_PAGES_FOR_FLAG)
      out.push({
        code: 'no_interaction',
        penalty: PENALTY.no_interaction,
        detail: `${plural(b.quietPages!, 'page')} answered without any keyboard, mouse or touch input.`,
      });
    for (const id of [...new Set(b.pasted ?? [])].slice(0, 5))
      out.push({ code: 'open_pasted', ref: id, penalty: PENALTY.open_pasted, detail: `${id}: the answer was pasted in.` });
    if ((f.sameDeviceCompletes ?? 0) > 0)
      out.push({
        code: 'same_device',
        penalty: PENALTY.same_device,
        detail: `${plural(f.sameDeviceCompletes!, 'other complete')} came from what looks like the same device.`,
      });
    if (f.blocked?.device)
      out.push({ code: 'blocked_device', penalty: PENALTY.blocked_device, detail: 'This device is on your organization’s block list.' });
    if (f.blocked?.network)
      out.push({ code: 'blocked_network', penalty: PENALTY.blocked_network, detail: 'This network is on your organization’s block list.' });
  }
  if (q.fraud && f.network?.length) {
    const hidden = f.network.filter((k) => k === 'vpn' || k === 'proxy' || k === 'tor' || k === 'relay');
    const words: Record<string, string> = { vpn: 'a VPN', proxy: 'a proxy', tor: 'Tor', relay: 'a privacy relay' };
    if (hidden.length)
      out.push({
        code: 'anonymous_network',
        penalty: PENALTY.anonymous_network,
        detail: `Answered through ${hidden.map((k) => words[k]).join(' and ')}, which hides where the respondent is.`,
      });
    else if (f.network.includes('hosting'))
      out.push({
        code: 'datacenter_network',
        penalty: PENALTY.datacenter_network,
        detail: 'Answered from a data-centre or cloud address, where people rarely browse from.',
      });
  }
  if (f.geo && f.geo.expected.length && !f.geo.expected.includes(f.geo.country))
    out.push({
      code: 'geo_mismatch',
      penalty: PENALTY.geo_mismatch,
      detail: `Answered from ${f.geo.country}; expected ${f.geo.expected.join(' or ')}.`,
    });
  const c = f.capi;
  if (c) {
    if (c.gpsRequired && (!c.start || !c.end))
      out.push({ code: 'gps_missing', penalty: PENALTY.gps_missing, detail: 'The location was required but not recorded.' });
    if (c.start && c.end) {
      const m = distanceMetres(c.start, c.end);
      if (m > GPS_MOVED_METRES)
        out.push({
          code: 'gps_moved',
          penalty: PENALTY.gps_moved,
          detail: `The interview ended ${(m / 1000).toFixed(1)} km from where it started.`,
        });
    }
    if ((c.overlapping ?? 0) > 0)
      out.push({
        code: 'interviewer_overlap',
        penalty: PENALTY.interviewer_overlap,
        detail: `The interviewer recorded ${plural(c.overlapping!, 'other interview')} at the same time.`,
      });
  }
  return out;
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
