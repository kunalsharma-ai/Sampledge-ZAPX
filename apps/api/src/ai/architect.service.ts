import { Injectable } from '@nestjs/common';
import { analyzeSurvey } from '@zapx/logic-engine';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { AiError, AiProvider, type AiDocument, type ArchitectResult } from './ai-provider';

export interface ArchitectOutcome {
  definition: SurveyDefinition;
  summary: string;
  assumptions: string[];
  model: string;
  servedByFallback: boolean;
  /** 1, or 2 when the first answer needed a repair round. */
  attempts: number;
  /** Logic errors still present after the repair round (the programmer sees them in review). */
  remainingProblems: string[];
}

/** Problems found in a proposed definition, as plain sentences the model can act on. */
export function problemsIn(json: string): { definition: SurveyDefinition | null; problems: string[]; blocking: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { definition: null, problems: [`definition_json is not valid JSON: ${(e as Error).message}`], blocking: true };
  }
  const parsed = parseSurveyDefinition(raw);
  if (!parsed.ok) {
    return { definition: null, problems: parsed.issues.slice(0, 40).map((i) => `${i.path || '(root)'}: ${i.message}`), blocking: true };
  }
  const analysis = analyzeSurvey(parsed.definition);
  const problems = analysis.issues.filter((i) => i.severity === 'error').slice(0, 40).map((i) => `${i.location}: ${i.message}`);
  return { definition: parsed.definition, problems, blocking: false };
}

/**
 * Runs the AI Survey Architect: asks the provider for a full definition, validates it with the
 * same schema and logic analysis as a manual edit, and gives the model one chance to fix what
 * failed. The result is only a proposal; it becomes a change set for a programmer to review.
 */
@Injectable()
export class ArchitectService {
  constructor(private readonly ai: AiProvider) {}

  get status() {
    return { configured: this.ai.configured, model: this.ai.model };
  }

  async propose(instruction: string, current: SurveyDefinition | null, documents: AiDocument[]): Promise<ArchitectOutcome> {
    let result: ArchitectResult = await this.ai.architect({ instruction, current, documents });
    let check = problemsIn(result.definitionJson);
    let attempts = 1;
    if (check.problems.length) {
      attempts = 2;
      result = await this.ai.architect({
        instruction,
        current,
        documents,
        feedback: { previousJson: result.definitionJson, problems: check.problems },
      });
      check = problemsIn(result.definitionJson);
    }
    if (!check.definition) {
      throw new AiError(`The AI could not produce a valid survey definition: ${check.problems.slice(0, 5).join('; ')}`, 422, 'BAD_OUTPUT');
    }
    return {
      definition: check.definition,
      summary: result.summary,
      assumptions: result.assumptions,
      model: result.model,
      servedByFallback: result.servedByFallback,
      attempts,
      remainingProblems: check.problems,
    };
  }
}
