# 0004 · AI model gateway

Date: 2026-11-01 · Status: Accepted

## Context

Claude is the primary AI provider; OpenAI and Google Gemini may be added. Requirements: model per
task, structured and validated outputs, usage and cost tracking, rate limits, retries, circuit
breaking, tenant permissions, human approval for high-impact actions, prompt-injection defences,
redaction, audit, and no hardcoded credentials or model ids.

## Decision

Every AI call goes through `AiGateway.run(task, actor, call)`:

1. **Provider registry**: `AI_PROVIDER` picks an `AiProvider` implementation (only `anthropic`
   exists). Providers are thin: they turn a task request into an API call and map errors.
2. **Model per task** from configuration: `AI_MODEL_<TASK>`, falling back to `AI_MODEL`. No model
   id appears in code; AI stays off until a key and a model are configured.
3. **Tenant policy** (`TenantAiPolicy`): AI on/off, allowed tasks, requests per minute and per day,
   monthly budget, PII redaction. Server defaults apply until an administrator saves a policy.
4. **Circuit breaker** per provider and model (in-process). Provider SDK retries handle transient
   errors (`AI_MAX_RETRIES`).
5. **Ledger** (`AiUsage`): tokens, cost from the `AI_PRICING` table, latency, outcome and redaction
   count, plus an `AuditEvent` for every call, including refused ones.
6. **Structured output** (JSON schema) and full validation of results; AI output is always a
   proposal (change set, machine translation) that a person reviews before it takes effect.
7. **Redaction** of e-mail, phone, card and IBAN numbers in briefs and text documents before
   sending. Survey texts sent for translation are not redacted (they are the product).
8. **Prompt-injection defence**: documents and drafts are wrapped as data, the system prompt says
   not to follow instructions inside them, output is schema-checked, and nothing is applied without
   review.

## Consequences

- Rate limits and budgets are checked against the ledger in Postgres, so they hold across API
  instances; they are soft limits (two simultaneous requests can both pass the last slot).
- The circuit breaker is per instance; a shared breaker can move to Valkey when there are many.
- Adding OpenAI or Gemini: one `AiProvider` subclass, one registry case, prices in `AI_PRICING`.
