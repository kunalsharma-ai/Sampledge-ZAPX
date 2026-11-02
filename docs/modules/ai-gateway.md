# AI gateway

Decision: [ADR 0004](../adr/0004-ai-gateway.md) · Code: `apps/api/src/ai`

## Using it

```ts
const result = await gateway.run('translate', { tenantId, userId }, (model) => provider.translate(req, model), { surveyId });
```

`run` checks configuration, tenant permission, rate limits, budget and the circuit breaker, calls the
provider with the task's model, then records tokens, cost and outcome in `AiUsage` and an
`ai.<task>.<outcome>` audit event. Errors are `AiError` with a code the studio can explain:
`NOT_CONFIGURED`, `NOT_PERMITTED` (403), `RATE_LIMITED` / `BUDGET_EXCEEDED` (429), `CIRCUIT_OPEN` /
`UNAVAILABLE` (503), `REFUSED`, `BAD_OUTPUT`, `TOO_LONG` (422).

## Tasks

| Task        | Used by                              | Model setting                     | Input redaction                                      |
| ----------- | ------------------------------------ | --------------------------------- | ---------------------------------------------------- |
| `architect` | AI Survey Architect, document import | `AI_MODEL_ARCHITECT` → `AI_MODEL` | brief and text documents (PDFs are sent as they are) |
| `translate` | Language Studio                      | `AI_MODEL_TRANSLATE` → `AI_MODEL` | none (survey texts are the product)                  |

## Settings

Server: `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_MODEL_<TASK>`, `AI_PRICING`
(USD per million tokens per model), `AI_MAX_RETRIES`, `AI_TIMEOUT_MS`, `AI_BREAKER_FAILURES`,
`AI_BREAKER_OPEN_MS`, `AI_DEFAULT_RPM`, `AI_DEFAULT_RPD`.

Organization (Settings › AI, administrators): on/off, allowed tasks, requests per minute and per
day, monthly budget, redaction; this month's usage and cost.

## Adding a provider

1. Subclass `AiProvider` (set `name`), implement `architect` and `translate` with structured output
   and map errors to `AiError`.
2. Add the name to `AI_PROVIDER` in `config.ts` and a case in the factory in `app.module.ts`.
3. Add its models to `AI_PRICING`.
