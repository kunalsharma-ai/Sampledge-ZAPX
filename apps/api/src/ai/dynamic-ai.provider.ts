import { Injectable } from '@nestjs/common';
import { config } from '../config';
import { integration } from '../platform/integrations';
import { AiProvider, type ArchitectRequest, type ArchitectResult, type TranslateRequest, type TranslateResult } from './ai-provider';
import { ClaudeAiProvider, UnconfiguredAiProvider } from './claude.provider';

/**
 * The AI provider set up in Settings > Integrations (or by ANTHROPIC_API_KEY and AI_MODEL until it is).
 * Rebuilt when those settings change, so a new key works at once without a restart.
 */
@Injectable()
export class DynamicAiProvider extends AiProvider {
  private built?: { fingerprint: string; provider: AiProvider };

  private current(): AiProvider {
    const s = integration('anthropic');
    if (this.built?.fingerprint === s.fingerprint) return this.built.provider;
    const cfg = config();
    let provider: AiProvider;
    if (!s.values.apiKey)
      provider = new UnconfiguredAiProvider('An administrator needs to add the Claude API key in Settings > Integrations.');
    else if (!s.values.model)
      provider = new UnconfiguredAiProvider('An administrator needs to choose the Claude model in Settings > Integrations.');
    else if (!s.enabled) provider = new UnconfiguredAiProvider('An administrator has turned Claude off in Settings > Integrations.');
    else
      provider = new ClaudeAiProvider(s.values.apiKey, s.values.model, {
        maxRetries: cfg.AI_MAX_RETRIES,
        timeoutMs: cfg.AI_TIMEOUT_MS,
        baseURL: cfg.ANTHROPIC_API_BASE,
      });
    this.built = { fingerprint: s.fingerprint, provider };
    return provider;
  }

  get configured() {
    return this.current().configured;
  }
  get model() {
    return this.current().model;
  }
  architect(req: ArchitectRequest, model?: string): Promise<ArchitectResult> {
    return this.current().architect(req, model);
  }
  translate(req: TranslateRequest, model?: string): Promise<TranslateResult> {
    return this.current().translate(req, model);
  }
}
