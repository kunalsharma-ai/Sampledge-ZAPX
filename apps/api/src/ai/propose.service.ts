import { Injectable } from '@nestjs/common';
import { parseSurveyDefinition } from '@zapx/survey-schema';
import type { AuthUser } from '../auth/auth.types';
import { SurveysService } from '../surveys/surveys.service';
import { ChangeSetsService } from '../changesets/changesets.service';
import { ArchitectService } from './architect.service';
import type { AiDocument } from './ai-provider';

/**
 * AI Survey Architect flow: build or edit the draft from an instruction and optional documents.
 * The result is always a change set for a person to review; the draft is not touched. Used by the
 * request endpoint and by the job worker.
 */
@Injectable()
export class ProposeService {
  constructor(
    private readonly architect: ArchitectService,
    private readonly surveys: SurveysService,
    private readonly changeSets: ChangeSetsService,
  ) {}

  get configured() {
    return this.architect.configured;
  }

  async propose(user: AuthUser, surveyId: string, input: { instruction: string; documents: AiDocument[]; fileName?: string }) {
    const draft = await this.surveys.draft(user, surveyId);
    const current = parseSurveyDefinition(draft.definition);
    const outcome = await this.architect.propose(
      { tenantId: user.tenantId, userId: user.id },
      { instruction: input.instruction, current: current.ok ? current.definition : null, documents: input.documents, surveyId },
    );
    const assumptions = [...outcome.assumptions];
    if (outcome.servedByFallback) assumptions.unshift(`The primary model declined; this proposal was written by ${outcome.model}.`);
    if (outcome.remainingProblems.length) assumptions.push(`Logic problems the AI did not fix: ${outcome.remainingProblems.join('; ')}`);
    return this.changeSets.create(user, surveyId, {
      source: 'AI',
      title: outcome.summary.split(/(?<=\.)\s/)[0]?.slice(0, 200) || 'AI proposal',
      prompt: input.instruction || undefined,
      sourceFileName: input.fileName,
      proposed: outcome.definition,
      assumptions,
      confidence: { summary: outcome.summary, attempts: outcome.attempts, redactions: outcome.redactions },
      producer: outcome.model,
    });
  }
}
