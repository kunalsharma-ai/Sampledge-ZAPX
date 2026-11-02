/**
 * Response exports. One row per respondent, one column per variable, with answer codes (not
 * labels) so the data is analysis-ready. Multiple choice becomes one 0/1 column per option;
 * grids become one column per row. The codebook sheet (XLSX) documents every code.
 */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response, SurveyVersion } from '@zapx/db';
import { allQuestions, type Answers, type SurveyDefinition } from '@zapx/survey-schema';

interface Column {
  key: string;
  label: string;
  get(r: ExportRow): string | number | null;
}

type ExportRow = Pick<
  Response,
  'id' | 'uid' | 'country' | 'language' | 'device' | 'status' | 'outcomeReason' | 'isTest' | 'startedAt' | 'completedAt' | 'answers'
> & {
  vendor: { code: string } | null;
  version: { version: number };
};

/** Prevent spreadsheet formula injection from respondent-typed text. */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : safeCell(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class ExportService {
  /** Columns are the union across every version answered, so data from all versions lines up. */
  columns(versions: Pick<SurveyVersion, 'definition'>[]): Column[] {
    const cols: Column[] = [
      { key: 'response_id', label: 'ZAPX response id', get: (r) => r.id },
      { key: 'uid', label: 'Respondent id (UID)', get: (r) => r.uid },
      { key: 'vendor', label: 'Vendor code', get: (r) => r.vendor?.code ?? null },
      { key: 'country', label: 'Country', get: (r) => r.country },
      { key: 'language', label: 'Language', get: (r) => r.language },
      { key: 'device', label: 'Device', get: (r) => r.device },
      { key: 'status', label: 'Status', get: (r) => r.status.toLowerCase() },
      { key: 'outcome_reason', label: 'Termination or quota that ended the interview', get: (r) => r.outcomeReason },
      { key: 'survey_version', label: 'Survey version answered', get: (r) => r.version.version },
      { key: 'test', label: 'Test response (1 = yes)', get: (r) => (r.isTest ? 1 : 0) },
      { key: 'started_at', label: 'Started (UTC)', get: (r) => r.startedAt.toISOString() },
      { key: 'completed_at', label: 'Finished (UTC)', get: (r) => r.completedAt?.toISOString() ?? null },
    ];
    const seen = new Set(cols.map((c) => c.key));
    const add = (c: Column) => {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        cols.push(c);
      }
    };
    const ans = (r: ExportRow) => (r.answers ?? {}) as Answers;
    for (const v of versions) {
      for (const q of allQuestions(v.definition as unknown as SurveyDefinition)) {
        switch (q.type) {
          case 'info':
            break;
          case 'multi':
            for (const o of q.options)
              add({
                key: `${q.id}_${o.code}`,
                label: `${q.id}: ${o.label}`,
                get: (r) => {
                  const a = ans(r)[q.id];
                  if (a === undefined || a === null) return null;
                  return Array.isArray(a) && a.includes(o.code) ? 1 : 0;
                },
              });
            break;
          case 'grid':
            for (const row of q.rows)
              add({
                key: `${q.id}_${row.id}`,
                label: `${q.id}: ${row.label}`,
                get: (r) => {
                  const a = ans(r)[q.id];
                  return a && typeof a === 'object' && !Array.isArray(a) ? ((a as Record<string, number>)[row.id] ?? null) : null;
                },
              });
            break;
          default:
            add({
              key: q.id,
              label: q.text,
              get: (r) => {
                const a = ans(r)[q.id];
                return typeof a === 'number' || typeof a === 'string' ? a : null;
              },
            });
        }
      }
    }
    return cols;
  }

  toCsv(columns: Column[], rows: ExportRow[]): string {
    const lines = [columns.map((c) => csvEscape(c.key)).join(',')];
    for (const r of rows) lines.push(columns.map((c) => csvEscape(c.get(r))).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  async toXlsx(columns: Column[], rows: ExportRow[], versions: Pick<SurveyVersion, 'definition' | 'version'>[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SAMPLEDGE ZAPX';
    const data = wb.addWorksheet('Responses');
    data.columns = columns.map((c) => ({ header: c.key, key: c.key, width: Math.min(40, Math.max(10, c.key.length + 2)) }));
    for (const r of rows) {
      data.addRow(
        Object.fromEntries(
          columns.map((c) => {
            const v = c.get(r);
            return [c.key, typeof v === 'string' ? safeCell(v) : v];
          }),
        ),
      );
    }
    data.getRow(1).font = { bold: true };
    data.views = [{ state: 'frozen', ySplit: 1 }];

    const book = wb.addWorksheet('Codebook');
    book.columns = [
      { header: 'Variable', key: 'variable', width: 24 },
      { header: 'Description', key: 'description', width: 60 },
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Label', key: 'label', width: 40 },
    ];
    for (const c of columns) book.addRow({ variable: c.key, description: c.label });
    const latest = versions.reduce((a, b) => (b.version > a.version ? b : a));
    for (const q of allQuestions(latest.definition as unknown as SurveyDefinition)) {
      if (q.type === 'single') for (const o of q.options) book.addRow({ variable: q.id, code: o.code, label: o.label });
      if (q.type === 'grid') for (const o of q.columns) book.addRow({ variable: `${q.id}_*`, code: o.code, label: o.label });
    }
    book.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
