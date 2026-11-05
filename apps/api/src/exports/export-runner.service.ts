import { NotFoundException, PayloadTooLargeException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { config } from '../config';
import type { AuthUser } from '../auth/auth.types';
import { SurveysService } from '../surveys/surveys.service';
import type { Prisma } from '@zapx/db';
import { applyCleaning, prepareSurvey } from '@zapx/logic-engine';
import type { Answers, SurveyDefinition } from '@zapx/survey-schema';
import { ExportService, type ExportRow } from './export.service';

export interface ExportOptions {
  format: 'csv' | 'xlsx';
  includeTest: boolean;
  /** Upper-case response statuses, e.g. ["COMPLETE"]. */
  statuses?: string[];
  /** Blueprint phase 5: apply the survey's cleaning rules (default true); stored answers never change. */
  cleaned?: boolean;
}

export interface BuiltExport {
  name: string;
  contentType: string;
  data: Buffer;
  rows: number;
}

const PAGE = 2000;

/**
 * Builds a data export. Used directly by the download endpoint for small surveys and by the job
 * worker for any size. Rows are read in pages through the tenant-scoped client (row-level security).
 */
@Injectable()
export class ExportRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly exporter: ExportService,
    private readonly audit: AuditService,
  ) {}

  async count(user: AuthUser, surveyId: string, opts: ExportOptions) {
    await this.surveys.getSurvey(user, surveyId);
    return this.prisma.forTenant(user.tenantId).response.count({ where: this.where(surveyId, opts) });
  }

  private where(surveyId: string, opts: ExportOptions) {
    return {
      surveyId,
      // Blueprint phase 5: interviews erased by the retention policy have no answers left to export.
      erasedAt: null,
      ...(opts.includeTest ? {} : { isTest: false }),
      ...(opts.statuses?.length ? { status: { in: opts.statuses as never[] } } : {}),
    };
  }

  async build(
    user: AuthUser,
    surveyId: string,
    opts: ExportOptions,
    hooks: { maxRows?: number; onProgress?: (done: number, total: number) => Promise<void>; via?: string } = {},
  ): Promise<BuiltExport> {
    const survey = await this.surveys.getSurvey(user, surveyId);
    const versions = await this.prisma.surveyVersion.findMany({
      where: { surveyId, status: { not: 'DRAFT' } },
      orderBy: { version: 'asc' },
    });
    if (opts.format === 'xlsx' && versions.length === 0) throw new NotFoundException('Publish the survey before exporting');
    const db = this.prisma.forTenant(user.tenantId);
    const where = this.where(surveyId, opts);
    const total = await db.response.count({ where });
    if (hooks.maxRows !== undefined && total > hooks.maxRows)
      throw new PayloadTooLargeException(
        `This export has ${total} rows. Exports over ${hooks.maxRows} rows run in the background: use Export in the studio or POST /api/surveys/${surveyId}/jobs/export.`,
      );
    const rows: ExportRow[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await db.response.findMany({
        where,
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { vendor: { select: { code: true } }, version: { select: { version: true } }, interviewer: { select: { email: true } } },
      });
      rows.push(...page);
      await hooks.onProgress?.(rows.length, total);
      if (page.length < PAGE) break;
      cursor = page[page.length - 1]!.id;
    }
    // Blueprint phase 5: cleaning rules of the latest published version, applied to copies of the answers.
    const latest = versions[versions.length - 1];
    const latestDef = latest ? prepareSurvey(latest.definition as unknown as SurveyDefinition) : null;
    let applied: Map<string, string[]> | null = null;
    if (opts.cleaned !== false && latestDef?.cleaning?.length) {
      const res = applyCleaning(
        latestDef,
        rows.map((r) => (r.answers ?? {}) as Answers),
      );
      applied = new Map();
      rows.forEach((r, i) => {
        r.answers = res.answers[i] as Prisma.JsonValue;
        applied!.set(r.id, res.applied[i]!);
      });
    }
    const columns = this.exporter.columns(versions);
    if (applied)
      columns.push({
        key: 'cleaning_rules',
        label: 'Cleaning rules applied to this row (the answers stored in ZAPX are unchanged)',
        get: (r) => applied!.get(r.id)?.join(' ') || null,
      });
    const name = survey.name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'survey';
    await this.audit.record(user, 'survey.export', 'survey', surveyId, {
      format: opts.format,
      rows: rows.length,
      ...(hooks.via ? { via: hooks.via } : {}),
    });
    if (opts.format === 'xlsx')
      return {
        name: `${name}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: await this.exporter.toXlsx(columns, rows, versions),
        rows: rows.length,
      };
    return {
      name: `${name}.csv`,
      contentType: 'text/csv; charset=utf-8',
      data: Buffer.from(this.exporter.toCsv(columns, rows), 'utf8'),
      rows: rows.length,
    };
  }

  static syncLimit() {
    return config().EXPORT_SYNC_MAX_ROWS;
  }
}
