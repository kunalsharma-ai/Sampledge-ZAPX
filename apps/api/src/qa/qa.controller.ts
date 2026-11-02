import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { SurveysService } from '../surveys/surveys.service';
import { QaService } from './qa.service';

/** Upper bound for one run inside a request; up to MAX_QA_JOB_RESPONDENTS run as a background job. */
export const MAX_QA_RESPONDENTS = 2000;
export const MAX_QA_JOB_RESPONDENTS = 10000;

export const qaRunSchema = (max: number) =>
  z.object({
    respondents: z.number().int().min(1).max(max).default(500),
    seed: z.string().max(64).optional(),
    /** Test the editable draft (default) or the version respondents currently get. */
    target: z.enum(['draft', 'live']).default('draft'),
  });
const runSchema = qaRunSchema(MAX_QA_RESPONDENTS);

/**
 * QA Laboratory: simulate synthetic respondents through a version of the survey, using the same
 * logic engine as live interviews, and keep the report. Runs never create responses or touch quotas.
 */
@Controller()
export class QaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly qa: QaService,
  ) {}

  @Post('surveys/:id/qa/run')
  @Roles(...CAN_EDIT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async run(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.qa.run(user, id, parseBody(runSchema, body ?? {}));
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
    await this.surveys.getSurvey(user, run.surveyId).catch(() => {
      throw new NotFoundException('QA run not found');
    });
    return run;
  }
}
