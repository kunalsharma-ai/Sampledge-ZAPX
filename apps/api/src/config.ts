/** Runtime configuration, read once from the environment and validated. */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  API_PORT: z.coerce.number().default(4000),
  RUNTIME_BASE_URL: z.string().url().default('http://localhost:5173'),
  ALLOW_SIGNUP: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /** Enables the AI Survey Architect. Without it, AI endpoints answer 503 and everything else works. */
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** Max upload size for questionnaire files, in megabytes. */
  UPLOAD_MAX_MB: z.coerce.number().min(1).max(50).default(15),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;
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
