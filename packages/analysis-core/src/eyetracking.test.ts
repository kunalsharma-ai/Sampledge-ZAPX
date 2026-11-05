import { describe, expect, it } from 'vitest';
import { eyeTrackQuestionSchema, formatEyeTrack, type GazeSample } from '@zapx/survey-schema';
import { HEATMAP_CELLS, aoiDwellShares, eyeTrackSummary, sampleDurations } from './eyetracking';
import type { AnalysisRecord } from './index';

const q = eyeTrackQuestionSchema.parse({
  id: 'EYE',
  type: 'eyetrack',
  text: 'Look',
  image: 'img_0123456789',
  aois: [
    { code: 1, label: 'Logo', x: 0, y: 0, w: 50, h: 50 },
    { code: 2, label: 'Price', x: 50, y: 50, w: 50, h: 50 },
  ],
  durationSec: 4,
  maxErrorPct: 10,
});

/** A recording that looks at (x, y) (thousandths) from `from` ms to `to` ms, every 100 ms. */
function look(errorPct: number, parts: Array<{ from: number; to: number; x: number | null; y: number | null }>) {
  const samples: GazeSample[] = [];
  for (const p of parts) for (let t = p.from; t < p.to; t += 100) samples.push({ t, x: p.x, y: p.y });
  return formatEyeTrack({ status: 'recorded', errorPct, durationMs: 4000, samples });
}
const rec = (v: string, weight?: number): AnalysisRecord => ({ answers: { EYE: v }, system: {}, weight });

describe('eye-tracking results', () => {
  const records = [
    // Logo first for a second, then the price for three.
    rec(
      look(5, [
        { from: 0, to: 1000, x: 200, y: 200 },
        { from: 1000, to: 4000, x: 800, y: 800 },
      ]),
    ),
    // Only the price, after a second looking away.
    rec(
      look(8, [
        { from: 0, to: 1000, x: null, y: null },
        { from: 1000, to: 4000, x: 700, y: 900 },
      ]),
    ),
    // Too inaccurate: left out.
    rec(look(25, [{ from: 0, to: 4000, x: 200, y: 200 }])),
    rec('declined'),
    rec('no_face'),
    rec('nonsense'),
  ];

  it('counts every outcome and leaves out inaccurate recordings', () => {
    const s = eyeTrackSummary(q, records);
    expect(s.answered).toBe(5);
    expect(s.statuses).toEqual({ recorded: 3, declined: 1, unavailable: 0, no_face: 1, calibration_failed: 0 });
    expect(s.included).toBe(2);
    expect(s.tooInaccurate).toBe(1);
    expect(s.accuracy).toEqual({ medianPct: 6.5, bestPct: 5, worstPct: 8 });
    expect(s.onPicturePct).toBe(87.5);
  });

  it('measures each area of interest', () => {
    const [logo, price] = eyeTrackSummary(q, records).aois;
    expect(logo).toMatchObject({ viewersPct: 50, dwellSharePct: 12.5, meanDwellMs: 500, meanFirstLookMs: 0 });
    expect(price).toMatchObject({ viewersPct: 100, dwellSharePct: 87.5, meanDwellMs: 3000, meanFirstLookMs: 1000 });
  });

  it('weights respondents', () => {
    const s = eyeTrackSummary(q, [records[0]!, { ...records[1]!, weight: 3 }]);
    expect(s.aois[0]!.viewersPct).toBe(25);
  });

  it('puts the heatmap peak where people looked most', () => {
    const s = eyeTrackSummary(q, records);
    expect(s.heatmap).toHaveLength(HEATMAP_CELLS * HEATMAP_CELLS);
    const peak = s.heatmap.indexOf(1);
    const row = Math.floor(peak / HEATMAP_CELLS);
    const col = peak % HEATMAP_CELLS;
    expect(row / HEATMAP_CELLS).toBeGreaterThan(0.5);
    expect(col / HEATMAP_CELLS).toBeGreaterThan(0.5);
  });

  it('caps each sample at a quarter second, so a gap is not counted as looking', () => {
    expect(
      sampleDurations(
        [
          { t: 0, x: 1, y: 1 },
          { t: 2000, x: 1, y: 1 },
        ],
        2100,
      ),
    ).toEqual([250, 100]);
  });

  it('gives one recording its shares per area, for exports', () => {
    expect(
      aoiDwellShares(q.aois, {
        status: 'recorded',
        durationMs: 4000,
        samples: [
          { t: 0, x: 100, y: 100 },
          { t: 100, x: 900, y: 900 },
        ],
      }),
    ).toEqual([28.6, 71.4]);
  });

  it('is empty when nobody was recorded', () => {
    const s = eyeTrackSummary(q, [rec('declined')]);
    expect(s.included).toBe(0);
    expect(s.accuracy).toBeNull();
    expect(Math.max(...s.heatmap)).toBe(0);
  });
});
