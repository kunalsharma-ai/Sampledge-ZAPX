/**
 * Fieldwork metrics from response rows: outcome counts, incidence, length of interview, drop-off
 * by page and quality, overall and per vendor. Pure, so the numbers are testable without a database.
 */
import { median } from './assess.js';

export type FieldworkStatus =
  | 'in_progress'
  | 'complete'
  | 'terminate'
  | 'quota_full'
  | 'quality_fail'
  | 'security_reject'
  | 'duplicate'
  | 'partial'
  | 'technical_error';

export interface FieldworkRow {
  status: FieldworkStatus;
  vendor: string | null;
  durationMs: number | null;
  qualityScore: number | null;
  reviewState: 'none' | 'pending' | 'accepted' | 'rejected';
  /** Last page the respondent reached. */
  lastPageId: string | null;
}

export interface FieldworkSummary {
  starts: number;
  counts: Record<FieldworkStatus, number>;
  /** Completes / (completes + terminates + quality fails), in percent; null before anyone qualifies or screens out. */
  incidence: number | null;
  /** Completes / starts, in percent. */
  completionRate: number | null;
  /** Median length of interview of completes, in seconds. */
  medianLoiSeconds: number | null;
  averageQualityScore: number | null;
  pendingReview: number;
  rejectedInReview: number;
}

export interface Fieldwork {
  total: FieldworkSummary;
  vendors: Array<{ vendor: string; summary: FieldworkSummary }>;
  /** Where unfinished and abandoned interviews stopped, most first. */
  dropOff: Array<{ pageId: string; count: number }>;
}

const ZERO = (): Record<FieldworkStatus, number> => ({
  in_progress: 0,
  complete: 0,
  terminate: 0,
  quota_full: 0,
  quality_fail: 0,
  security_reject: 0,
  duplicate: 0,
  partial: 0,
  technical_error: 0,
});

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

export function summarize(rows: FieldworkRow[]): FieldworkSummary {
  const counts = ZERO();
  for (const r of rows) counts[r.status] += 1;
  const completes = rows.filter((r) => r.status === 'complete');
  const loi = median(completes.map((r) => r.durationMs).filter((d): d is number => d !== null));
  const scores = completes.map((r) => r.qualityScore).filter((s): s is number => s !== null);
  return {
    starts: rows.length,
    counts,
    incidence: pct(counts.complete, counts.complete + counts.terminate + counts.quality_fail),
    completionRate: pct(counts.complete, rows.length),
    medianLoiSeconds: loi === null ? null : Math.round(loi / 1000),
    averageQualityScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    pendingReview: rows.filter((r) => r.reviewState === 'pending' && r.status === 'complete').length,
    rejectedInReview: rows.filter((r) => r.reviewState === 'rejected').length,
  };
}

export function fieldwork(rows: FieldworkRow[]): Fieldwork {
  const byVendor = new Map<string, FieldworkRow[]>();
  for (const r of rows) {
    const key = r.vendor ?? '(no vendor)';
    byVendor.set(key, [...(byVendor.get(key) ?? []), r]);
  }
  const drops = new Map<string, number>();
  for (const r of rows) {
    if ((r.status === 'partial' || r.status === 'in_progress') && r.lastPageId) drops.set(r.lastPageId, (drops.get(r.lastPageId) ?? 0) + 1);
  }
  return {
    total: summarize(rows),
    vendors: [...byVendor.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([vendor, list]) => ({ vendor, summary: summarize(list) })),
    dropOff: [...drops.entries()].map(([pageId, count]) => ({ pageId, count })).sort((a, b) => b.count - a.count),
  };
}
