import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Prisma } from '@zapx/db';
import { simulateSurvey } from '@zapx/logic-engine';
import { parseSurveyDefinition } from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { SurveysService } from '../surveys/surveys.service';

export interface QaRunInput {
  respondents: number;
  seed?: string;
  target: 'draft' | 'live';
}

/** One QA Laboratory run, used by the request endpoint (small runs) and the job worker (large runs). */
@Injectable()
export class QaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly audit: AuditService,
  ) {}

  async run(user: AuthUser, surveyId: string, input: QaRunInput, extra: Record<string, unknown> = {}) {
    const survey = await this.surveys.getSurvey(user, surveyId);
    let version;
    if (input.target === 'live') {
      if (!survey.liveVersionId) throw new NotFoundException('This survey has no published version yet');
      version = await this.prisma.surveyVersion.findUniqueOrThrow({ where: { id: survey.liveVersionId } });
    } else {
      version = await this.surveys.draft(user, surveyId);
    }
    const parsed = parseSurveyDefinition(version.definition);
    if (!parsed.ok) throw new UnprocessableEntityException({ message: 'The survey definition is not valid', issues: parsed.issues });
    const seed = input.seed ?? String(randomInt(1, 2 ** 31));
    const report = simulateSurvey(parsed.definition, { respondents: input.respondents, seed });
    const saved = await this.prisma.qaRun.create({
      data: {
        tenantId: user.tenantId,
        surveyId,
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
    await this.audit.record(user, 'survey.qa.run', 'survey', surveyId, {
      runId: saved.id,
      version: version.version,
      respondents: report.respondents,
      passed: report.passed,
      coverage: report.coverage.percent,
      ...extra,
    });
    return { id: saved.id, version: version.version, versionStatus: version.status, createdAt: saved.createdAt, report };
  }
}
