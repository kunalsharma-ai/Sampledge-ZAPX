import { Body, Controller, Get, NotFoundException, Param, Post, UnprocessableEntityException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@zapx/db';
import { simulateSurvey } from '@zapx/logic-engine';
import { parseSurveyDefinition } from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { SurveysService } from '../surveys/surveys.service';

/** Upper bound for one synchronous run; larger volumes move to background jobs later. */
export const MAX_QA_RESPONDENTS = 2000;

const runSchema = z.object({
  respondents: z.number().int().min(1).max(MAX_QA_RESPONDENTS).default(500),
  seed: z.string().max(64).optional(),
  /** Test the editable draft (default) or the version respondents currently get. */
  target: z.enum(['draft', 'live']).default('draft'),
});

/**
 * QA Laboratory: simulate synthetic respondents through a version of the survey, using the same
 * logic engine as live interviews, and keep the report. Runs never create responses or touch quotas.
 */
@Controller()
export class QaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly audit: AuditService,
  ) {}

  @Post('surveys/:id/qa/run')
  @Roles(...CAN_EDIT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async run(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(runSchema, body ?? {});
    const survey = await this.surveys.getSurvey(user, id);
    let version;
    if (input.target === 'live') {
      if (!survey.liveVersionId) throw new NotFoundException('This survey has no published version yet');
      version = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: survey.liveVersionId } });
    } else {
      version = await this.surveys.draft(user, id);
    }
    const parsed = parseSurveyDefinition(version.definition);
    if (!parsed.ok) throw new UnprocessableEntityException({ message: 'The survey definition is not valid', issues: parsed.issues });
    const seed = input.seed ?? String(randomInt(1, 2 ** 31));
    const report = simulateSurvey(parsed.definition, { respondents: input.respondents, seed });
    const saved = await this.prisma.qaRun.create({
      data: {
        tenantId: user.tenantId,
        surveyId: id,
        versionId: version.id,
        version: version.version,
        respondents: report.respondents,
        seed: report.seed,
        passed: report.passed,
        coverage: report.coverage.percent,
        report: report as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });
    await this.audit.record(user, 'survey.qa.run', 'survey', id, {
      runId: saved.id,
      version: version.version,
      respondents: report.respondents,
      passed: report.passed,
      coverage: report.coverage.percent,
    });
    return { id: saved.id, version: version.version, versionStatus: version.status, createdAt: saved.createdAt, report };
  }

  @Get('surveys/:id/qa/runs')
  async list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.surveys.getSurvey(user, id);
    return this.prisma.qaRun.findMany({
      where: { surveyId: id, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, version: true, respondents: true, seed: true, passed: true, coverage: true, createdAt: true },
    });
  }

  @Get('qa/runs/:runId')
  async get(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    const run = await this.prisma.qaRun.findFirst({ where: { id: runId, tenantId: user.tenantId } });
    if (!run) throw new NotFoundException('QA run not found');
    return run;
  }
}
