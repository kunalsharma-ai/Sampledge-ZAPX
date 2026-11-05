import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '@zapx/db';
import {
  crosstab,
  describeSegment,
  frequency,
  rake,
  recodeProblems,
  segment,
  variables,
  type AnalysisRecord,
  type Crosstab,
  type Frequency,
  type RakeResult,
  type Variable,
} from '@zapx/analysis-core';
import { parseSurveyDefinition, type Answers, type SurveyDefinition } from '@zapx/survey-schema';
import {
  applyCleaning,
  computeVariables,
  conjointAnalysis,
  conjointDesign,
  maxDiffDesign,
  maxDiffScores,
  prepareSurvey,
  variableLineage,
} from '@zapx/logic-engine';
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
    /** Blueprint phase 5, segmentation: filters on answers (and derived variables), all must hold. */
    answers: z
      .array(
        z.object({
          variable: z.string().min(1).max(100),
          values: z
            .array(z.union([z.number(), z.string().max(100)]))
            .max(100)
            .optional(),
          min: z.number().optional(),
          max: z.number().optional(),
          exclude: z.boolean().optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .prefault({});
export type Filters = z.infer<typeof filtersSchema>;

/** Rim weighting targets (Milestone 15): per variable, a target share per category. */
export const weightingSchema = z
  .object({
    dimensions: z
      .array(
        z.object({
          variable: z.string().max(100),
          targets: z
            .array(z.object({ code: z.union([z.number(), z.string().max(64)]), pct: z.number().min(0).max(100) }))
            .min(1)
            .max(100),
        }),
      )
      .min(1)
      .max(10),
    minWeight: z.number().gt(0).max(1).default(0.2),
    maxWeight: z.number().min(1).max(50).default(5),
  })
  .optional();
export type Weighting = z.infer<typeof weightingSchema>;

export const reportConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('frequencies'),
    filters: filtersSchema,
    weighting: weightingSchema,
    variables: z.array(z.string().max(100)).max(500).optional(),
  }),
  z.object({
    type: z.literal('crosstab'),
    filters: filtersSchema,
    weighting: weightingSchema,
    banner: z.string().max(100),
    stubs: z.array(z.string().max(100)).min(1).max(200),
    confidence: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.99)]).default(0.95),
  }),
  /** Blueprint phase 5: a dashboard of chart tiles, one variable each. */
  z.object({
    type: z.literal('dashboard'),
    filters: filtersSchema,
    weighting: weightingSchema,
    tiles: z
      .array(z.object({ variable: z.string().max(100), chart: z.enum(['bar', 'column', 'donut', 'kpi']).default('bar') }))
      .min(1)
      .max(24),
  }),
]);
export type ReportConfig = z.infer<typeof reportConfigSchema>;

/**
 * Survey analysis (Milestone 10): loads the survey's respondent rows through the tenant-scoped
 * client (row-level security applies), then runs @zapx/analysis-core. Optionally weighted by raking
 * to targets (Milestone 15); the weights are computed per run on the selected interviews.
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
    return prepareSurvey(parsed.definition);
  }

  private where(surveyId: string, f: Filters): Prisma.ResponseWhereInput {
    return {
      surveyId,
      // Blueprint phase 5: interviews erased by the retention policy are left out.
      erasedAt: null,
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
    const rows: Array<{ answers: Record<string, unknown>; system: AnalysisRecord['system'] }> = [];
    const calculated = (def.variables ?? []).length > 0;
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
        rows.push({
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
    // Blueprint phase 5: cleaning rules edit copies of the answers (stored answers never change),
    // before calculated variables are worked out from them.
    const cleaned = def.cleaning?.length
      ? applyCleaning(
          def,
          rows.map((r) => r.answers as Answers),
        )
      : null;
    const all: AnalysisRecord[] = rows.map((r, i) => {
      const answers = (cleaned ? cleaned.answers[i] : r.answers) as Record<string, unknown>;
      return { answers, system: r.system, ...(calculated ? { derived: computeVariables(def, answers as Answers) } : {}) };
    });
    const vars = variables(def, all, { lineage: variableLineage(def) });
    let records = all;
    let segmentText: string | null = null;
    if (filters.answers?.length) {
      try {
        records = segment(vars, all, filters.answers);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      segmentText = describeSegment(vars, filters.answers);
    }
    const cleaning = cleaned ? { changed: cleaned.changed, imputed: cleaned.imputed } : null;
    return { survey, def, records, vars, segment: segmentText, cleaning };
  }

  /** Rake the records to the targets and attach the weights. Returns the diagnostics. */
  applyWeights(vars: Variable[], records: AnalysisRecord[], w: NonNullable<Weighting>): WeightingSummary {
    const dims = w.dimensions.map((d) => ({ variable: this.pick(vars, d.variable), targets: d.targets }));
    let result: RakeResult;
    try {
      result = rake(records, dims, { minWeight: w.minWeight, maxWeight: w.maxWeight });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    result.weights.forEach((x, i) => (records[i]!.weight = x));
    const { weights: _weights, ...summary } = result;
    return summary;
  }

  /** Preview a weighting scheme: efficiency, caps and achieved shares, without running tables. */
  async weights(user: AuthUser, surveyId: string, filters: Filters, weighting: NonNullable<Weighting>) {
    const { vars, records } = await this.load(user, surveyId, filters);
    return { total: records.length, weighting: this.applyWeights(vars, records, weighting) };
  }

  private pick(vars: Variable[], id: string) {
    const v = vars.find((x) => x.id === id);
    if (!v) throw new BadRequestException(`Unknown variable ${id}`);
    return v;
  }

  async variables(user: AuthUser, surveyId: string) {
    const { def, vars, records } = await this.load(user, surveyId, filtersSchema.parse({}));
    return { completes: records.length, variables: vars, recodeProblems: recodeProblems(def) };
  }

  async frequencies(user: AuthUser, surveyId: string, filters: Filters, ids?: string[], weighting?: Weighting) {
    const { vars, records, segment, cleaning } = await this.load(user, surveyId, filters);
    const w = weighting ? this.applyWeights(vars, records, weighting) : null;
    const chosen = ids?.length ? ids.map((id) => this.pick(vars, id)) : vars.filter((v) => v.source !== 'system');
    return { total: records.length, segment, cleaning, weighting: w, frequencies: chosen.map((v) => frequency(v, records)) };
  }

  /** Blueprint phase 5: a dashboard's tiles, each a frequency drawn as the chosen chart. */
  async dashboard(user: AuthUser, surveyId: string, cfg: Extract<ReportConfig, { type: 'dashboard' }>) {
    const { vars, records, segment, cleaning } = await this.load(user, surveyId, cfg.filters);
    const w = cfg.weighting ? this.applyWeights(vars, records, cfg.weighting) : null;
    const tiles = cfg.tiles.map((t) => {
      const v = this.pick(vars, t.variable);
      if (v.kind === 'open') throw new BadRequestException(`${v.id} is an open answer; chart a closed question`);
      return { variable: v.id, label: v.label, chart: t.chart, frequency: frequency(v, records) };
    });
    return { type: 'dashboard' as const, total: records.length, segment, cleaning, weighting: w, tiles };
  }

  async crosstabs(
    user: AuthUser,
    surveyId: string,
    cfg: { filters: Filters; banner: string; stubs: string[]; confidence: number; weighting?: Weighting },
  ) {
    const { vars, records, segment, cleaning } = await this.load(user, surveyId, cfg.filters);
    const w = cfg.weighting ? this.applyWeights(vars, records, cfg.weighting) : null;
    const banner = this.pick(vars, cfg.banner);
    if (banner.kind !== 'single' && banner.kind !== 'multi')
      throw new BadRequestException('Choose a single or multiple choice question as the banner');
    const tables: Crosstab[] = [];
    for (const id of cfg.stubs) {
      const stub = this.pick(vars, id);
      if (stub.kind === 'open' || stub.id === banner.id) continue;
      tables.push(crosstab(banner, stub, records, { confidence: cfg.confidence }));
    }
    return { total: records.length, segment, cleaning, weighting: w, tables };
  }

  /** Blueprint phase 4: MaxDiff counting scores or conjoint part-worths for one question. */
  async choice(user: AuthUser, surveyId: string, questionId: string, filters: Filters, weighting?: Weighting) {
    const { vars, records, def } = await this.load(user, surveyId, filters);
    const w = weighting ? this.applyWeights(vars, records, weighting) : null;
    const q = def.pages.flatMap((p) => p.questions).find((x) => x.id === questionId);
    if (!q || (q.type !== 'maxdiff' && q.type !== 'conjoint')) throw new BadRequestException('Choose a MaxDiff or conjoint question');
    const answers = records.map((r) => r.answers as Answers);
    const weights = records.map((r) => r.weight ?? 1);
    return q.type === 'maxdiff'
      ? { type: 'maxdiff' as const, questionId, total: records.length, weighting: w, result: maxDiffScores(q, answers, weights) }
      : { type: 'conjoint' as const, questionId, total: records.length, weighting: w, result: conjointAnalysis(q, answers, weights) };
  }

  /** The design of a MaxDiff or conjoint question as CSV (one row per item or concept shown). */
  async choiceDesignCsv(user: AuthUser, surveyId: string, questionId: string): Promise<string> {
    const survey = await this.surveys.getSurvey(user, surveyId);
    const def = await this.definition(surveyId, survey.liveVersionId);
    const q = def.pages.flatMap((p) => p.questions).find((x) => x.id === questionId);
    if (!q || (q.type !== 'maxdiff' && q.type !== 'conjoint')) throw new BadRequestException('Choose a MaxDiff or conjoint question');
    if (q.type === 'maxdiff') {
      const lines = ['version,set,position,item_code'];
      maxDiffDesign(q).forEach((v, vi) => v.forEach((set, si) => set.forEach((c, pi) => lines.push(`${vi},${si + 1},${pi + 1},${c}`))));
      return lines.join('\r\n') + '\r\n';
    }
    const lines = [['version', 'task', 'concept', ...q.attributes.map((a) => a.id)].join(',')];
    conjointDesign(q).forEach((v, vi) =>
      v.forEach((task, ti) => task.forEach((c, ci) => lines.push([vi, ti + 1, ci + 1, ...c].join(',')))),
    );
    return lines.join('\r\n') + '\r\n';
  }

  run(user: AuthUser, surveyId: string, cfg: ReportConfig) {
    if (cfg.type === 'dashboard') return this.dashboard(user, surveyId, cfg);
    return cfg.type === 'crosstab'
      ? this.crosstabs(user, surveyId, cfg)
      : this.frequencies(user, surveyId, cfg.filters, cfg.variables, cfg.weighting);
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
    if (result.weighting) {
      const w = result.weighting;
      ws.addRow([
        `Weighted by ${w.dimensions.map((d) => d.variable).join(', ')}`,
        `Efficiency ${Math.round(w.efficiency)}%`,
        `Effective base ${Math.round(w.effectiveBase)}`,
        `Weights ${w.minWeight.toFixed(2)} to ${w.maxWeight.toFixed(2)}`,
        w.converged ? 'Targets met' : 'Targets NOT fully met',
      ]).font = { italic: true };
    } else ws.addRow(['Unweighted']).font = { italic: true };
    if (result.segment) ws.addRow([`Segment: ${result.segment}`]).font = { italic: true };
    if (result.cleaning)
      ws.addRow([
        `Cleaning rules applied: ${Object.entries(result.cleaning.changed)
          .map(([id, n]) => `${id} (${n})`)
          .join(', ')}`,
      ]).font = { italic: true };
    ws.addRow([]);
    if ('tiles' in result) {
      for (const t of result.tiles) writeFrequency(ws, t.frequency);
    } else if ('tables' in result) {
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
const round1 = pct;

export type WeightingSummary = Omit<RakeResult, 'weights'>;

function writeFrequency(ws: ExcelJS.Worksheet, f: Frequency) {
  ws.addRow([]);
  ws.addRow([`${f.variable.id}: ${f.variable.label}`]).font = { bold: true };
  ws.addRow(['Base', round1(f.base), ...(f.base !== f.unweightedBase ? [`unweighted ${f.unweightedBase}`] : [])]);
  if (f.nps) ws.addRow(['Net Promoter Score', Math.round(f.nps.score * 10) / 10]);
  if (f.rows.length) {
    ws.addRow(['', 'Count', '%']).font = { italic: true };
    for (const row of f.rows) ws.addRow([row.label, round1(row.count), pct(row.pct)]);
  }
  if (f.stats) {
    for (const [k, v] of Object.entries(f.stats)) if (k !== 'neff') ws.addRow([k, Math.round((v as number) * 100) / 100]);
  } else if (f.samples) {
    ws.addRow(['Answered', f.base]);
  }
}

function writeCrosstab(ws: ExcelJS.Worksheet, t: Crosstab) {
  ws.addRow([]);
  ws.addRow([`${t.stub.id}: ${t.stub.label}  by  ${t.banner.id}: ${t.banner.label}`]).font = { bold: true };
  ws.addRow(['', ...t.columns.map((c) => (c.letter ? `${c.label} (${c.letter})` : c.label))]).font = { bold: true };
  ws.addRow(['Base', ...t.columns.map((c) => (c.lowBase ? `${round1(c.base)} (low)` : round1(c.base)))]);
  if (t.columns.some((c) => c.base !== c.unweightedBase)) ws.addRow(['Unweighted base', ...t.columns.map((c) => c.unweightedBase)]);
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
