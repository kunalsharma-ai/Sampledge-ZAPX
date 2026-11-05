import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, Survey, SurveyVersion } from '@zapx/db';
import { analyzeSurvey, translationStatus, type AnalysisReport, type TranslationStatus } from '@zapx/logic-engine';
import {
  emptySurvey,
  mediaIdsOf,
  parsePresentation,
  parseSurveyDefinition,
  surveyTemplate,
  type SchemaIssue,
  type SurveyDefinition,
} from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { WebhookService } from '../integrations/webhook.service';
import { PlanService } from '../plans/plan.service';
import type { AuthUser } from '../auth/auth.types';

export interface CheckResult {
  schemaOk: boolean;
  schemaIssues: Array<{ path: string; message: string }>;
  analysis: AnalysisReport | null;
  /** Problems in the theme, language or device settings. */
  presentationIssues: SchemaIssue[];
  translations: TranslationStatus[];
  /** Enabled languages that are not complete and reviewed (they block publishing). */
  languageBlockers: string[];
  publishable: boolean;
}

/**
 * Survey lifecycle: one editable draft version at a time; publishing freezes it.
 * Published versions are immutable, so every response can be traced to the exact questionnaire.
 */
@Injectable()
export class SurveysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly webhooks: WebhookService,
    private readonly plans: PlanService,
  ) {}

  async getSurvey(user: AuthUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, ...this.access.surveys(user) } });
    if (!survey) throw new NotFoundException('Survey not found');
    return survey;
  }

  async create(user: AuthUser, projectId: string, name: string, from: { template?: string; libraryItemId?: string } = {}) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ...this.access.projects(user) } });
    if (!project) throw new NotFoundException('Project not found');
    const definition = await this.startingDefinition(user, name, from);
    const survey = await this.prisma.$transaction(async (tx) => {
      const s = await tx.survey.create({ data: { tenantId: user.tenantId, projectId, name } });
      await tx.surveyVersion.create({
        data: { surveyId: s.id, version: 1, definition: definition as unknown as Prisma.InputJsonValue, createdById: user.id },
      });
      await this.audit.record(user, 'survey.create', 'survey', s.id, { name, ...from }, tx);
      return s;
    });
    return survey;
  }

  /** An empty survey, a built-in template, or a survey from the organization's question bank. */
  private async startingDefinition(user: AuthUser, name: string, from: { template?: string; libraryItemId?: string }) {
    let base: unknown = emptySurvey(name);
    if (from.template) {
      const t = surveyTemplate(from.template);
      if (!t) throw new BadRequestException('Unknown survey template');
      base = t.definition;
    } else if (from.libraryItemId) {
      const item = await this.prisma.libraryItem.findFirst({ where: { id: from.libraryItemId, tenantId: user.tenantId, kind: 'SURVEY' } });
      if (!item) throw new NotFoundException('Saved survey not found');
      base = item.content;
    }
    const parsed = parseSurveyDefinition(base);
    if (!parsed.ok) throw new BadRequestException('The template is not a valid survey');
    return { ...parsed.definition, title: name };
  }

  async detail(user: AuthUser, id: string) {
    const survey = await this.getSurvey(user, id);
    const versions = await this.prisma.surveyVersion.findMany({
      where: { surveyId: id },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, createdAt: true, updatedAt: true, publishedAt: true },
    });
    const counts = await this.prisma.response.groupBy({
      by: ['status'],
      where: { surveyId: id, isTest: false },
      _count: { _all: true },
    });
    return {
      ...survey,
      versions,
      responseCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  /** Current draft; if the latest version is published, a new draft is created from it. */
  async draft(user: AuthUser, id: string): Promise<SurveyVersion> {
    await this.getSurvey(user, id);
    const latest = await this.prisma.surveyVersion.findFirst({ where: { surveyId: id }, orderBy: { version: 'desc' } });
    if (!latest) throw new NotFoundException('Survey has no versions');
    if (latest.status === 'DRAFT') return latest;
    try {
      return await this.prisma.surveyVersion.create({
        data: {
          surveyId: id,
          version: latest.version + 1,
          definition: latest.definition as Prisma.InputJsonValue,
          presentation: latest.presentation as Prisma.InputJsonValue,
          createdById: user.id,
        },
      });
    } catch {
      // A concurrent request created it first.
      return this.prisma.surveyVersion.findFirstOrThrow({ where: { surveyId: id, status: 'DRAFT' } });
    }
  }

  check(definition: unknown, presentation?: unknown): CheckResult {
    const parsed = parseSurveyDefinition(definition);
    const pres = parsePresentation(presentation ?? {});
    const presentationIssues = pres.ok ? [] : pres.issues;
    if (!parsed.ok) {
      return {
        schemaOk: false,
        schemaIssues: parsed.issues,
        analysis: null,
        presentationIssues,
        translations: [],
        languageBlockers: [],
        publishable: false,
      };
    }
    const analysis = analyzeSurvey(parsed.definition);
    const translations = pres.ok ? translationStatus(parsed.definition, pres.presentation) : [];
    const languageBlockers = translations
      .filter((t) => t.enabled && !t.complete)
      .map(
        (t) =>
          `${t.name} (${t.tag}) is offered to respondents but is not ready: ${[
            t.missing.length && `${t.missing.length} missing`,
            t.outdated.length && `${t.outdated.length} outdated`,
            t.unreviewed.length && `${t.unreviewed.length} not reviewed`,
            t.placeholderMismatch.length && `${t.placeholderMismatch.length} with broken {{piping}}`,
          ]
            .filter(Boolean)
            .join(', ')}.`,
      );
    return {
      schemaOk: true,
      schemaIssues: [],
      analysis,
      presentationIssues,
      translations,
      languageBlockers,
      publishable: analysis.ok && pres.ok && languageBlockers.length === 0,
    };
  }

  /** Save the theme, languages and device settings of the draft. */
  async savePresentation(user: AuthUser, id: string, presentation: unknown, expectedUpdatedAt?: string) {
    const draft = await this.draft(user, id);
    const parsed = parsePresentation(presentation);
    if (!parsed.ok) throw new BadRequestException({ message: 'The design or language settings are not valid', issues: parsed.issues });
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== draft.updatedAt.getTime()) {
      throw new ConflictException('Someone else saved this draft since you opened it. Reload to see their changes.');
    }
    const saved = await this.prisma.surveyVersion.update({
      where: { id: draft.id },
      data: { presentation: parsed.presentation as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record(user, 'survey.presentation.save', 'survey', id, {
      version: saved.version,
      languages: parsed.presentation.languages.map((l) => `${l.tag}${l.enabled ? '' : ' (off)'}`),
    });
    return { version: saved, check: this.check(saved.definition, saved.presentation) };
  }

  /** Save the draft. Structurally invalid definitions are rejected; logic issues are reported. */
  async saveDraft(user: AuthUser, id: string, definition: unknown, expectedUpdatedAt?: string) {
    const draft = await this.draft(user, id);
    const parsed = parseSurveyDefinition(definition);
    if (!parsed.ok) throw new BadRequestException({ message: 'The survey definition is not valid', issues: parsed.issues });
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== draft.updatedAt.getTime()) {
      throw new ConflictException('Someone else saved this draft since you opened it. Reload to see their changes.');
    }
    const saved = await this.prisma.surveyVersion.update({
      where: { id: draft.id },
      data: { definition: parsed.definition as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record(user, 'survey.draft.save', 'survey', id, { version: saved.version });
    return { version: saved, check: this.check(parsed.definition, saved.presentation) };
  }

  /** Publish the draft after schema and logic checks pass. */
  async publish(user: AuthUser, id: string) {
    const survey = await this.getSurvey(user, id);
    const draft = await this.prisma.surveyVersion.findFirst({ where: { surveyId: id, status: 'DRAFT' } });
    if (!draft) throw new ConflictException('There is no draft to publish');
    const check = this.check(draft.definition, draft.presentation);
    if (!check.publishable) {
      const message =
        check.languageBlockers.length && check.analysis?.ok
          ? `Finish the translations before publishing. ${check.languageBlockers.join(' ')}`
          : 'Fix the logic errors before publishing';
      throw new UnprocessableEntityException({ message, check });
    }
    // Every image, video and audio file the questionnaire shows must be an upload of this survey.
    const mediaIds = mediaIdsOf(draft.definition as unknown as SurveyDefinition);
    if (mediaIds.length) {
      const found = await this.prisma.mediaAsset.findMany({
        where: { id: { in: mediaIds }, tenantId: user.tenantId, surveyId: id, deletedAt: null },
        select: { id: true },
      });
      const missing = mediaIds.filter((m) => !found.some((f) => f.id === m));
      if (missing.length)
        throw new UnprocessableEntityException({
          message: `Upload the media again before publishing; these files are missing: ${missing.join(', ')}`,
        });
    }
    // A first publish puts the survey live, which counts against the plan.
    if (survey.status === 'DRAFT') await this.plans.assertLiveSurvey(user.tenantId);
    const def = draft.definition as unknown as SurveyDefinition;
    const published = await this.prisma.$transaction(async (tx) => {
      await tx.surveyVersion.updateMany({ where: { surveyId: id, status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } });
      const v = await tx.surveyVersion.update({
        where: { id: draft.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), checkReport: check.analysis as unknown as Prisma.InputJsonValue },
      });
      // Quota counters persist across versions by quota id.
      for (const q of def.quotas) {
        await tx.quotaCount.upsert({
          where: { surveyId_quotaId: { surveyId: id, quotaId: q.id } },
          create: { surveyId: id, quotaId: q.id },
          update: {},
        });
      }
      await tx.survey.update({
        where: { id },
        data: { liveVersionId: v.id, status: survey.status === 'DRAFT' ? 'LIVE' : survey.status },
      });
      await this.audit.record(user, 'survey.publish', 'survey', id, { version: v.version, warnings: check.analysis?.warnings ?? 0 }, tx);
      return v;
    });
    await this.webhooks.emit(user.tenantId, 'survey.published', { surveyId: id, projectId: survey.projectId, version: published.version });
    return { version: published, check };
  }

  async setStatus(user: AuthUser, id: string, status: 'LIVE' | 'PAUSED' | 'CLOSED') {
    const survey = await this.getSurvey(user, id);
    if (status === 'LIVE' && !survey.liveVersionId) throw new ConflictException('Publish a version before going live');
    if (status === 'LIVE' && survey.status !== 'LIVE') await this.plans.assertLiveSurvey(user.tenantId);
    const updated = await this.prisma.survey.update({ where: { id }, data: { status } });
    await this.audit.record(user, 'survey.status', 'survey', id, { from: survey.status, to: status });
    if (survey.status !== status)
      await this.webhooks.emit(user.tenantId, 'survey.status_changed', {
        surveyId: id,
        projectId: survey.projectId,
        from: survey.status,
        to: status,
      });
    return updated;
  }

  /** Every version of the survey, newest first (Programmer workspace history). Definitions not included. */
  async versions(user: AuthUser, id: string) {
    await this.getSurvey(user, id);
    const rows = await this.prisma.surveyVersion.findMany({
      where: { surveyId: id },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, createdAt: true, updatedAt: true, publishedAt: true, createdById: true },
    });
    const authors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))] }, tenantId: user.tenantId },
      select: { id: true, name: true },
    });
    const responses = await this.prisma.response.groupBy({ by: ['versionId'], where: { surveyId: id, isTest: false }, _count: true });
    return rows.map((r) => ({
      ...r,
      createdBy: authors.find((a) => a.id === r.createdById)?.name ?? null,
      responses: responses.find((x) => x.versionId === r.id)?._count ?? 0,
    }));
  }

  async version(user: AuthUser, id: string, version: number) {
    await this.getSurvey(user, id);
    const v = await this.prisma.surveyVersion.findUnique({ where: { surveyId_version: { surveyId: id, version } } });
    if (!v) throw new NotFoundException('Version not found');
    return v;
  }

  async quotas(user: AuthUser, id: string) {
    const survey = await this.getSurvey(user, id);
    if (!survey.liveVersionId) return [];
    const live = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: survey.liveVersionId } });
    const def = live.definition as unknown as SurveyDefinition;
    const counts = await this.prisma.quotaCount.findMany({ where: { surveyId: id } });
    return def.quotas.map((q) => {
      const c = counts.find((x) => x.quotaId === q.id);
      return {
        id: q.id,
        label: q.label ?? q.id,
        condition: q.condition,
        /** The target in force: the live override when one is set, else the published one. */
        target: c?.targetOverride ?? q.target,
        publishedTarget: q.target,
        overridden: c?.targetOverride !== null && c?.targetOverride !== undefined,
        count: c?.count ?? 0,
      };
    });
  }

  /**
   * Change a quota's target while the survey is live, without republishing (live adjustment).
   * `target: null` goes back to the published target. Lowering a target below the count closes
   * the quota; completes already counted are kept.
   */
  async setQuotaTarget(user: AuthUser, id: string, quotaId: string, target: number | null) {
    const survey = await this.getSurvey(user, id);
    if (!survey.liveVersionId) throw new ConflictException('Publish the survey before changing quota targets live');
    const live = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: survey.liveVersionId } });
    const quota = (live.definition as unknown as SurveyDefinition).quotas.find((q) => q.id === quotaId);
    if (!quota) throw new NotFoundException('This quota is not in the live version');
    const before = await this.prisma.quotaCount.findUnique({ where: { surveyId_quotaId: { surveyId: id, quotaId } } });
    await this.prisma.quotaCount.upsert({
      where: { surveyId_quotaId: { surveyId: id, quotaId } },
      create: { surveyId: id, quotaId, targetOverride: target },
      update: { targetOverride: target },
    });
    await this.audit.record(user, 'survey.quota_target', 'survey', id, {
      quota: quotaId,
      from: before?.targetOverride ?? quota.target,
      to: target ?? quota.target,
      reset: target === null,
    });
    return (await this.quotas(user, id)).find((q) => q.id === quotaId);
  }

  async responses(user: AuthUser, id: string, opts: { includeTest: boolean; take: number }) {
    await this.getSurvey(user, id);
    return this.prisma.forTenant(user.tenantId).response.findMany({
      where: { surveyId: id, ...(opts.includeTest ? {} : { isTest: false }) },
      orderBy: { startedAt: 'desc' },
      take: opts.take,
      select: {
        id: true,
        uid: true,
        country: true,
        language: true,
        device: true,
        status: true,
        outcomeReason: true,
        isTest: true,
        startedAt: true,
        completedAt: true,
        mode: true,
        durationMs: true,
        qualityScore: true,
        reviewState: true,
        interviewer: { select: { name: true } },
        vendor: { select: { code: true, name: true } },
        version: { select: { version: true } },
      },
    });
  }
}
