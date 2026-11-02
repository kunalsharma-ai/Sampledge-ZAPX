import type { SurveyDefinition } from '@zapx/survey-schema';

/** Material the architect reads. PDFs go to the model as documents; other files are text. */
export type AiDocument =
  | { name: string; kind: 'text'; text: string }
  | { name: string; kind: 'pdf'; base64: string };

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
  usage?: { inputTokens: number; outputTokens: number };
}

/** Errors a provider can raise; the controller maps `status` to the HTTP response. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'NOT_CONFIGURED' | 'REFUSED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_OUTPUT' | 'TOO_LONG',
  ) {
    super(message);
  }
}

/**
 * The model behind the AI Survey Architect. Swappable (Claude today; a fake in tests), so no
 * other code depends on a specific vendor SDK.
 */
export abstract class AiProvider {
  abstract readonly configured: boolean;
  abstract readonly model: string;
  abstract architect(req: ArchitectRequest): Promise<ArchitectResult>;
}
