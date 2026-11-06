/**
 * Response exports. One row per respondent, one column per variable, with answer codes (not
 * labels) so the data is analysis-ready. Multiple choice becomes one 0/1 column per option;
 * grids become one column per row. The codebook sheet (XLSX) documents every code.
 */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response, SurveyVersion } from '@zapx/db';
import { EYETRACK_STATUSES, allQuestions, parseEyeTrack, type Answers, type SurveyDefinition } from '@zapx/survey-schema';
import { aoiDwellShares, codes, variables } from '@zapx/analysis-core';
import { computeVariables, prepareSurvey } from '@zapx/logic-engine';

interface Column {
  key: string;
  label: string;
  get(r: ExportRow): string | number | null;
}

export type ExportRow = Pick<
  Response,
  | 'id'
  | 'uid'
  | 'country'
  | 'language'
  | 'device'
  | 'status'
  | 'outcomeReason'
  | 'isTest'
  | 'startedAt'
  | 'completedAt'
  | 'answers'
  | 'mode'
  | 'durationMs'
  | 'qualityScore'
  | 'qualityFlags'
  | 'reviewState'
> & {
  vendor: { code: string } | null;
  interviewer?: { email: string } | null;
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
      { key: 'response_id', label: 'SampCode response id', get: (r) => r.id },
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
      { key: 'mode', label: 'Mode (cawi = online, capi = interviewer)', get: (r) => r.mode.toLowerCase() },
      { key: 'interviewer', label: 'Interviewer (CAPI)', get: (r) => r.interviewer?.email ?? null },
      {
        key: 'loi_seconds',
        label: 'Length of interview (seconds)',
        get: (r) => (r.durationMs === null ? null : Math.round(r.durationMs / 1000)),
      },
      { key: 'quality_score', label: 'Quality score (0-100)', get: (r) => r.qualityScore },
      {
        key: 'quality_flags',
        label: 'Quality flags',
        get: (r) => {
          const flags = Array.isArray(r.qualityFlags) ? (r.qualityFlags as Array<{ code: string; ref?: string }>) : [];
          return flags.length ? flags.map((f) => (f.ref ? `${f.code}:${f.ref}` : f.code)).join(' ') : null;
        },
      },
      { key: 'review', label: 'Quality review (none, pending, accepted, rejected)', get: (r) => r.reviewState.toLowerCase() },
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
      const def = prepareSurvey(v.definition as unknown as SurveyDefinition);
      for (const q of allQuestions(def)) {
        switch (q.type) {
          case 'info':
            break;
          case 'maxdiff':
          case 'conjoint': {
            // The design version and each pick; the design itself is downloadable from Analysis.
            const keys = [
              'v',
              ...(q.type === 'maxdiff'
                ? Array.from({ length: q.sets }, (_, i) => [`b${i + 1}`, `w${i + 1}`]).flat()
                : Array.from({ length: q.tasks }, (_, i) => `t${i + 1}`)),
            ];
            for (const k of keys)
              add({
                key: `${q.id}_${k}`,
                label: `${q.id}: ${k === 'v' ? 'design version' : k.startsWith('b') ? `best in set ${k.slice(1)}` : k.startsWith('w') ? `worst in set ${k.slice(1)}` : `choice in task ${k.slice(1)} (0 = none)`}`,
                get: (r) => {
                  const a = ans(r)[q.id];
                  return a && typeof a === 'object' && !Array.isArray(a) ? ((a as Record<string, number>)[k] ?? null) : null;
                },
              });
            break;
          }
          case 'signature':
            // The drawing stays in SampCode (shown in the review queue); the export says whether it was given.
            add({ key: q.id, label: `${q.id}: signed (1/0)`, get: (r) => (ans(r)[q.id] === undefined ? null : ans(r)[q.id] ? 1 : 0) });
            break;
          case 'eyetrack': {
            // Experimental webcam eye tracking: the outcome, the calibration error, and per area of
            // interest the share of on-picture time spent in it. Raw gaze points stay in SampCode (Analysis).
            const read = (r: ExportRow) => parseEyeTrack(ans(r)[q.id]);
            add({
              key: `${q.id}_status`,
              label: `${q.id}: eye tracking (${EYETRACK_STATUSES.join(', ')})`,
              get: (r) => read(r)?.status ?? null,
            });
            add({
              key: `${q.id}_error_pct`,
              label: `${q.id}: calibration error (% of screen width)`,
              get: (r) => read(r)?.errorPct ?? null,
            });
            for (const aoi of q.aois)
              add({
                key: `${q.id}_aoi${aoi.code}_dwell_pct`,
                label: `${q.id}: ${aoi.label}, share of looking time (%)`,
                get: (r) => {
                  const a = read(r);
                  return a && a.status === 'recorded' ? aoiDwellShares([aoi], a)[0]! : null;
                },
              });
            break;
          }
          case 'hotspot':
            // Like multiple choice: one 0/1 column per area of the picture.
            for (const reg of q.regions)
              add({
                key: `${q.id}_${reg.code}`,
                label: `${q.id}: ${reg.label}`,
                get: (r) => {
                  const a = ans(r)[q.id];
                  if (a === undefined || a === null) return null;
                  return Array.isArray(a) && a.includes(reg.code) ? 1 : 0;
                },
              });
            break;
          case 'cardsort':
            // One column per card: the code of the group it was sorted into.
            for (const o of q.options)
              add({
                key: `${q.id}_${o.code}`,
                label: `${q.id}: group of ${o.label}`,
                get: (r) => {
                  const a = ans(r)[q.id];
                  return a && typeof a === 'object' && !Array.isArray(a) ? ((a as Record<string, number>)[String(o.code)] ?? null) : null;
                },
              });
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
          case 'ranking':
            // One column per item: its rank (1 = first), empty when not ranked.
            for (const o of q.options)
              add({
                key: `${q.id}_${o.code}`,
                label: `${q.id}: rank of ${o.label}`,
                get: (r) => {
                  const a = ans(r)[q.id];
                  if (!Array.isArray(a)) return null;
                  const i = a.indexOf(o.code);
                  return i < 0 ? null : i + 1;
                },
              });
            break;
          case 'sum':
            for (const o of q.options)
              add({
                key: `${q.id}_${o.code}`,
                label: `${q.id}: ${o.label}${q.unit ? ` (${q.unit})` : ''}`,
                get: (r) => {
                  const a = ans(r)[q.id];
                  return a && typeof a === 'object' && !Array.isArray(a) ? ((a as Record<string, number>)[String(o.code)] ?? null) : null;
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
      // URL variables: stored with the answers when the respondent entered.
      for (const u of def.urlVariables ?? [])
        add({
          key: u.id,
          label: u.label ?? `${u.id} (link parameter ${u.param})`,
          get: (r) => {
            const a = ans(r)[u.id];
            return typeof a === 'number' || typeof a === 'string' ? a : null;
          },
        });
      // Calculated variables: worked out from each respondent's answers (formula of the first version that has it).
      for (const variable of def.variables ?? [])
        add({
          key: variable.id,
          label: variable.label ?? `${variable.id} = ${variable.expr}`,
          get: (r) => toCell(computeVariables(def, ans(r))[variable.id]),
        });
      // Recodes: group codes worked out from their source variable (multi-answer recodes as codes joined by ";").
      if ((def.recodes ?? []).length) {
        const vars = variables(def);
        for (const rc of def.recodes ?? []) {
          const v = vars.find((x) => x.id === rc.id && x.derivation?.kind === 'recode');
          if (!v) continue;
          add({
            key: rc.id,
            label: v.label,
            get: (r) => {
              const a = ans(r);
              const c = codes(v, {
                answers: a,
                system: {
                  status: r.status.toLowerCase(),
                  mode: r.mode.toLowerCase(),
                  language: r.language,
                  device: r.device,
                  vendor: r.vendor?.code ?? null,
                },
                ...((def.variables ?? []).length ? { derived: computeVariables(def, a) } : {}),
              });
              return c.length ? (v.kind === 'multi' ? c.join(';') : (c[0] as number)) : null;
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
    wb.creator = 'Sampledge SampCode';
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
    for (const q of allQuestions(prepareSurvey(latest.definition as unknown as SurveyDefinition))) {
      if (q.type === 'single') for (const o of q.options) book.addRow({ variable: q.id, code: o.code, label: o.label });
      if (q.type === 'cardsort') for (const o of q.groups) book.addRow({ variable: `${q.id}_*`, code: o.code, label: o.label });
      if (q.type === 'scale') {
        book.addRow({ variable: q.id, code: q.min, label: q.minLabel ?? `${q.min} (lowest)` });
        book.addRow({ variable: q.id, code: q.max, label: q.maxLabel ?? `${q.max} (highest)` });
        if (q.dontKnow) book.addRow({ variable: q.id, code: q.dontKnow.code, label: q.dontKnow.label });
      }
      if (q.type === 'grid') for (const o of q.columns) book.addRow({ variable: `${q.id}_*`, code: o.code, label: o.label });
    }
    book.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

/** A calculated variable's value as a spreadsheet cell (true/false become 1/0). */
function toCell(v: unknown): string | number | null {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return null;
}
