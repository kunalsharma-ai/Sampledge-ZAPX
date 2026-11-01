import { Body, Controller, HttpException, NotFoundException, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { Prisma } from '@zapx/db';
import { textKeys } from '@zapx/logic-engine';
import { parsePresentation, parseSurveyDefinition, type Presentation } from '@zapx/survey-schema';
import { parseBody } from '../common/validation';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { AiError, AiProvider } from '../ai/ai-provider';
import { notConfigured } from '../ai/claude.provider';
import { SurveysService } from './surveys.service';

const translateSchema = z.object({
  language: z.string().min(2).max(35),
  /** Which texts to translate: everything missing or outdated (default), or the listed keys. */
  keys: z.array(z.string().max(200)).max(2000).optional(),
});

/** Texts per model request; keeps answers well under the output limit. */
const BATCH = 120;

/**
 * AI translation of the draft's texts. Results are stored as `machine` translations: a language
 * cannot be offered to respondents (or published) until a person has reviewed every text.
 */
@Controller()
export class TranslateController {
  constructor(
    private readonly ai: AiProvider,
    private readonly surveys: SurveysService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('surveys/:id/translate')
  @Roles(...CAN_EDIT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async translate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(translateSchema, body);
    if (!this.ai.configured) throw toHttp(notConfigured());
    const draft = await this.surveys.draft(user, id);
    const def = parseSurveyDefinition(draft.definition);
    const pres = parsePresentation(draft.presentation);
    if (!def.ok || !pres.ok) throw new HttpException('Fix the draft before translating it.', 422);
    const lang = pres.presentation.languages.find((l) => l.tag === input.language);
    if (!lang) throw new NotFoundException('Add the language first.');

    const all = textKeys(def.definition, pres.presentation);
    const wanted = input.keys
      ? all.filter((k) => input.keys!.includes(k.key))
      : all.filter((k) => {
          const e = lang.texts[k.key];
          return !e || !e.text.trim() || e.source !== k.source;
        });
    const results: Record<string, { text: string; source: string }> = {};
    let model = this.ai.model;
    for (let i = 0; i < wanted.length; i += BATCH) {
      const batch = wanted.slice(i, i + BATCH);
      const r = await this.ai
        .translate({
          from: { tag: def.definition.language, name: pres.presentation.sourceLanguageName ?? def.definition.language },
          to: { tag: lang.tag, name: lang.name },
          surveyTitle: def.definition.title,
          items: batch.map((k) => ({ key: k.key, text: k.source, context: k.context })),
        })
        .catch((e: unknown) => {
          throw toHttp(e);
        });
      model = r.model;
      for (const k of batch) {
        const text = r.translations[k.key];
        if (typeof text === 'string' && text.trim()) results[k.key] = { text: text.slice(0, 10000), source: k.source };
      }
    }

    // Merge into the latest presentation so concurrent edits to other texts are kept.
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "SurveyVersion" WHERE "id" = ${draft.id} FOR UPDATE`;
      const fresh = await tx.surveyVersion.findUniqueOrThrow({ where: { id: draft.id } });
      const latest = parsePresentation(fresh.presentation);
      const next: Presentation = latest.ok ? latest.presentation : pres.presentation;
      const target = next.languages.find((l) => l.tag === lang.tag);
      if (!target) throw new NotFoundException('The language was removed while translating.');
      for (const [key, v] of Object.entries(results)) target.texts[key] = { ...v, status: 'machine' };
      return tx.surveyVersion.update({ where: { id: draft.id }, data: { presentation: next as unknown as Prisma.InputJsonValue } });
    });
    await this.audit.record(user, 'survey.translate.ai', 'survey', id, { language: lang.tag, requested: wanted.length, translated: Object.keys(results).length, model });
    return {
      requested: wanted.length,
      translated: Object.keys(results).length,
      model,
      version: saved,
      check: this.surveys.check(saved.definition, saved.presentation),
    };
  }
}

function toHttp(e: unknown): unknown {
  if (e instanceof AiError) return new HttpException({ message: e.message, code: e.code }, e.status);
  return e;
}
