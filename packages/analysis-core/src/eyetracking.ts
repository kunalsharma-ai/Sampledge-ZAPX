/**
 * Webcam eye tracking results (experimental): who took part, how accurate the calibration was, a
 * heatmap of where people looked on the picture, and per area of interest (AOI) how many looked at
 * it, for how long and how soon.
 *
 * Gaze points come from a browser estimate that has not been validated on real webcams, so every
 * number here is approximate. Recordings whose measured calibration error is above the question's
 * limit are left out. "Time to first look" is the first gaze sample inside the area, not a fixation
 * (no fixation detection is done on webcam-grade data).
 */
import {
  EYETRACK_STATUSES,
  parseEyeTrack,
  type EyeTrackAnswer,
  type EyeTrackQuestion,
  type EyeTrackStatus,
  type GazeSample,
} from '@zapx/survey-schema';
import { weightOf, type AnalysisRecord } from './index';

/** Heatmap resolution: cells across and down the picture. */
export const HEATMAP_CELLS = 48;
/** A sample stands for the time until the next one, but never more than this (a gap is not a look). */
const MAX_SAMPLE_MS = 250;

export interface AoiResult {
  code: number;
  label: string;
  /** Percent of included respondents whose gaze entered the area at least once. */
  viewersPct: number;
  /** Mean share of each respondent's on-picture time spent in the area, percent. */
  dwellSharePct: number;
  /** Mean time in the area, milliseconds (all included respondents). */
  meanDwellMs: number;
  /** Mean time until the gaze first entered the area, among those who looked at it. */
  meanFirstLookMs: number | null;
}

export interface EyeTrackSummary {
  questionId: string;
  /** Interviews with an answer to the question (any status). */
  answered: number;
  statuses: Record<EyeTrackStatus, number>;
  /** Recordings used in the results (calibration error within the limit). */
  included: number;
  /** Recordings left out because their calibration error was above the limit. */
  tooInaccurate: number;
  maxErrorPct: number;
  /** Calibration error of the included recordings, percent of the screen. */
  accuracy: { medianPct: number; bestPct: number; worstPct: number } | null;
  /** Mean share of samples with the gaze on the picture, percent. */
  onPicturePct: number;
  /** Row-major grid of HEATMAP_CELLS x HEATMAP_CELLS, 0-1 (1 = the most looked-at cell). */
  heatmap: number[];
  aois: AoiResult[];
}

const inAoi = (s: GazeSample, a: { x: number; y: number; w: number; h: number }) =>
  s.x !== null && s.y !== null && s.x >= a.x * 10 && s.x <= (a.x + a.w) * 10 && s.y >= a.y * 10 && s.y <= (a.y + a.h) * 10;

/** How long each sample stands for: until the next sample (or the end), capped. */
export function sampleDurations(samples: GazeSample[], durationMs: number): number[] {
  return samples.map((s, i) => {
    const next = i + 1 < samples.length ? samples[i + 1]!.t : durationMs;
    return Math.max(0, Math.min(MAX_SAMPLE_MS, next - s.t));
  });
}

/** Share of one recording's on-picture time spent in each area of interest, percent (one decimal). */
export function aoiDwellShares(aois: Array<{ x: number; y: number; w: number; h: number }>, a: EyeTrackAnswer): number[] {
  const samples = a.samples ?? [];
  const durs = sampleDurations(samples, a.durationMs ?? 0);
  const onMs = samples.reduce((acc, s, i) => acc + (s.x === null ? 0 : durs[i]!), 0);
  return aois.map((aoi) => {
    const dwell = samples.reduce((acc, s, i) => acc + (inAoi(s, aoi) ? durs[i]! : 0), 0);
    return onMs ? Math.round((1000 * dwell) / onMs) / 10 : 0;
  });
}

/** Gaussian blur of a square grid (separable), in place of a fixation map. */
export function blurGrid(grid: number[], n: number, sigma: number): number[] {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const k = kernel.map((v) => v / sum);
  const pass = (src: number[], horizontal: boolean) => {
    const out = new Array<number>(n * n).fill(0);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        let acc = 0;
        for (let j = -radius; j <= radius; j++) {
          const rr = horizontal ? r : r + j;
          const cc = horizontal ? c + j : c;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          acc += src[rr * n + cc]! * k[j + radius]!;
        }
        out[r * n + c] = acc;
      }
    return out;
  };
  return pass(pass(grid, true), false);
}

export function eyeTrackSummary(q: EyeTrackQuestion, records: AnalysisRecord[]): EyeTrackSummary {
  const statuses = Object.fromEntries(EYETRACK_STATUSES.map((s) => [s, 0])) as Record<EyeTrackStatus, number>;
  const n = HEATMAP_CELLS;
  const grid = new Array<number>(n * n).fill(0);
  const errors: number[] = [];
  const aoiAcc = q.aois.map(() => ({ viewers: 0, share: 0, dwell: 0, first: 0, firstN: 0 }));
  let answered = 0;
  let included = 0;
  let tooInaccurate = 0;
  let weightSum = 0;
  let onPicture = 0;
  for (const r of records) {
    const a = parseEyeTrack(r.answers[q.id]);
    if (!a) continue;
    answered++;
    statuses[a.status]++;
    if (a.status !== 'recorded') continue;
    if ((a.errorPct ?? Infinity) > q.maxErrorPct) {
      tooInaccurate++;
      continue;
    }
    const samples = a.samples ?? [];
    const durs = sampleDurations(samples, a.durationMs ?? 0);
    const onMs = samples.reduce((acc, s, i) => acc + (s.x === null ? 0 : durs[i]!), 0);
    const totalMs = durs.reduce((x, y) => x + y, 0);
    included++;
    errors.push(a.errorPct ?? 0);
    const w = weightOf(r);
    weightSum += w;
    onPicture += w * (totalMs ? onMs / totalMs : 0);
    // Each respondent adds the same total to the heatmap, so long or dense recordings do not dominate.
    if (onMs > 0)
      samples.forEach((s, i) => {
        if (s.x === null || s.y === null) return;
        const c = Math.min(n - 1, Math.floor((s.x / 1000) * n));
        const rr = Math.min(n - 1, Math.floor((s.y / 1000) * n));
        grid[rr * n + c]! += (w * durs[i]!) / onMs;
      });
    q.aois.forEach((aoi, j) => {
      const acc = aoiAcc[j]!;
      let dwell = 0;
      let first: number | null = null;
      samples.forEach((s, i) => {
        if (!inAoi(s, aoi)) return;
        dwell += durs[i]!;
        first ??= s.t;
      });
      if (first !== null) {
        acc.viewers += w;
        acc.first += w * first;
        acc.firstN += w;
      }
      acc.dwell += w * dwell;
      acc.share += w * (onMs ? dwell / onMs : 0);
    });
  }
  const blurred = blurGrid(grid, n, 1.6);
  const peak = Math.max(0, ...blurred);
  const sorted = [...errors].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
    : 0;
  const pct = (x: number) => (weightSum ? Math.round((1000 * x) / weightSum) / 10 : 0);
  return {
    questionId: q.id,
    answered,
    statuses,
    included,
    tooInaccurate,
    maxErrorPct: q.maxErrorPct,
    accuracy: sorted.length ? { medianPct: median, bestPct: sorted[0]!, worstPct: sorted[sorted.length - 1]! } : null,
    onPicturePct: pct(onPicture),
    heatmap: blurred.map((v) => (peak > 0 ? Math.round((v / peak) * 1000) / 1000 : 0)),
    aois: q.aois.map((aoi, j) => {
      const acc = aoiAcc[j]!;
      return {
        code: aoi.code,
        label: aoi.label,
        viewersPct: pct(acc.viewers),
        dwellSharePct: pct(acc.share),
        meanDwellMs: weightSum ? Math.round(acc.dwell / weightSum) : 0,
        meanFirstLookMs: acc.firstN ? Math.round(acc.first / acc.firstN) : null,
      };
    }),
  };
}
