/**
 * @zapx/analysis-core (Milestone 10): turns a survey definition and response records into
 * frequencies and crosstabs, with the significance tests market researchers expect:
 * column proportions (pooled two-proportion z-test) and column means (Welch's t, normal
 * approximation), each column compared with every other, results shown as column letters.
 *
 * Pure functions, no framework or database. Unweighted.
 */
import { scaleCodes, type SurveyDefinition } from '@zapx/survey-schema';

/** scale: a rating scale; reported like single choice, plus mean (and NPS when it is one). */
export type VariableKind = 'single' | 'multi' | 'numeric' | 'open' | 'scale';

export interface Category {
  code: number | string;
  label: string;
}

export interface Variable {
  id: string;
  label: string;
  kind: VariableKind;
  categories: Category[];
  /** Where it comes from: a question, a grid row, or the interview record (status, vendor, mode). */
  source: 'question' | 'grid_row' | 'item' | 'system';
  /** Grid rows: the grid question and row the answer is stored under (answers[question][row]). */
  grid?: { question: string; row: string };
  /** Ranking and constant sum items: the question and item code (value = rank or amount). */
  item?: { question: string; code: number; of: 'rank' | 'amount' };
  /** Scale: codes that are not points on the scale (e.g. "don't know"), left out of means. */
  excludeFromStats?: Array<number | string>;
  /** Scale: report the Net Promoter Score. */
  nps?: boolean;
}

export interface AnalysisRecord {
  answers: Record<string, unknown>;
  /** System variables, already as plain values: status, vendor, mode, language, device... */
  system: Record<string, string | null>;
}

export const SYSTEM_VARIABLES = ['status', 'vendor', 'mode', 'language', 'device'] as const;
const SYSTEM_LABELS: Record<(typeof SYSTEM_VARIABLES)[number], string> = {
  status: 'Interview status',
  vendor: 'Vendor',
  mode: 'Mode (online, face to face, phone)',
  language: 'Language',
  device: 'Device',
};

const strip = (s: string) =>
  s
    .replace(/\{\{[^}]+\}\}/g, '…')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Variables available for analysis. System variables get their categories from the records,
 * since their values (vendor codes, languages) are not in the definition.
 */
export function variables(def: SurveyDefinition, records: AnalysisRecord[] = []): Variable[] {
  const out: Variable[] = [];
  for (const page of def.pages) {
    for (const q of page.questions) {
      if (q.type === 'single' || q.type === 'multi') {
        out.push({
          id: q.id,
          label: strip(q.text),
          kind: q.type,
          categories: q.options.map((o) => ({ code: o.code, label: o.label })),
          source: 'question',
        });
      } else if (q.type === 'scale') {
        const categories = scaleCodes(q).map((code) => ({
          code,
          label:
            q.dontKnow && code === q.dontKnow.code
              ? q.dontKnow.label
              : code === q.min && q.minLabel
                ? `${code} ${q.minLabel}`
                : code === q.max && q.maxLabel
                  ? `${code} ${q.maxLabel}`
                  : String(code),
        }));
        out.push({
          id: q.id,
          label: strip(q.text),
          kind: 'scale',
          categories,
          source: 'question',
          ...(q.dontKnow ? { excludeFromStats: [q.dontKnow.code] } : {}),
          ...(q.nps ? { nps: true } : {}),
        });
      } else if (q.type === 'ranking' || q.type === 'sum') {
        for (const o of q.options) {
          out.push({
            id: `${q.id}_${o.code}`,
            label: `${strip(q.text)}: ${o.label}${q.type === 'ranking' ? ' (rank)' : q.unit ? ` (${q.unit})` : ''}`,
            kind: 'numeric',
            categories: [],
            source: 'item',
            item: { question: q.id, code: o.code, of: q.type === 'ranking' ? 'rank' : 'amount' },
          });
        }
      } else if (q.type === 'numeric') {
        out.push({ id: q.id, label: strip(q.text), kind: 'numeric', categories: [], source: 'question' });
      } else if (q.type === 'open') {
        out.push({ id: q.id, label: strip(q.text), kind: 'open', categories: [], source: 'question' });
      } else if (q.type === 'grid') {
        for (const row of q.rows) {
          out.push({
            id: `${q.id}_${row.id}`,
            label: `${strip(q.text)}: ${row.label}`,
            kind: 'single',
            categories: q.columns.map((o) => ({ code: o.code, label: o.label })),
            source: 'grid_row',
            grid: { question: q.id, row: row.id },
          });
        }
      }
    }
  }
  for (const id of SYSTEM_VARIABLES) {
    const values = [...new Set(records.map((r) => r.system[id]).filter((v): v is string => !!v))].sort();
    out.push({ id, label: SYSTEM_LABELS[id], kind: 'single', categories: values.map((v) => ({ code: v, label: v })), source: 'system' });
  }
  return out;
}

/** The record's value(s) for a variable, as a list of category codes (empty when not answered). */
function rawValue(v: Variable, r: AnalysisRecord): unknown {
  if (v.source === 'system') return r.system[v.id];
  if (v.item) {
    const a = r.answers[v.item.question];
    if (v.item.of === 'rank') {
      if (!Array.isArray(a)) return undefined;
      const i = a.findIndex((c) => String(c) === String(v.item!.code));
      return i < 0 ? undefined : i + 1;
    }
    return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>)[String(v.item.code)] : undefined;
  }
  if (v.grid) {
    const g = r.answers[v.grid.question];
    return g && typeof g === 'object' && !Array.isArray(g) ? (g as Record<string, unknown>)[v.grid.row] : undefined;
  }
  return r.answers[v.id];
}
function codes(v: Variable, r: AnalysisRecord): Array<number | string> {
  const raw = rawValue(v, r);
  if (raw === undefined || raw === null || raw === '') return [];
  if (v.kind === 'multi') return Array.isArray(raw) ? (raw as Array<number | string>) : [];
  return [raw as number | string];
}
function numberOf(v: Variable, r: AnalysisRecord): number | null {
  const raw = rawValue(v, r);
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}
const same = (a: number | string, b: number | string) => String(a) === String(b);

export interface NumericStats {
  n: number;
  mean: number;
  sd: number;
  min: number;
  median: number;
  max: number;
}
export function numericStats(values: number[]): NumericStats | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { n, mean, sd, min: sorted[0]!, median, max: sorted[n - 1]! };
}

export interface FrequencyRow {
  code: number | string;
  label: string;
  count: number;
  /** Share of people who answered (base), 0-100. For multi, rows can add up to more than 100. */
  pct: number;
}
export interface Frequency {
  variable: Variable;
  /** Records in the analysis. */
  total: number;
  /** Records with an answer to this variable. */
  base: number;
  rows: FrequencyRow[];
  stats: NumericStats | null;
  /** Open answers: a sample of the latest non-empty answers. */
  samples?: string[];
  /** NPS questions: % promoters (9-10) minus % detractors (0-6), of people who gave a score. */
  nps?: { score: number; promoters: number; passives: number; detractors: number; base: number };
}

export function frequency(v: Variable, records: AnalysisRecord[]): Frequency {
  if (v.kind === 'numeric') {
    const values = records.map((r) => numberOf(v, r)).filter((n): n is number => n !== null);
    return { variable: v, total: records.length, base: values.length, rows: [], stats: numericStats(values) };
  }
  if (v.kind === 'open') {
    const texts = records.map((r) => r.answers[v.id]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    return { variable: v, total: records.length, base: texts.length, rows: [], stats: null, samples: texts.slice(-20).reverse() };
  }
  const counts = new Map<string, number>();
  let base = 0;
  for (const r of records) {
    const cs = codes(v, r);
    if (!cs.length) continue;
    base++;
    for (const c of new Set(cs.map(String))) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const rows = v.categories.map((c) => {
    const count = counts.get(String(c.code)) ?? 0;
    return { code: c.code, label: c.label, count, pct: base ? (count / base) * 100 : 0 };
  });
  // Codes in the data that the current definition no longer has (e.g. removed in a later version).
  for (const [code, count] of counts) {
    if (!v.categories.some((c) => same(c.code, code)))
      rows.push({ code, label: `Code ${code} (not in the current version)`, count, pct: base ? (count / base) * 100 : 0 });
  }
  if (v.kind !== 'scale') return { variable: v, total: records.length, base, rows, stats: null };
  const scores = scaleValues(v, records);
  return { variable: v, total: records.length, base, rows, stats: numericStats(scores), ...(v.nps ? { nps: npsOf(scores) } : {}) };
}

/** Scale answers that are points on the scale (not "don't know"), as numbers. */
function scaleValues(v: Variable, records: AnalysisRecord[]): number[] {
  const skip = new Set((v.excludeFromStats ?? []).map(String));
  return records.map((r) => rawValue(v, r)).filter((x): x is number => typeof x === 'number' && !skip.has(String(x)));
}

export function npsOf(scores: number[]) {
  const base = scores.length;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const pct = (n: number) => (base ? (n / base) * 100 : 0);
  return {
    score: pct(promoters) - pct(detractors),
    promoters: pct(promoters),
    passives: pct(base - promoters - detractors),
    detractors: pct(detractors),
    base,
  };
}

// ---- Significance ---------------------------------------------------------------------------

/** Two-sided critical z for the supported confidence levels. */
export const CRITICAL_Z: Record<number, number> = { 0.9: 1.6449, 0.95: 1.96, 0.99: 2.5758 };

/** Pooled two-proportion z statistic for x1/n1 vs x2/n2 (0 when it cannot be computed). */
export function proportionZ(x1: number, n1: number, x2: number, n2: number) {
  if (!n1 || !n2) return 0;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se ? (x1 / n1 - x2 / n2) / se : 0;
}
/** Welch's t for two means, used with the normal critical value (fine for the bases we test). */
export function meanZ(a: NumericStats, b: NumericStats) {
  if (a.n < 2 || b.n < 2) return 0;
  const se = Math.sqrt(a.sd ** 2 / a.n + b.sd ** 2 / b.n);
  return se ? (a.mean - b.mean) / se : 0;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface CrosstabOptions {
  /** 0.90, 0.95 or 0.99. */
  confidence?: number;
  /** Columns with a smaller base are not tested (and are flagged as low base). */
  minBase?: number;
}
export interface CrosstabColumn {
  key: string;
  label: string;
  letter: string;
  base: number;
  lowBase: boolean;
}
export interface CrosstabCell {
  count: number;
  pct: number;
  /** Letters of the columns this cell is significantly higher than. */
  higherThan: string[];
}
export interface CrosstabRow {
  code: number | string;
  label: string;
  /** First cell is the Total column. */
  cells: CrosstabCell[];
}
export interface CrosstabMeanCell {
  stats: NumericStats | null;
  higherThan: string[];
}
export interface Crosstab {
  banner: Variable;
  stub: Variable;
  confidence: number;
  minBase: number;
  /** Total first, then one column per banner category. */
  columns: CrosstabColumn[];
  rows: CrosstabRow[];
  /** Numeric stubs: one mean row. */
  means?: CrosstabMeanCell[];
  /** Why tests were not run, when they were not (e.g. overlapping columns from a multi banner). */
  testNote: string | null;
}

/**
 * Crosstab of a stub (rows) by a banner (columns). Bases are people who answered the stub within
 * each banner column. Significance compares each banner column with every other banner column.
 */
export function crosstab(banner: Variable, stub: Variable, records: AnalysisRecord[], opts: CrosstabOptions = {}): Crosstab {
  if (banner.kind !== 'single' && banner.kind !== 'multi' && banner.kind !== 'scale')
    throw new Error('The banner must be a single choice, multiple choice or scale variable');
  if (stub.kind === 'open') throw new Error('Open answers cannot be crosstabulated');
  const confidence = opts.confidence ?? 0.95;
  const crit = CRITICAL_Z[confidence];
  if (!crit) throw new Error('Confidence must be 0.90, 0.95 or 0.99');
  const minBase = opts.minBase ?? 30;

  // Records per column (Total + banner categories). A multi banner puts a record in several columns.
  const groups: Array<{ key: string; label: string; records: AnalysisRecord[] }> = [{ key: 'total', label: 'Total', records }];
  for (const c of banner.categories) {
    groups.push({ key: String(c.code), label: c.label, records: records.filter((r) => codes(banner, r).some((x) => same(x, c.code))) });
  }
  const testable = banner.kind !== 'multi';
  const testNote = testable ? null : 'Not tested: people can be in more than one column of a multiple choice banner.';

  const freq = groups.map((g) => frequency(stub, g.records));
  const columns: CrosstabColumn[] = groups.map((g, i) => ({
    key: g.key,
    label: g.label,
    letter: i === 0 ? '' : (LETTERS[i - 1] ?? `${i}`),
    base: freq[i]!.base,
    lowBase: i > 0 && freq[i]!.base < minBase,
  }));

  const sigAgainst = (i: number, j: number) => testable && i > 0 && j > 0 && i !== j && !columns[i]!.lowBase && !columns[j]!.lowBase;

  const meanRow = () => {
    const stats = freq.map((f) => f.stats);
    return stats.map((s, i) => ({
      stats: s,
      higherThan: columns
        .map((_, j) => j)
        .filter((j) => sigAgainst(i, j) && s && stats[j] && meanZ(s, stats[j]!) > crit)
        .map((j) => columns[j]!.letter),
    }));
  };
  if (stub.kind === 'numeric') return { banner, stub, confidence, minBase, columns, rows: [], means: meanRow(), testNote };

  const rowKeys = freq[0]!.rows.map((r) => ({ code: r.code, label: r.label }));
  const rows: CrosstabRow[] = rowKeys.map((rk) => {
    const cells = freq.map((f) => {
      const row = f.rows.find((r) => same(r.code, rk.code));
      return { count: row?.count ?? 0, pct: row?.pct ?? 0, higherThan: [] as string[] };
    });
    cells.forEach((cell, i) => {
      cell.higherThan = columns
        .map((_, j) => j)
        .filter((j) => sigAgainst(i, j) && proportionZ(cell.count, columns[i]!.base, cells[j]!.count, columns[j]!.base) > crit)
        .map((j) => columns[j]!.letter);
    });
    return { code: rk.code, label: rk.label, cells };
  });
  // Scales show the share per point and the mean score (points on the scale only).
  return { banner, stub, confidence, minBase, columns, rows, ...(stub.kind === 'scale' ? { means: meanRow() } : {}), testNote };
}
