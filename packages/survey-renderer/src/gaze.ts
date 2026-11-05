/**
 * Webcam gaze estimation (experimental), the maths only: features from face landmarks, a ridge
 * regression fitted during calibration, and the calibration error. No camera or model code here, so
 * it is tested on its own. The host supplies the face landmarks (the runtime uses MediaPipe's face
 * landmarker, served from ZAPX).
 *
 * This is an appearance-free, regression-based estimate: where the irises sit between the eye
 * corners, how open the eyes are, and the head's position and turn, mapped to the screen by a fit to
 * the calibration dots. It is approximate (several percent of the screen at best) and has not been
 * validated on real webcams.
 */

export interface Point3 {
  x: number;
  y: number;
  z?: number;
}

/** MediaPipe face mesh indices (478 points with irises). */
export const LANDMARKS = {
  rightOuter: 33,
  rightInner: 133,
  rightUpper: 159,
  rightLower: 145,
  rightIris: 468,
  leftOuter: 263,
  leftInner: 362,
  leftUpper: 386,
  leftLower: 374,
  leftIris: 473,
  noseTip: 1,
} as const;

export const FEATURE_COUNT = 11;

function eyeFeatures(outer: Point3, inner: Point3, upper: Point3, lower: Point3, iris: Point3): [number, number, number] {
  const cx = inner.x - outer.x;
  const cy = inner.y - outer.y;
  const width = Math.hypot(cx, cy) || 1e-6;
  const ux = cx / width;
  const uy = cy / width;
  // Perpendicular, pointing down the face.
  const vx = -uy;
  const vy = ux;
  const mx = (outer.x + inner.x) / 2;
  const my = (outer.y + inner.y) / 2;
  const dx = ((iris.x - mx) * ux + (iris.y - my) * uy) / width;
  const dy = ((iris.x - mx) * vx + (iris.y - my) * vy) / width;
  const open = ((lower.x - upper.x) * vx + (lower.y - upper.y) * vy) / width;
  return [dx, dy, open];
}

/** Gaze features of one video frame, or null when the landmarks are not a full face mesh with irises. */
export function gazeFeatures(lm: Point3[]): number[] | null {
  if (lm.length < 478) return null;
  const L = LANDMARKS;
  const [rdx, rdy, ro] = eyeFeatures(lm[L.rightOuter]!, lm[L.rightInner]!, lm[L.rightUpper]!, lm[L.rightLower]!, lm[L.rightIris]!);
  const [ldx, ldy, lo] = eyeFeatures(lm[L.leftOuter]!, lm[L.leftInner]!, lm[L.leftUpper]!, lm[L.leftLower]!, lm[L.leftIris]!);
  const ro_ = lm[L.rightOuter]!;
  const lo_ = lm[L.leftOuter]!;
  const ex = (ro_.x + lo_.x) / 2;
  const ey = (ro_.y + lo_.y) / 2;
  const scale = Math.hypot(lo_.x - ro_.x, lo_.y - ro_.y) || 1e-6;
  const nose = lm[L.noseTip]!;
  const yaw = (nose.x - ex) / scale;
  const pitch = (nose.y - ey) / scale;
  const f = [rdx, rdy, ldx, ldy, ro, lo, yaw, pitch, ex, ey, scale];
  return f.every(Number.isFinite) ? f : null;
}

/** Solve A x = b (small, dense) by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const piv = M[c]![c]! || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / piv;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / (M[r]![r]! || 1e-12);
  }
  return x;
}

export interface GazeModel {
  mean: number[];
  std: number[];
  bx: number[];
  by: number[];
}

/**
 * Fit the screen position (fractions 0-1 of the viewport) from features with ridge regression on
 * standardized features. `lambda` keeps the fit stable with few calibration points.
 */
export function fitGaze(samples: Array<{ f: number[]; x: number; y: number }>, lambda = 0.5): GazeModel {
  const d = samples[0]?.f.length ?? FEATURE_COUNT;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(0);
  for (const s of samples) s.f.forEach((v, i) => (mean[i]! += v / samples.length));
  for (const s of samples) s.f.forEach((v, i) => (std[i]! += (v - mean[i]!) ** 2 / samples.length));
  for (let i = 0; i < d; i++) std[i] = Math.sqrt(std[i]!) || 1;
  const rows = samples.map((s) => [1, ...s.f.map((v, i) => (v - mean[i]!) / std[i]!)]);
  const p = d + 1;
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  const Xtx2 = new Array<number>(p).fill(0);
  rows.forEach((r, n) => {
    for (let i = 0; i < p; i++) {
      Xty[i]! += r[i]! * samples[n]!.x;
      Xtx2[i]! += r[i]! * samples[n]!.y;
      for (let j = 0; j < p; j++) XtX[i]![j]! += r[i]! * r[j]!;
    }
  });
  // No penalty on the intercept.
  for (let i = 1; i < p; i++) XtX[i]![i]! += lambda;
  return { mean, std, bx: solve(XtX, Xty), by: solve(XtX, Xtx2) };
}

/** Predicted screen position (fractions of the viewport, not clamped). */
export function predictGaze(m: GazeModel, f: number[]): { x: number; y: number } {
  let x = m.bx[0]!;
  let y = m.by[0]!;
  f.forEach((v, i) => {
    const z = (v - m.mean[i]!) / m.std[i]!;
    x += m.bx[i + 1]! * z;
    y += m.by[i + 1]! * z;
  });
  return { x, y };
}

/**
 * Calibration error: the mean distance between predicted and true positions of the check dots, in
 * percent of the viewport width (positions are fractions of width and height).
 */
export function calibrationErrorPct(
  m: GazeModel,
  checks: Array<{ f: number[]; x: number; y: number }>,
  viewport: { width: number; height: number },
): number {
  if (!checks.length) return 100;
  const total = checks.reduce((acc, c) => {
    const p = predictGaze(m, c.f);
    return acc + Math.hypot((p.x - c.x) * viewport.width, (p.y - c.y) * viewport.height);
  }, 0);
  return Math.round((1000 * total) / checks.length / viewport.width) / 10;
}

/** Nine calibration dots and four check dots, as fractions of the viewport. */
export const CALIBRATION_POINTS = [0.1, 0.5, 0.9].flatMap((y) => [0.1, 0.5, 0.9].map((x) => ({ x, y })));
export const CHECK_POINTS = [
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.7 },
  { x: 0.7, y: 0.7 },
];

/** A screen point (pixels) as thousandths of a picture's box, or null when outside it. */
export function toPicture(px: number, py: number, box: { left: number; top: number; width: number; height: number }) {
  const x = ((px - box.left) / box.width) * 1000;
  const y = ((py - box.top) / box.height) * 1000;
  return x < 0 || y < 0 || x > 1000 || y > 1000 || !Number.isFinite(x) || !Number.isFinite(y)
    ? null
    : { x: Math.round(x), y: Math.round(y) };
}

/** Exponential smoothing of a stream of points (webcam estimates jitter from frame to frame). */
export function smoother(alpha = 0.35) {
  let last: { x: number; y: number } | null = null;
  return {
    next(p: { x: number; y: number } | null) {
      if (!p) return (last = null);
      last = last ? { x: last.x + alpha * (p.x - last.x), y: last.y + alpha * (p.y - last.y) } : p;
      return last;
    },
  };
}
