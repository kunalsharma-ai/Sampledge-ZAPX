import { ConflictException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { Job, Prisma } from '@zapx/db';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { SurveysService } from '../surveys/surveys.service';

export const JOB_TYPES = ['export', 'qa_run', 'ai_propose', 'transcribe'] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** What the studio and API clients see of a job. Inputs that hold documents are not returned. */
export function presentJob(j: Job) {
  return {
    id: j.id,
    type: j.type,
    surveyId: j.surveyId,
    status: j.status,
    progress: j.progress,
    progressNote: j.progressNote,
    result: j.result,
    error: j.error,
    attempts: j.attempts,
    cancelRequested: j.cancelRequested,
    createdById: j.createdById,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}

/** Background jobs (Milestone 7): queue, read and cancel. The JobWorker runs them. */
@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly audit: AuditService,
  ) {}

  async enqueue(user: AuthUser, type: JobType, surveyId: string, input: Record<string, unknown>, opts: { maxAttempts?: number } = {}) {
    await this.surveys.getSurvey(user, surveyId);
    const job = await this.prisma.job.create({
      data: {
        tenantId: user.tenantId,
        type,
        surveyId,
        input: input as Prisma.InputJsonValue,
        createdById: user.id,
        maxAttempts: opts.maxAttempts ?? 2,
        progressNote: 'Waiting for a worker',
      },
    });
    await this.audit.record(user, 'job.create', 'survey', surveyId, { jobId: job.id, type });
    return job;
  }

  /** A job the member can see: same organization and a survey they have access to. */
  async get(user: AuthUser, id: string): Promise<Job> {
    const job = await this.prisma.job.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!job || !job.surveyId) throw new NotFoundException('Job not found');
    await this.surveys.getSurvey(user, job.surveyId).catch(() => {
      throw new NotFoundException('Job not found');
    });
    return job;
  }

  async list(user: AuthUser, surveyId: string, type?: string) {
    await this.surveys.getSurvey(user, surveyId);
    return this.prisma.job.findMany({
      where: { tenantId: user.tenantId, surveyId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async cancel(user: AuthUser, id: string) {
    const job = await this.get(user, id);
    if (job.createdById !== user.id && user.role !== 'ADMIN')
      throw new ForbiddenException('Only the person who started this job or an admin can cancel it');
    if (job.status === 'QUEUED') {
      const n = await this.prisma.job.updateMany({
        where: { id, status: 'QUEUED' },
        data: { status: 'CANCELLED', finishedAt: new Date(), progressNote: 'Cancelled' },
      });
      if (n.count === 1) {
        await this.audit.record(user, 'job.cancel', 'survey', job.surveyId!, { jobId: id, type: job.type });
        return this.prisma.job.findUniqueOrThrow({ where: { id } });
      }
    }
    const fresh = await this.prisma.job.findUniqueOrThrow({ where: { id } });
    if (fresh.status !== 'RUNNING') throw new ConflictException('This job has already finished');
    // A running job stops at its next progress point.
    await this.prisma.job.update({ where: { id }, data: { cancelRequested: true } });
    await this.audit.record(user, 'job.cancel', 'survey', job.surveyId!, { jobId: id, type: job.type });
    return this.prisma.job.findUniqueOrThrow({ where: { id } });
  }
}
