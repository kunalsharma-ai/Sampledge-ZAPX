import type { SurveyDefinition } from '@zapx/survey-schema';

/** Material the architect reads. PDFs go to the model as documents; other files are text. */
export type AiDocument = { name: string; kind: 'text'; text: string } | { name: string; kind: 'pdf'; base64: string };

export interface ArchitectRequest {
  /** What the programmer asked for, typed or dictated. */
  instruction: string;
  /** The current draft, for edits. Null when building from scratch is fine. */
  current: SurveyDefinition | null;
  documents: AiDocument[];
  /** Set on the repair round: the previous answer and what was wrong with it. */
  feedback?: { previousJson: string; problems: string[] };
}

export interface ArchitectResult {
  summary: string;
  assumptions: string[];
  /** The proposed definition as JSON text; validated by the caller. */
  definitionJson: string;
  /** Model that actually produced the answer (may be a fallback model). */
  model: string;
  /** Set when the primary model declined and a fallback model answered. */
  servedByFallback: boolean;
  usage?: AiTokenUsage;
}

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface TranslateRequest {
  /** Source and target language tags and names. */
  from: { tag: string; name: string };
  to: { tag: string; name: string };
  /** Survey title, for tone and domain. */
  surveyTitle: string;
  items: Array<{ key: string; text: string; context: string }>;
  /** The organization's required translations for terms in these items. */
  glossary?: Array<{ source: string; target: string; note?: string }>;
}

export interface TranslateResult {
  translations: Record<string, string>;
  model: string;
  usage?: AiTokenUsage;
}

/** A table computed by SampCode, given to the research assistant as text. */
export interface InsightTable {
  /** T1, T2... so findings can cite it. */
  id: string;
  title: string;
  /** The table as plain text (bases, percentages, significance letters). */
  text: string;
}

export interface InsightsRequest {
  surveyTitle: string;
  /** What the researcher asked. */
  question: string;
  tables: InsightTable[];
}

export interface InsightsResult {
  /** Short answer to the question. */
  answer: string;
  /** Each finding cites the tables it is read from. */
  findings: Array<{ statement: string; tables: string[] }>;
  /** Limits: low bases, unweighted data, what the tables cannot show. */
  caveats: string[];
  model: string;
  usage?: AiTokenUsage;
}

/** Errors a provider can raise; the controller maps `status` to the HTTP response. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | 'NOT_CONFIGURED'
      | 'NOT_PERMITTED'
      | 'REFUSED'
      | 'RATE_LIMITED'
      | 'BUDGET_EXCEEDED'
      | 'UNAVAILABLE'
      | 'CIRCUIT_OPEN'
      | 'BAD_OUTPUT'
      | 'TOO_LONG'
      | 'BLOCKED_BY_RESIDENCY',
  ) {
    super(message);
  }
}

/**
 * One AI provider (Anthropic today; a fake in tests). Only the AI gateway calls providers, so
 * no other code depends on a vendor SDK. `model` is the configured default; the gateway passes
 * the model chosen for each task.
 */
export abstract class AiProvider {
  /** Registry name, e.g. "anthropic". */
  readonly name: string = 'anthropic';
  abstract readonly configured: boolean;
  abstract readonly model: string;
  abstract architect(req: ArchitectRequest, model?: string): Promise<ArchitectResult>;
  abstract translate(req: TranslateRequest, model?: string): Promise<TranslateResult>;
  /** Research assistant: read computed tables and answer a question about them, citing tables. */
  insights(_req: InsightsRequest, _model?: string): Promise<InsightsResult> {
    return Promise.reject(new AiError('This AI provider cannot answer research questions.', 503, 'NOT_CONFIGURED'));
  }
}
