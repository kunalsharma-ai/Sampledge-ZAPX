import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_POINTS,
  CHECK_POINTS,
  LANDMARKS,
  calibrationErrorPct,
  fitGaze,
  gazeFeatures,
  predictGaze,
  smoother,
  solve,
  toPicture,
  type Point3,
} from './gaze';

/** Seeded random numbers, so the tests are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/**
 * A synthetic face looking at (tx, ty): the irises move between the eye corners with the gaze and
 * against head turns, the lids follow the vertical gaze a little. This checks the estimator's maths,
 * not real-world accuracy (that needs real webcams).
 */
function face(tx: number, ty: number, r: () => number, noise = 0): Point3[] {
  const lm: Point3[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const hx = 0.5 + (r() - 0.5) * 0.06;
  const hy = 0.45 + (r() - 0.5) * 0.06;
  const s = 0.12 + (r() - 0.5) * 0.01;
  const yaw = (r() - 0.5) * 0.1;
  const pitch = (r() - 0.5) * 0.1;
  const w = 0.45 * s;
  const dx = 0.25 * (tx - 0.5) - 0.3 * yaw + gauss(r) * noise;
  const dy = 0.18 * (ty - 0.5) - 0.3 * pitch + gauss(r) * noise;
  const open = 0.3 + 0.05 * (ty - 0.5);
  const eye = (cx: number, outer: number, inner: number, upper: number, lower: number, iris: number, sign: number) => {
    lm[outer] = { x: cx - (sign * w) / 2, y: hy };
    lm[inner] = { x: cx + (sign * w) / 2, y: hy };
    lm[upper] = { x: cx, y: hy - (open * w) / 2 };
    lm[lower] = { x: cx, y: hy + (open * w) / 2 };
    // Along the corner-to-corner direction (which points the other way for the left eye).
    lm[iris] = { x: cx + sign * dx * w, y: hy + sign * dy * w };
  };
  const L = LANDMARKS;
  eye(hx - s / 2, L.rightOuter, L.rightInner, L.rightUpper, L.rightLower, L.rightIris, 1);
  eye(hx + s / 2, L.leftOuter, L.leftInner, L.leftUpper, L.leftLower, L.leftIris, -1);
  lm[L.noseTip] = { x: hx + yaw * s, y: hy + (0.6 + pitch) * s };
  return lm;
}

function calibrate(r: () => number, noise: number, perDot = 20) {
  const take = (pts: Array<{ x: number; y: number }>) =>
    pts.flatMap((p) => Array.from({ length: perDot }, () => ({ f: gazeFeatures(face(p.x, p.y, r, noise))!, x: p.x, y: p.y })));
  return { calib: take(CALIBRATION_POINTS), checks: take(CHECK_POINTS) };
}

describe('gaze estimation maths', () => {
  it('solves a small linear system', () => {
    expect(
      solve(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5],
      ).map((v) => Math.round(v * 1000) / 1000),
    ).toEqual([0.8, 1.4]);
  });

  it('needs a full face mesh with irises', () => {
    expect(gazeFeatures([{ x: 0, y: 0 }])).toBeNull();
    expect(gazeFeatures(face(0.5, 0.5, rng(1)))).toHaveLength(11);
  });

  it('recovers where a noise-free synthetic face looks, despite head movement', () => {
    const r = rng(7);
    const { calib, checks } = calibrate(r, 0);
    const m = fitGaze(calib, 1e-6);
    expect(calibrationErrorPct(m, checks, { width: 1280, height: 800 })).toBeLessThan(1);
    const p = predictGaze(m, gazeFeatures(face(0.62, 0.21, r))!);
    expect(p.x).toBeCloseTo(0.62, 1);
    expect(p.y).toBeCloseTo(0.21, 1);
  });

  it('reports a larger error when the landmarks are noisy, as a real webcam would', () => {
    const r = rng(11);
    const clean = calibrate(r, 0);
    const noisy = calibrate(r, 0.02);
    const e0 = calibrationErrorPct(fitGaze(clean.calib), clean.checks, { width: 1280, height: 800 });
    const e1 = calibrationErrorPct(fitGaze(noisy.calib), noisy.checks, { width: 1280, height: 800 });
    expect(e1).toBeGreaterThan(e0);
    expect(e1).toBeLessThan(25);
  });

  it('maps screen points onto the picture in thousandths, and nothing outside it', () => {
    const box = { left: 100, top: 50, width: 400, height: 200 };
    expect(toPicture(300, 150, box)).toEqual({ x: 500, y: 500 });
    expect(toPicture(100, 50, box)).toEqual({ x: 0, y: 0 });
    expect(toPicture(99, 150, box)).toBeNull();
    expect(toPicture(300, 251, box)).toBeNull();
  });

  it('smooths jitter and restarts after a gap', () => {
    const s = smoother(0.5);
    expect(s.next({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(s.next({ x: 1, y: 1 })).toEqual({ x: 0.5, y: 0.5 });
    expect(s.next(null)).toBeNull();
    expect(s.next({ x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });
});
