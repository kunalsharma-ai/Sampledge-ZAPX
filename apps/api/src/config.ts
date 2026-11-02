/** Runtime configuration, read once from the environment and validated. */
import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const pricingSchema = z.record(
  z.string(),
  z.object({
    input: z.number().min(0),
    output: z.number().min(0),
    cacheRead: z.number().min(0).optional(),
    cacheWrite: z.number().min(0).optional(),
  }),
);
export type ModelPrice = z.infer<typeof pricingSchema>[string];

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    API_PORT: z.coerce.number().default(4000),
    RUNTIME_BASE_URL: z.string().url().default('http://localhost:5173'),
    /** Where interviewers open the offline CAPI app (shown in the studio). */
    CAPI_APP_URL: z.string().url().default('http://localhost:5174'),
    ALLOW_SIGNUP: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /** Enables the AI Survey Architect. Without it, AI endpoints answer 503 and everything else works. */
    ANTHROPIC_API_KEY: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined)),
    /**
     * Model per AI task. No model id is built into the code: AI_MODEL is the default for every
     * task and AI_MODEL_<TASK> overrides it. AI stays off until a provider key and a model are set.
     */
    AI_MODEL: optionalString,
    AI_MODEL_ARCHITECT: optionalString,
    AI_MODEL_TRANSLATE: optionalString,
    /** Provider per task (only "anthropic" is implemented; see docs/modules/ai-gateway.md). */
    AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
    /** Price list in USD per million tokens: {"<model>": {"input": n, "output": n, "cacheRead": n, "cacheWrite": n}}. */
    AI_PRICING: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return {} as Record<string, ModelPrice>;
        try {
          return pricingSchema.parse(JSON.parse(v));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'AI_PRICING must be JSON: {"model": {"input": 5, "output": 25}}' });
          return z.NEVER;
        }
      }),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(900_000).default(600_000),
    /** Circuit breaker: consecutive provider failures that open the circuit, and how long it stays open. */
    AI_BREAKER_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
    AI_BREAKER_OPEN_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    /** Defaults for tenants without their own AI policy. */
    AI_DEFAULT_RPM: z.coerce.number().int().min(0).max(10_000).default(10),
    AI_DEFAULT_RPD: z.coerce.number().int().min(0).max(1_000_000).default(500),
    /** Key for encrypting partner secrets at rest (32+ chars). Falls back to a key derived from JWT_SECRET. */
    SECRETS_KEY: optionalString.refine((v) => !v || v.length >= 32, 'SECRETS_KEY must be at least 32 characters'),
    NODE_ENV: z.string().default('development'),
    /** Callback outbox worker. "off" leaves delivery to another process (or to tests). */
    CALLBACK_WORKER: z.enum(['on', 'off']).default('on'),
    CALLBACK_POLL_MS: z.coerce.number().int().min(200).max(600_000).default(5_000),
    CALLBACK_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
    /** Allow callbacks to private and loopback addresses (development and tests only). */
    CALLBACK_ALLOW_PRIVATE_HOSTS: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /** An unfinished interview with no activity for this long is recorded as partial (abandoned). */
    ABANDON_AFTER_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 30)
      .default(24 * 60),
    /** Max upload size for questionnaire files, in megabytes. */
    UPLOAD_MAX_MB: z.coerce.number().min(1).max(50).default(15),
    COOKIE_SECURE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && !c.SECRETS_KEY)
      ctx.addIssue({ code: 'custom', path: ['SECRETS_KEY'], message: 'SECRETS_KEY is required in production' });
    if (c.NODE_ENV === 'production' && c.CALLBACK_ALLOW_PRIVATE_HOSTS) {
      ctx.addIssue({ code: 'custom', path: ['CALLBACK_ALLOW_PRIVATE_HOSTS'], message: 'must be false in production' });
    }
  });

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

/** Tests change the environment between suites; this forgets the cached copy. */
export function resetConfig() {
  cached = undefined;
}
export function config(): AppConfig {
  if (!cached) {
    const r = schema.safeParse(process.env);
    if (!r.success) {
      throw new Error(`Invalid configuration: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    cached = r.data;
  }
  return cached;
}
