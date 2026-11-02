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
