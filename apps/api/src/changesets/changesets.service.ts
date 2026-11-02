import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ChangeSet, Prisma } from '@zapx/db';
import { diffSurveys, simulateSurvey } from '@zapx/logic-engine';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { SurveysService } from '../surveys/surveys.service';

export interface NewChangeSet {
  source: 'AI' | 'IMPORT' | 'MANUAL';
  title: string;
  prompt?: string;
  sourceFileName?: string;
  proposed: SurveyDefinition;
  assumptions?: string[];
  confidence?: unknown;
  producer: string;
}

/** Respondents simulated for the quick QA preview attached to every change set. */
const PREVIEW_RESPONDENTS = 200;

/**
 * Change sets are how anything other than a person's own edit reaches a draft. Each one stores
 * the full proposal, a structured diff, and the same schema, logic and QA checks a manual edit
 * gets. Applying requires a programmer and fails if the draft changed since the proposal was made.
 */
@Injectable()
export class ChangeSetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly surveys: SurveysService,
  ) {}

  async create(user: AuthUser, surveyId: string, input: NewChangeSet): Promise<ChangeSet> {
    const draft = await this.surveys.draft(user, surveyId);
    const base = parseSurveyDefinition(draft.definition);
    const check = this.surveys.check(input.proposed, draft.presentation);
    const qa = check.schemaOk ? simulateSurvey(input.proposed, { respondents: PREVIEW_RESPONDENTS, seed: 'changeset' }) : null;
    const diff = base.ok ? diffSurveys(base.definition, input.proposed) : null;
    const cs = await this.prisma.changeSet.create({
      data: {
        tenantId: user.tenantId,
        surveyId,
        baseVersionId: draft.id,
        baseUpdatedAt: draft.updatedAt,
        source: input.source,
        title: input.title.slice(0, 200),
        prompt: input.prompt?.slice(0, 20000),
        sourceFileName: input.sourceFileName?.slice(0, 200),
        proposedDefinition: input.proposed as unknown as Prisma.InputJsonValue,
        diff: (diff ?? {
          items: [],
          counts: { added: 0, removed: 0, changed: 0, moved: 0 },
          affectsData: false,
        }) as unknown as Prisma.InputJsonValue,
        assumptions: (input.assumptions ?? []) as Prisma.InputJsonValue,
        confidence: (input.confidence ?? undefined) as Prisma.InputJsonValue | undefined,
        check: {
          ...check,
          qa: qa && {
            respondents: qa.respondents,
            passed: qa.passed,
            coverage: qa.coverage,
            outcomes: qa.outcomes,
            defects: qa.defects.map(({ example: _e, ...d }) => d),
          },
        } as unknown as Prisma.InputJsonValue,
        producer: input.producer,
        createdById: user.id,
      },
    });
    await this.audit.record(user, 'changeset.create', 'survey', surveyId, {
      changeSetId: cs.id,
      source: input.source,
      producer: input.producer,
      changes: diff?.items.length ?? null,
    });
    return cs;
  }

  async list(user: AuthUser, surveyId: string) {
    await this.surveys.getSurvey(user, surveyId);
    return this.prisma.changeSet.findMany({
      where: { surveyId, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        source: true,
        status: true,
        producer: true,
        sourceFileName: true,
        createdAt: true,
        decidedAt: true,
        baseVersionId: true,
      },
    });
  }

  async get(user: AuthUser, id: string): Promise<ChangeSet & { stale: boolean }> {
    const cs = await this.prisma.changeSet.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!cs) throw new NotFoundException('Change set not found');
    return { ...cs, stale: cs.status === 'PROPOSED' && !(await this.isCurrent(cs)) };
  }

  private async isCurrent(cs: ChangeSet): Promise<boolean> {
    const draft = await this.prisma.surveyVersion.findFirst({ where: { surveyId: cs.surveyId, status: 'DRAFT' } });
    return !!draft && draft.id === cs.baseVersionId && draft.updatedAt.getTime() === cs.baseUpdatedAt.getTime();
  }

  /** Write the proposal into the draft, only if the draft is exactly what it was based on. */
  async apply(user: AuthUser, id: string) {
    const cs = await this.get(user, id);
    if (cs.status !== 'PROPOSED') throw new ConflictException(`This change set was already ${cs.status.toLowerCase()}.`);
    const parsed = parseSurveyDefinition(cs.proposedDefinition);
    if (!parsed.ok) throw new ConflictException('This proposal is not a valid survey definition and cannot be applied.');
    const result = await this.prisma.$transaction(async (tx) => {
      const written = await tx.surveyVersion.updateMany({
        where: { id: cs.baseVersionId, status: 'DRAFT', updatedAt: cs.baseUpdatedAt },
        data: { definition: parsed.definition as unknown as Prisma.InputJsonValue },
      });
      if (written.count !== 1) {
        throw new ConflictException('The draft changed after this proposal was made. Create a new proposal from the current draft.');
      }
      const decided = await tx.changeSet.updateMany({
        where: { id, status: 'PROPOSED' },
        data: { status: 'APPLIED', decidedById: user.id, decidedAt: new Date() },
      });
      if (decided.count !== 1) throw new ConflictException('This change set was decided by someone else.');
      await this.audit.record(
        user,
        'changeset.apply',
        'survey',
        cs.surveyId,
        { changeSetId: id, source: cs.source, producer: cs.producer },
        tx,
      );
      return tx.surveyVersion.findUniqueOrThrow({ where: { id: cs.baseVersionId } });
    });
    return { version: result, check: this.surveys.check(parsed.definition, result.presentation) };
  }

  async reject(user: AuthUser, id: string) {
    const cs = await this.get(user, id);
    const decided = await this.prisma.changeSet.updateMany({
      where: { id, status: 'PROPOSED' },
      data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date() },
    });
    if (decided.count !== 1) throw new ConflictException(`This change set was already ${cs.status.toLowerCase()}.`);
    await this.audit.record(user, 'changeset.reject', 'survey', cs.surveyId, { changeSetId: id });
    return { ok: true };
  }
}
