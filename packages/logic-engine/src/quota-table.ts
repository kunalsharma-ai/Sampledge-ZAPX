/**
 * Interlocking quota tables (blueprint phase 1, tested in phase 4): one quota per combination of
 * two or three single choice or rating questions, e.g. region × age band. Used by the studio's
 * quota table builder; kept here so it is tested with the engine.
 */
import type { Quota, SurveyDefinition } from '@zapx/survey-schema';

export interface QuotaDimension {
  id: string;
  options: Array<{ code: number; label: string }>;
}
export interface QuotaCell {
  key: string;
  label: string;
  condition: string;
  /** Even split of the total (the remainder goes to the first cells), unless overridden. */
  target: number;
}

/** Questions a quota table can use: single choice, and rating scales (each point is a level). */
export function quotaDimensions(def: SurveyDefinition): QuotaDimension[] {
  return def.pages.flatMap((p) =>
    p.questions.flatMap((q): QuotaDimension[] => {
      if (q.type === 'single') return [{ id: q.id, options: q.options.map((o) => ({ code: o.code, label: o.label })) }];
      if (q.type === 'scale') {
        const options = [];
        for (let c = q.min; c <= q.max; c++) options.push({ code: c, label: String(c) });
        return [{ id: q.id, options }];
      }
      return [];
    }),
  );
}

/** Every combination of the chosen dimensions, with its condition and target. */
export function quotaTableCells(dims: QuotaDimension[], total: number, overrides: Record<string, number> = {}): QuotaCell[] {
  const combos = dims.reduce<Array<Array<{ q: string; code: number; label: string }>>>(
    (acc, d) => acc.flatMap((combo) => d.options.map((o) => [...combo, { q: d.id, code: o.code, label: o.label }])),
    [[]],
  );
  if (!dims.length) return [];
  const n = combos.length;
  const base = Math.floor(Math.max(0, total) / n);
  const extra = Math.max(0, total) - base * n;
  return combos.map((c, i) => {
    const key = c.map((x) => `${x.q}${x.code < 0 ? 'm' + -x.code : x.code}`).join('_');
    return {
      key,
      label: c.map((x) => x.label).join(' × '),
      condition: c.map((x) => `${x.q} == ${x.code}`).join(' and '),
      target: overrides[key] ?? base + (i < extra ? 1 : 0),
    };
  });
}

/** The quotas to add for the cells, leaving out ids the survey already has (case-insensitive). */
export function quotasFromCells(def: SurveyDefinition, cells: QuotaCell[]): Quota[] {
  const existing = new Set(def.quotas.map((q) => q.id.toLowerCase()));
  return cells
    .map((c) => ({ id: `QT_${c.key}`.slice(0, 64), label: c.label, condition: c.condition, target: c.target }))
    .filter((q) => !existing.has(q.id.toLowerCase()));
}
