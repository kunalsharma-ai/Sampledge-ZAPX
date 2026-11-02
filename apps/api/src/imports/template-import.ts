/**
 * Deterministic import of the ZAPX questionnaire template (XLSX or CSV): one row per question,
 * termination or quota. No AI is involved, so the same file always gives the same survey. Every row
 * gets a confidence score and the issues found, which the programmer reviews before applying.
 */
import ExcelJS from 'exceljs';
import { parseSurveyDefinition, VARIABLE_NAME, type SurveyDefinition } from '@zapx/survey-schema';

export const TEMPLATE_COLUMNS = ['Page', 'ID', 'Type', 'Question', 'Options', 'Rows', 'Condition', 'Required', 'Help', 'Min', 'Max', 'Target', 'Notes'] as const;
type Column = (typeof TEMPLATE_COLUMNS)[number];

export interface RowReport {
  /** 1-based row number in the file. */
  row: number;
  id: string | null;
  kind: 'question' | 'termination' | 'quota' | 'skipped';
  /** 0 to 1. Lower when values had to be guessed. */
  confidence: number;
  issues: string[];
}

export interface TemplateImportResult {
  definition: SurveyDefinition | null;
  rows: RowReport[];
  /** Overall confidence: mean of imported rows. */
  confidence: number;
  /** Problems that stop the import (no header, schema errors). */
  errors: string[];
  assumptions: string[];
}

const TYPE_SYNONYMS: Record<string, string> = {
  single: 'single', sa: 'single', 'single choice': 'single', 'single select': 'single', radio: 'single',
  multi: 'multi', ma: 'multi', multiple: 'multi', 'multi choice': 'multi', 'multiple choice': 'multi', 'multi select': 'multi', checkbox: 'multi',
  open: 'open', oe: 'open', text: 'open', 'open end': 'open', 'open ended': 'open', verbatim: 'open',
  numeric: 'numeric', number: 'numeric', num: 'numeric', integer: 'numeric',
  grid: 'grid', matrix: 'grid', scale: 'grid',
  info: 'info', 'text block': 'info', intro: 'info', instruction: 'info', note: 'info',
  terminate: 'terminate', term: 'terminate', 'screen out': 'terminate', screenout: 'terminate', close: 'terminate',
  quality: 'quality_fail', 'quality fail': 'quality_fail', quality_fail: 'quality_fail',
  quota: 'quota',
};

const OPTION_PATTERN = /^\s*(-?\d+)\s*(?:=|\.|\)|:|-)\s*(.+?)\s*$/;

interface ParsedOption {
  code: number;
  label: string;
  anchor?: true;
  exclusive?: true;
}

export function parseOptions(cell: string, issues: string[]): { options: ParsedOption[]; autoCoded: boolean } {
  const parts = cell
    .split(/\r?\n|;|\|/)
    .map((p) => p.trim())
    .filter(Boolean);
  const options: ParsedOption[] = [];
  let autoCoded = false;
  let next = 1;
  for (const part of parts) {
    let text = part;
    const flags = new Set<string>();
    text = text.replace(/\[(exclusive|anchor|excl|fixed)\]/gi, (_m, f: string) => {
      flags.add(f.toLowerCase().startsWith('excl') ? 'exclusive' : 'anchor');
      return '';
    }).trim();
    const m = OPTION_PATTERN.exec(text);
    let code: number;
    let label: string;
    if (m) {
      code = Number(m[1]);
      label = m[2]!;
    } else {
      autoCoded = true;
      while (options.some((o) => o.code === next)) next++;
      code = next++;
      label = text;
    }
    if (!label) continue;
    if (options.some((o) => o.code === code)) issues.push(`Answer code ${code} is used twice`);
    const opt: ParsedOption = { code, label };
    if (flags.has('anchor')) opt.anchor = true;
    if (flags.has('exclusive')) opt.exclusive = true;
    options.push(opt);
  }
  return { options, autoCoded };
}

function parseRows(cell: string, issues: string[]): Array<{ id: string; label: string }> {
  const rows: Array<{ id: string; label: string }> = [];
  cell
    .split(/\r?\n|;|\|/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((part, i) => {
      const m = /^\s*([A-Za-z0-9_]{1,32})\s*(?:=|\.|\)|:)\s*(.+)$/.exec(part);
      const id = m ? m[1]! : `r${i + 1}`;
      if (rows.some((r) => r.id === id)) issues.push(`Grid row id ${id} is used twice`);
      rows.push({ id, label: m ? m[2]!.trim() : part });
    });
  return rows;
}

function num(v: string, field: string, issues: string[]): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  issues.push(`${field} "${v}" is not a number and was ignored`);
  return undefined;
}

function yes(v: string): boolean | undefined {
  if (!v) return undefined;
  if (/^(y|yes|true|1|required)$/i.test(v)) return true;
  if (/^(n|no|false|0|optional)$/i.test(v)) return false;
  return undefined;
}

/** Import rows (header first). Cell values must already be strings. */
export function importTemplateRows(table: string[][], title: string): TemplateImportResult {
  const errors: string[] = [];
  const assumptions: string[] = [];
  const reports: RowReport[] = [];
  const headerIndex = table.findIndex((r) => r.some((c) => /^question$/i.test(c.trim())) && r.some((c) => /^type$/i.test(c.trim())));
  if (headerIndex < 0) {
    return { definition: null, rows: [], confidence: 0, errors: ['No header row found. The template needs at least "Type" and "Question" columns.'], assumptions };
  }
  const header = table[headerIndex]!.map((h) => h.trim().toLowerCase());
  const col = (name: Column) => header.indexOf(name.toLowerCase());
  const get = (row: string[], name: Column) => {
    const i = col(name);
    return i >= 0 ? (row[i] ?? '').trim() : '';
  };

  const pages: Array<{ id: string; questions: Record<string, unknown>[] }> = [];
  const terminations: Record<string, unknown>[] = [];
  const quotas: Record<string, unknown>[] = [];
  const usedIds = new Set<string>();
  let autoPage = 0;
  let autoQ = 0;
  let autoT = 0;
  let autoQt = 0;
  let blankPage = false;

  const uniqueId = (wanted: string, fallback: () => string, issues: string[]): { id: string; generated: boolean } => {
    let id = wanted.replace(/[^A-Za-z0-9_]/g, '_');
    let generated = false;
    if (wanted && !VARIABLE_NAME.test(id)) {
      issues.push(`ID "${wanted}" is not a valid variable name; a new one was assigned`);
      id = '';
    }
    if (!id) {
      id = fallback();
      generated = true;
    }
    while (usedIds.has(id.toLowerCase())) {
      issues.push(`ID ${id} is already used; a suffix was added`);
      id = `${id}_2`;
      generated = true;
    }
    usedIds.add(id.toLowerCase());
    return { id, generated };
  };

  for (let r = headerIndex + 1; r < table.length; r++) {
    const row = table[r]!;
    const rowNo = r + 1;
    if (row.every((c) => !c.trim())) continue;
    const issues: string[] = [];
    let confidence = 1;
    const rawType = get(row, 'Type').toLowerCase().replace(/\s+/g, ' ');
    const text = get(row, 'Question');
    const optionsCell = get(row, 'Options');
    const condition = get(row, 'Condition') || undefined;
    let type = TYPE_SYNONYMS[rawType];
    if (!type) {
      if (rawType) {
        reports.push({ row: rowNo, id: get(row, 'ID') || null, kind: 'skipped', confidence: 0, issues: [`Unknown type "${get(row, 'Type')}"; row skipped`] });
        continue;
      }
      type = optionsCell ? 'single' : text ? 'open' : '';
      if (!type) continue;
      issues.push(`No type given; treated as ${type === 'single' ? 'single choice (it has options)' : 'open text'}`);
      confidence -= 0.3;
    }

    if (type === 'terminate' || type === 'quality_fail') {
      if (!condition) {
        reports.push({ row: rowNo, id: get(row, 'ID') || null, kind: 'skipped', confidence: 0, issues: ['Termination without a condition; row skipped'] });
        continue;
      }
      const { id, generated } = uniqueId(get(row, 'ID'), () => `T${++autoT}`, issues);
      if (generated) confidence -= 0.1;
      terminations.push({ id, condition, status: type === 'quality_fail' ? 'quality_fail' : 'terminate', ...(text ? { label: text } : {}) });
      reports.push({ row: rowNo, id, kind: 'termination', confidence: Math.max(0, confidence), issues });
      continue;
    }

    if (type === 'quota') {
      const target = num(get(row, 'Target') || get(row, 'Max'), 'Target', issues);
      if (!condition || target === undefined) {
        reports.push({ row: rowNo, id: get(row, 'ID') || null, kind: 'skipped', confidence: 0, issues: ['A quota needs a condition and a target; row skipped'] });
        continue;
      }
      const { id, generated } = uniqueId(get(row, 'ID'), () => `QT${++autoQt}`, issues);
      if (generated) confidence -= 0.1;
      quotas.push({ id, condition, target: Math.round(target), ...(text ? { label: text } : {}) });
      reports.push({ row: rowNo, id, kind: 'quota', confidence: Math.max(0, confidence), issues });
      continue;
    }

    if (!text) {
      reports.push({ row: rowNo, id: get(row, 'ID') || null, kind: 'skipped', confidence: 0, issues: ['No question text; row skipped'] });
      continue;
    }
    const { id, generated } = uniqueId(get(row, 'ID'), () => `Q${++autoQ}`, issues);
    if (generated) confidence -= 0.1;
    const notes = get(row, 'Notes').toLowerCase();
    const q: Record<string, unknown> = { id, type, text };
    const help = get(row, 'Help');
    if (help) q.help = help;
    if (condition) q.condition = condition;
    if (type !== 'info') {
      const req = yes(get(row, 'Required'));
      if (req === false) q.required = false;
    }
    if (type === 'single' || type === 'multi' || type === 'grid') {
      const { options, autoCoded } = parseOptions(optionsCell, issues);
      if (!options.length) issues.push('No answer options given');
      if (autoCoded) {
        issues.push('Some options had no code; codes were numbered automatically');
        confidence -= 0.1;
      }
      if (type === 'grid') {
        q.columns = options.map(({ exclusive: _e, ...o }) => o);
        q.rows = parseRows(get(row, 'Rows'), issues);
        if (!(q.rows as unknown[]).length) issues.push('Grid has no rows');
        if (/random/.test(notes)) q.randomizeRows = true;
      } else {
        if (type === 'single' && options.some((o) => o.exclusive)) {
          issues.push('"exclusive" only applies to multiple choice and was ignored');
          options.forEach((o) => delete o.exclusive);
        }
        q.options = options;
        if (/random/.test(notes)) q.randomize = true;
        if (type === 'multi') {
          const min = num(get(row, 'Min'), 'Min', issues);
          const max = num(get(row, 'Max'), 'Max', issues);
          if (min !== undefined) q.minSelected = Math.round(min);
          if (max !== undefined) q.maxSelected = Math.round(max);
        }
      }
    } else if (type === 'numeric') {
      const min = num(get(row, 'Min'), 'Min', issues);
      const max = num(get(row, 'Max'), 'Max', issues);
      if (min !== undefined) q.min = min;
      if (max !== undefined) q.max = max;
      if (/decimal/.test(notes)) q.integer = false;
    } else if (type === 'open') {
      if (/multi.?line|long/.test(notes)) q.multiline = true;
      const max = num(get(row, 'Max'), 'Max', issues);
      if (max !== undefined) q.maxLength = Math.round(max);
    }
    if (issues.some((i) => /No answer options|Grid has no rows/.test(i))) confidence -= 0.5;

    const pageCell = get(row, 'Page');
    let pageId = pageCell.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    if (!pageId) {
      blankPage = true;
      pageId = `P${++autoPage}`;
    }
    while (!pageCell && pages.some((p) => p.id === pageId)) pageId = `P${++autoPage}`;
    let page = pages.find((p) => p.id === pageId);
    if (!page) {
      page = { id: pageId, questions: [] };
      pages.push(page);
    }
    page.questions.push(q);
    reports.push({ row: rowNo, id, kind: 'question', confidence: Math.max(0, Math.round(confidence * 100) / 100), issues });
  }

  if (!pages.length) errors.push('The file has no question rows.');
  if (blankPage) {
    assumptions.push('Questions without a Page value were each put on their own page.');
  }
  const candidate = { schemaVersion: 1, title, pages, terminations, quotas };
  let definition: SurveyDefinition | null = null;
  if (!errors.length) {
    const parsed = parseSurveyDefinition(candidate);
    if (parsed.ok) definition = parsed.definition;
    else errors.push(...parsed.issues.slice(0, 20).map((i) => `${i.path}: ${i.message}`));
  }
  const imported = reports.filter((r) => r.kind !== 'skipped');
  const confidence = imported.length ? Math.round((imported.reduce((s, r) => s + r.confidence, 0) / imported.length) * 100) / 100 : 0;
  return { definition, rows: reports, confidence, errors, assumptions };
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
    return '';
  }
  return String(v);
}

/** Read the "Questionnaire" sheet (or the first sheet) of an XLSX file as a string table. */
export async function readXlsxTable(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Questionnaire') ?? wb.worksheets[0];
  if (!ws) return [];
  const table: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    for (let c = 1; c <= Math.max(row.cellCount, TEMPLATE_COLUMNS.length); c++) cells.push(cellText(row.getCell(c).value));
    table[n - 1] = cells;
  });
  return Array.from(table, (r) => r ?? []);
}

/** The downloadable template, with example rows and an instructions sheet. */
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Questionnaire');
  ws.addRow([...TEMPLATE_COLUMNS]);
  ws.getRow(1).font = { bold: true };
  const examples: string[][] = [
    ['P1', 'AGE', 'numeric', 'How old are you?', '', '', '', 'yes', '', '0', '120', '', ''],
    ['P1', 'GENDER', 'single', 'Are you…', '1=Male\n2=Female\n3=Another identity\n99=Prefer not to say [anchor]', '', '', '', '', '', '', '', ''],
    ['', 'T_UNDERAGE', 'terminate', 'Under 18', '', '', 'AGE < 18', '', '', '', '', '', ''],
    ['P2', 'AWARE', 'multi', 'Which of these brands have you heard of?', '1=Brand A\n2=Brand B\n3=Brand C\n99=None of these [exclusive] [anchor]', '', '', '', 'Select all that apply', '', '', '', 'randomize'],
    ['P3', 'RATE', 'grid', 'How would you rate each brand?', '1=Poor\n2=Fair\n3=Good\n4=Very good\n5=Excellent', 'r1=Brand A\nr2=Brand B', 'not selected(AWARE, 99)', '', '', '', '', '', ''],
    ['P4', 'WHY', 'open', 'Why do you say that?', '', '', '', 'no', '', '', '1000', '', 'multiline'],
    ['', 'QT_WOMEN', 'quota', 'Women', '', '', 'GENDER == 2', '', '', '', '', '200', ''],
  ];
  for (const e of examples) ws.addRow(e);
  ws.columns.forEach((c, i) => {
    c.width = [8, 14, 12, 40, 40, 24, 26, 10, 24, 8, 8, 8, 16][i] ?? 14;
    c.alignment = { wrapText: true, vertical: 'top' };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const help = wb.addWorksheet('How to use');
  const lines = [
    'ZAPX questionnaire template',
    '',
    'One row per question, termination or quota. Replace the example rows with your own.',
    'Page: rows with the same Page value appear on one page. Leave it empty to give the question its own page.',
    'ID: the variable name in the data (letters, digits, _). Leave empty to number automatically.',
    'Type: single, multi, open, numeric, grid, info, terminate, quality, quota.',
    'Options: one per line (or separated by ;) as code=label. Add [exclusive] or [anchor] after a label.',
    'Rows: grid rows, one per line, as id=label.',
    'Condition: for questions, show only when true. For terminate rows, end the interview when true. For quotas, who counts.',
    '  Examples: AGE >= 18   GENDER == 2   selected(AWARE, 3)   not selected(AWARE, 99)   Q1 in [1, 2]',
    'Required: yes (default) or no.',
    'Min / Max: numeric range, or for multi the number of answers allowed, or for open the maximum length.',
    'Target: number of completes for a quota row.',
    'Notes: randomize, multiline, decimal.',
    '',
    'After import you will see every row with a confidence score and any issues. Nothing changes until you apply it.',
  ];
  lines.forEach((l) => help.addRow([l]));
  help.getRow(1).font = { bold: true, size: 14 };
  help.getColumn(1).width = 120;
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
