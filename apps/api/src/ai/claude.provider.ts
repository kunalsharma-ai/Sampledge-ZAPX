import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  AiError,
  AiProvider,
  type ArchitectRequest,
  type ArchitectResult,
  type TranslateRequest,
  type TranslateResult,
} from './ai-provider';
import { ARCHITECT_SYSTEM, TRANSLATOR_SYSTEM } from './prompts';

/** JSON schema the model's answer must follow (structured outputs). */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'assumptions', 'definition_json'],
  properties: {
    summary: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    definition_json: { type: 'string' },
  },
} as const;

const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'text'],
        properties: { key: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
} as const;

/** Escape text placed inside our XML-style wrappers so a document cannot close the tag. */
function wrap(text: string): string {
  return text.replace(/<\/(document|current_draft)/gi, '<\\/$1');
}

export function buildArchitectContent(req: ArchitectRequest): BetaContentBlockParam[] {
  const content: BetaContentBlockParam[] = [];
  for (const doc of req.documents) {
    if (doc.kind === 'pdf') {
      content.push({ type: 'text', text: `The next block is the uploaded document "${doc.name}".` });
      content.push({ type: 'document', title: doc.name, source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 } });
    } else {
      content.push({ type: 'text', text: `<document name="${doc.name.replace(/"/g, "'")}">\n${wrap(doc.text)}\n</document>` });
    }
  }
  if (req.current) {
    content.push({ type: 'text', text: `<current_draft>\n${wrap(JSON.stringify(req.current, null, 2))}\n</current_draft>` });
  }
  let ask = `Programmer's instruction:\n${req.instruction.trim() || 'Program the attached questionnaire.'}`;
  if (req.feedback) {
    ask +=
      `\n\nYour previous answer did not pass validation. Fix every problem below and return the complete corrected survey.\n` +
      req.feedback.problems.map((p) => `- ${p}`).join('\n') +
      `\n\nPrevious definition_json:\n${wrap(req.feedback.previousJson)}`;
  }
  content.push({ type: 'text', text: ask });
  return content;
}

/**
 * Claude implementation of the architect. Uses structured outputs for a parseable answer,
 * adaptive thinking, streaming (answers can be long), and server-side fallbacks so a request the
 * primary model declines is retried on Anthropic's recommended fallback model.
 */
export class ClaudeAiProvider extends AiProvider {
  readonly configured = true;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    opts: { maxRetries: number; timeoutMs: number },
  ) {
    super();
    // The SDK retries 408/409/429/5xx and connection errors with backoff.
    this.client = new Anthropic({ apiKey, maxRetries: opts.maxRetries, timeout: opts.timeoutMs });
  }

  async architect(req: ArchitectRequest, model = this.model): Promise<ArchitectResult> {
    let message: BetaMessage;
    try {
      const stream = this.client.beta.messages.stream({
        model,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        system: ARCHITECT_SYSTEM,
        messages: [{ role: 'user', content: buildArchitectContent(req) }],
      });
      message = await stream.finalMessage();
    } catch (err) {
      throw mapError(err);
    }

    if (message.stop_reason === 'refusal') {
      throw new AiError('The AI declined this request. Rephrase the instruction or edit the survey manually.', 422, 'REFUSED');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new AiError(
        'The survey is too long to generate in one request. Split the questionnaire and import it in parts.',
        422,
        'TOO_LONG',
      );
    }
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed: { summary?: unknown; assumptions?: unknown; definition_json?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiError('The AI returned an answer that could not be read. Try again.', 502, 'BAD_OUTPUT');
    }
    if (typeof parsed.definition_json !== 'string') {
      throw new AiError('The AI answer did not include a survey definition. Try again.', 502, 'BAD_OUTPUT');
    }
    const servedByFallback =
      message.content.some((b) => b.type === 'fallback') || (message.usage.iterations ?? []).some((i) => i.type === 'fallback_message');
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.filter((a): a is string => typeof a === 'string') : [],
      definitionJson: parsed.definition_json,
      model: message.model,
      servedByFallback,
      usage: usageOf(message),
    };
  }

  async translate(req: TranslateRequest, model = this.model): Promise<TranslateResult> {
    let message: BetaMessage;
    const payload = JSON.stringify(req.items.map((i) => ({ key: i.key, context: i.context, text: i.text })));
    try {
      message = await this.client.beta.messages
        .stream({
          model,
          max_tokens: 32000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: TRANSLATION_SCHEMA } },
          system: TRANSLATOR_SYSTEM,
          messages: [
            {
              role: 'user',
              content:
                `Survey: ${req.surveyTitle}\nTranslate from ${req.from.name} (${req.from.tag}) into ${req.to.name} (${req.to.tag}).\n` +
                (req.glossary?.length
                  ? `Glossary (always translate these terms exactly as given):\n<glossary>\n${JSON.stringify(req.glossary).replace(/<\/glossary/gi, '<\\/glossary')}\n</glossary>\n`
                  : '') +
                `Items (JSON array of {key, context, text}):\n<items>\n${payload.replace(/<\/items/gi, '<\\/items')}\n</items>`,
            },
          ],
        })
        .finalMessage();
    } catch (err) {
      throw mapError(err);
    }
    let parsed: { translations?: Array<{ key?: unknown; text?: unknown }> };
    try {
      parsed = JSON.parse(finalText(message));
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError('The AI returned translations that could not be read. Try again.', 502, 'BAD_OUTPUT');
    }
    const translations: Record<string, string> = {};
    for (const t of parsed.translations ?? []) if (typeof t.key === 'string' && typeof t.text === 'string') translations[t.key] = t.text;
    return { translations, model: message.model, usage: usageOf(message) };
  }
}

function usageOf(message: BetaMessage) {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

function finalText(message: BetaMessage): string {
  if (message.stop_reason === 'refusal') {
    throw new AiError('The AI declined this request.', 422, 'REFUSED');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new AiError('The AI answer was cut off because it was too long. Try fewer texts at a time.', 422, 'TOO_LONG');
  }
  return message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
}

function mapError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('The AI key was rejected. An administrator needs to check ANTHROPIC_API_KEY.', 503, 'NOT_CONFIGURED');
  }
  if (err instanceof Anthropic.RateLimitError) return new AiError('The AI service is busy. Try again in a minute.', 429, 'RATE_LIMITED');
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError(`The AI service rejected the request: ${err.message}`, 422, 'BAD_OUTPUT');
  }
  if (err instanceof Anthropic.APIError)
    return new AiError('The AI service is unavailable right now. Try again shortly.', 503, 'UNAVAILABLE');
  return new AiError('The AI service could not be reached. Try again shortly.', 503, 'UNAVAILABLE');
}

/** Used when no API key or model is configured: every call explains how to enable AI. */
export class UnconfiguredAiProvider extends AiProvider {
  readonly configured = false;
  readonly model = '';
  constructor(private readonly reason = 'An administrator needs to set ANTHROPIC_API_KEY and AI_MODEL.') {
    super();
  }
  architect(): Promise<ArchitectResult> {
    return Promise.reject(notConfigured(this.reason));
  }
  translate(): Promise<TranslateResult> {
    return Promise.reject(notConfigured(this.reason));
  }
}

export function notConfigured(reason = 'An administrator needs to set ANTHROPIC_API_KEY and AI_MODEL.'): AiError {
  return new AiError(`AI is not configured on this server. ${reason}`, 503, 'NOT_CONFIGURED');
}
