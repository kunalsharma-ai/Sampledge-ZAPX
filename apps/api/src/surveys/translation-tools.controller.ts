import { Body, Controller, Delete, Get, HttpCode, HttpException, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@zapx/db';
import { buildTranslationMemory, memoryMatches, translationQa, type GlossaryTerm } from '@zapx/logic-engine';
import { LANGUAGE_TAG, parsePresentation, parseSurveyDefinition, type Presentation } from '@zapx/survey-schema';
import { parseBody } from '../common/validation';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { SurveysService } from './surveys.service';

const termSchema = z.object({
  language: z.string().regex(LANGUAGE_TAG),
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).optional(),
});
const languageBody = z.object({ language: z.string().regex(LANGUAGE_TAG) });

/** How many recent survey versions feed the translation memory. */
const MEMORY_VERSIONS = 400;

/**
 * Blueprint phase 2: the organization's glossary, translation memory (reviewed translations from
 * its other surveys) and per-language QA.
 */
@Controller()
export class TranslationToolsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly surveys: SurveysService,
  ) {}

  @Get('glossary')
  glossary(@CurrentUser() user: AuthUser, @Query('language') language?: string) {
    return this.prisma.glossaryTerm.findMany({
      where: { tenantId: user.tenantId, ...(language ? { language } : {}) },
      orderBy: [{ language: 'asc' }, { source: 'asc' }],
      take: 2000,
    });
  }

  @Post('glossary')
  @Roles(...CAN_EDIT)
  async addTerm(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const t = parseBody(termSchema, body);
    const term = await this.prisma.glossaryTerm.upsert({
      where: { tenantId_language_source: { tenantId: user.tenantId, language: t.language, source: t.source } },
      create: { tenantId: user.tenantId, ...t, createdById: user.id },
      update: { target: t.target, note: t.note ?? null },
    });
    await this.audit.record(user, 'glossary.set', 'glossary_term', term.id, t);
    return term;
  }

  @Delete('glossary/:id')
  @Roles(...CAN_EDIT)
  @HttpCode(204)
  async removeTerm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const term = await this.prisma.glossaryTerm.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!term) throw new NotFoundException('Glossary term not found');
    await this.prisma.glossaryTerm.delete({ where: { id } });
    await this.audit.record(user, 'glossary.delete', 'glossary_term', id, { language: term.language, source: term.source });
  }

  /** Per-language QA of the draft: blockers and reviewer warnings, with the glossary applied. */
  @Get('surveys/:id/translation-qa')
  async qa(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('language') language: string) {
    const { def, pres } = await this.parsedDraft(user, id);
    if (!pres.languages.some((l) => l.tag === language)) throw new NotFoundException('Add the language first.');
    const glossary = await this.termsFor(user, language);
    const issues = translationQa(def, pres, language, glossary);
    return {
      language,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      issues,
    };
  }

  /**
   * Fill missing or outdated texts with translations a person already approved for the same source
   * text in this organization's surveys. Reused texts keep their approved status.
   */
  @Post('surveys/:id/translation-memory')
  @Roles(...CAN_EDIT)
  async applyMemory(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { language } = parseBody(languageBody, body);
    const draft = await this.surveys.draft(user, id);
    const { def, pres } = this.parse(draft.definition, draft.presentation);
    if (!pres.languages.some((l) => l.tag === language)) throw new NotFoundException('Add the language first.');
    const memory = buildTranslationMemory(await this.approvedEntries(user, language, draft.id));
    const matches = memoryMatches(def, pres, language, memory);
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "SurveyVersion" WHERE "id" = ${draft.id} FOR UPDATE`;
      const fresh = await tx.surveyVersion.findUniqueOrThrow({ where: { id: draft.id } });
      const latest = parsePresentation(fresh.presentation);
      const next: Presentation = latest.ok ? latest.presentation : pres;
      const target = next.languages.find((l) => l.tag === language);
      if (!target) throw new NotFoundException('The language was removed.');
      for (const [key, v] of Object.entries(matches)) target.texts[key] = { ...v, status: 'reviewed' };
      return tx.surveyVersion.update({ where: { id: draft.id }, data: { presentation: next as unknown as Prisma.InputJsonValue } });
    });
    await this.audit.record(user, 'survey.translate.memory', 'survey', id, {
      language,
      reused: Object.keys(matches).length,
      memorySize: memory.size,
    });
    return {
      reused: Object.keys(matches).length,
      memorySize: memory.size,
      version: saved,
      check: this.surveys.check(saved.definition, saved.presentation),
    };
  }

  termsFor(user: AuthUser, language: string): Promise<GlossaryTerm[]> {
    return this.prisma.glossaryTerm
      .findMany({ where: { tenantId: user.tenantId, language }, select: { source: true, target: true, note: true } })
      .then((rows) => rows.map((r) => ({ source: r.source, target: r.target, note: r.note ?? undefined })));
  }

  /** Reviewed translations into one language from the organization's recent survey versions. */
  private async approvedEntries(user: AuthUser, language: string, excludeVersionId: string) {
    const versions = await this.prisma.surveyVersion.findMany({
      where: { survey: { tenantId: user.tenantId }, id: { not: excludeVersionId } },
      orderBy: { updatedAt: 'desc' },
      take: MEMORY_VERSIONS,
      select: { presentation: true },
    });
    const out: Array<{ source: string; text: string }> = [];
    for (const v of versions) {
      const p = parsePresentation(v.presentation);
      if (!p.ok) continue;
      const lang = p.presentation.languages.find((l) => l.tag === language);
      for (const e of Object.values(lang?.texts ?? {})) if (e.status === 'reviewed') out.push({ source: e.source, text: e.text });
    }
    return out;
  }

  private async parsedDraft(user: AuthUser, id: string) {
    const draft = await this.surveys.draft(user, id);
    return this.parse(draft.definition, draft.presentation);
  }

  private parse(definition: unknown, presentation: unknown) {
    const def = parseSurveyDefinition(definition);
    const pres = parsePresentation(presentation);
    if (!def.ok || !pres.ok) throw new HttpException('Fix the draft first.', 422);
    return { def: def.definition, pres: pres.presentation };
  }
}
