import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '@zapx/db';
import { crosstab, frequency, variables, type AnalysisRecord, type Crosstab, type Frequency, type Variable } from '@zapx/analysis-core';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SurveysService } from '../surveys/surveys.service';
import type { AuthUser } from '../auth/auth.types';

/** Analyses read respondent rows into memory; above this, use exports and an analysis tool. */
export const MAX_ANALYSIS_RECORDS = 200_000;
const PAGE = 5_000;

const STATUSES = [
  'IN_PROGRESS',
  'COMPLETE',
  'TERMINATE',
  'QUOTA_FULL',
  'QUALITY_FAIL',
  'SECURITY_REJECT',
  'DUPLICATE',
  'PARTIAL',
  'TECHNICAL_ERROR',
] as const;

export const filtersSchema = z
  .object({
    statuses: z.array(z.enum(STATUSES)).min(1).default(['COMPLETE']),
    includeTest: z.boolean().default(false),
    /** Completes rejected in quality review are left out unless asked for. */
    includeRejected: z.boolean().default(false),
    vendors: z.array(z.string().max(64)).max(100).optional(),
    modes: z.array(z.enum(['CAWI', 'CAPI', 'CATI'])).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .default({});
export type Filters = z.infer<typeof filtersSchema>;

export const reportConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('frequencies'), filters: filtersSchema, variables: z.array(z.string().max(100)).max(500).optional() }),
  z.object({
    type: z.literal('crosstab'),
    filters: filtersSchema,
    banner: z.string().max(100),
    stubs: z.array(z.string().max(100)).min(1).max(200),
    confidence: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.99)]).default(0.95),
  }),
]);
export type ReportConfig = z.infer<typeof reportConfigSchema>;

/**
 * Survey analysis (Milestone 10): loads the survey's respondent rows through the tenant-scoped
 * client (row-level security applies), then runs @zapx/analysis-core. Unweighted.
 */
@Injectable()
export class AnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly audit: AuditService,
  ) {}

  /** The definition to analyse with: the live version, or the draft before the first publish. */
  private async definition(surveyId: string, liveVersionId: string | null): Promise<SurveyDefinition> {
    const version = liveVersionId
      ? await this.prisma.surveyVersion.findUnique({ where: { id: liveVersionId } })
      : await this.prisma.surveyVersion.findFirst({ where: { surveyId, status: 'DRAFT' } });
    const parsed = parseSurveyDefinition(version?.definition);
    if (!parsed.ok) throw new NotFoundException('This survey has no definition to analyse');
    return parsed.definition;
  }

  private where(surveyId: string, f: Filters): Prisma.ResponseWhereInput {
    return {
      surveyId,
      status: { in: [...f.statuses] },
      ...(f.includeTest ? {} : { isTest: false }),
      ...(f.includeRejected ? {} : { reviewState: { not: 'REJECTED' } }),
      ...(f.vendors?.length ? { vendor: { code: { in: f.vendors } } } : {}),
      ...(f.modes?.length ? { mode: { in: f.modes } } : {}),
      ...(f.from || f.to ? { startedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    };
  }

  async load(user: AuthUser, surveyId: string, filters: Filters) {
    const survey = await this.surveys.getSurvey(user, surveyId);
    const def = await this.definition(surveyId, survey.liveVersionId);
    const db = this.prisma.forTenant(user.tenantId);
    const where = this.where(surveyId, filters);
    const total = await db.response.count({ where });
    if (total > MAX_ANALYSIS_RECORDS) {
      throw new PayloadTooLargeException(
        `This selection has ${total} interviews; analyses handle up to ${MAX_ANALYSIS_RECORDS}. Narrow the filters or export the data.`,
      );
    }
    const records: AnalysisRecord[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await db.response.findMany({
        where,
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, answers: true, status: true, mode: true, language: true, device: true, vendor: { select: { code: true } } },
      });
      for (const r of page) {
        records.push({
          answers: (r.answers ?? {}) as Record<string, unknown>,
          system: {
            status: r.status.toLowerCase(),
            vendor: r.vendor?.code ?? null,
            mode: r.mode.toLowerCase(),
            language: r.language,
            device: r.device,
          },
        });
      }
      if (page.length < PAGE) break;
      cursor = page[page.length - 1]!.id;
    }
    return { survey, def, records, vars: variables(def, records) };
  }

  private pick(vars: Variable[], id: string) {
    const v = vars.find((x) => x.id === id);
    if (!v) throw new BadRequestException(`Unknown variable ${id}`);
    return v;
  }

  async variables(user: AuthUser, surveyId: string) {
    const { vars, records } = await this.load(user, surveyId, filtersSchema.parse({}));
    return { completes: records.length, variables: vars };
  }

  async frequencies(user: AuthUser, surveyId: string, filters: Filters, ids?: string[]) {
    const { vars, records } = await this.load(user, surveyId, filters);
    const chosen = ids?.length ? ids.map((id) => this.pick(vars, id)) : vars.filter((v) => v.source !== 'system');
    return { total: records.length, frequencies: chosen.map((v) => frequency(v, records)) };
  }

  async crosstabs(user: AuthUser, surveyId: string, cfg: { filters: Filters; banner: string; stubs: string[]; confidence: number }) {
    const { vars, records } = await this.load(user, surveyId, cfg.filters);
    const banner = this.pick(vars, cfg.banner);
    if (banner.kind !== 'single' && banner.kind !== 'multi')
      throw new BadRequestException('Choose a single or multiple choice question as the banner');
    const tables: Crosstab[] = [];
    for (const id of cfg.stubs) {
      const stub = this.pick(vars, id);
      if (stub.kind === 'open' || stub.id === banner.id) continue;
      tables.push(crosstab(banner, stub, records, { confidence: cfg.confidence }));
    }
    return { total: records.length, tables };
  }

  run(user: AuthUser, surveyId: string, cfg: ReportConfig) {
    return cfg.type === 'crosstab' ? this.crosstabs(user, surveyId, cfg) : this.frequencies(user, surveyId, cfg.filters, cfg.variables);
  }

  // ---- Saved reports ----------------------------------------------------------------------------

  async listReports(user: AuthUser, surveyId: string) {
    await this.surveys.getSurvey(user, surveyId);
    return this.prisma.report.findMany({ where: { surveyId, tenantId: user.tenantId }, orderBy: { updatedAt: 'desc' } });
  }

  async report(user: AuthUser, id: string) {
    const r = await this.prisma.report.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!r) throw new NotFoundException('Report not found');
    await this.surveys.getSurvey(user, r.surveyId);
    return r;
  }

  async saveReport(user: AuthUser, surveyId: string, name: string, config: ReportConfig, id?: string) {
    await this.surveys.getSurvey(user, surveyId);
    const data = { name, config: config as unknown as Prisma.InputJsonValue };
    const r = id
      ? await this.prisma.report.update({ where: { id: (await this.report(user, id)).id }, data })
      : await this.prisma.report.create({ data: { ...data, tenantId: user.tenantId, surveyId, createdById: user.id } });
    await this.audit.record(user, id ? 'report.update' : 'report.create', 'survey', surveyId, { reportId: r.id, name });
    return r;
  }

  async deleteReport(user: AuthUser, id: string) {
    const r = await this.report(user, id);
    await this.prisma.report.delete({ where: { id: r.id } });
    await this.audit.record(user, 'report.delete', 'survey', r.surveyId, { reportId: r.id, name: r.name });
  }

  /** Runs a saved report now and writes it as an Excel workbook. Aggregates only, no respondent rows. */
  async exportReport(user: AuthUser, id: string) {
    const r = await this.report(user, id);
    const cfg = reportConfigSchema.parse(r.config);
    const result = await this.run(user, r.surveyId, cfg);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SAMPLEDGE ZAPX';
    const ws = wb.addWorksheet('Report');
    ws.addRow([r.name]).font = { bold: true, size: 14 };
    ws.addRow([`Interviews: ${result.total}`, `Statuses: ${cfg.filters.statuses.join(', ')}`, `Run ${new Date().toISOString()}`]);
    ws.addRow([]);
    if ('tables' in result) {
      ws.addRow([
        `Column proportions and means tested at ${Math.round(cfg.type === 'crosstab' ? cfg.confidence * 100 : 95)}%; letters show columns a value is significantly higher than.`,
      ]);
      for (const t of result.tables) writeCrosstab(ws, t);
    } else {
      for (const f of result.frequencies) writeFrequency(ws, f);
    }
    ws.getColumn(1).width = 48;
    await this.audit.record(user, 'report.export', 'survey', r.surveyId, { reportId: r.id, interviews: result.total });
    const safe = r.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'report';
    return { name: `${safe}.xlsx`, data: Buffer.from(await wb.xlsx.writeBuffer()) };
  }
}

const pct = (n: number) => Math.round(n * 10) / 10;

function writeFrequency(ws: ExcelJS.Worksheet, f: Frequency) {
  ws.addRow([]);
  ws.addRow([`${f.variable.id}: ${f.variable.label}`]).font = { bold: true };
  ws.addRow(['Base', f.base]);
  if (f.stats) {
    for (const [k, v] of Object.entries(f.stats)) ws.addRow([k, Math.round((v as number) * 100) / 100]);
  } else if (f.samples) {
    ws.addRow(['Answered', f.base]);
  } else {
    ws.addRow(['', 'Count', '%']).font = { italic: true };
    for (const row of f.rows) ws.addRow([row.label, row.count, pct(row.pct)]);
  }
}

function writeCrosstab(ws: ExcelJS.Worksheet, t: Crosstab) {
  ws.addRow([]);
  ws.addRow([`${t.stub.id}: ${t.stub.label}  by  ${t.banner.id}: ${t.banner.label}`]).font = { bold: true };
  ws.addRow(['', ...t.columns.map((c) => (c.letter ? `${c.label} (${c.letter})` : c.label))]).font = { bold: true };
  ws.addRow(['Base', ...t.columns.map((c) => (c.lowBase ? `${c.base} (low)` : c.base))]);
  if (t.means) {
    ws.addRow([
      'Mean',
      ...t.means.map((m) =>
        m.stats ? `${Math.round(m.stats.mean * 100) / 100}${m.higherThan.length ? ` ${m.higherThan.join('')}` : ''}` : '—',
      ),
    ]);
  } else {
    for (const row of t.rows)
      ws.addRow([row.label, ...row.cells.map((c) => `${pct(c.pct)}%${c.higherThan.length ? ` ${c.higherThan.join('')}` : ''}`)]);
  }
  if (t.testNote) ws.addRow([t.testNote]).font = { italic: true };
}
