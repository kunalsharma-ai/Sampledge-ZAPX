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

/** Parts of the example secrets in .env.example and the test setup; never acceptable in production. */
const KNOWN_DEV_SECRETS = ['dev-only-secret', 'change-me', 'changeme', 'test-secret'];

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
    /** Sign-ups allowed per minute from one address (raise only for automated test runs). */
    SIGNUP_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(5),
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
    AI_MODEL_INSIGHTS: optionalString,
    /** Provider per task (only "anthropic" is implemented; see docs/modules/ai-gateway.md). */
    AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
    /** Only for tests: an Anthropic-compatible stand-in. */
    ANTHROPIC_API_BASE: z.string().url().default('https://api.anthropic.com'),
    /** How often each process re-reads the integrations saved in the CRM (Settings > Integrations). */
    INTEGRATIONS_REFRESH_MS: z.coerce.number().int().min(1_000).max(600_000).default(15_000),
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
    /** Max size of one survey media upload (video, audio, images), in megabytes. Images are capped at 10, audio at 25. */
    MEDIA_MAX_MB: z.coerce.number().min(1).max(500).default(100),
    /**
     * Milestone 12: request header carrying the respondent's country as set by your edge network (for
     * example cloudfront-viewer-country or cf-ipcountry). Empty: no country check. Only set this when
     * the API is reachable through that edge alone, or respondents could send the header themselves.
     */
    GEO_COUNTRY_HEADER: z
      .string()
      .regex(/^[a-z0-9-]*$/i)
      .default('')
      .transform((v) => v.toLowerCase()),
    /**
     * Milestone 16: network reputation (VPN, proxy, Tor, data centre) for online interviews. "ipinfo"
     * sends each respondent's address to IPinfo's privacy detection API (a paid IPinfo plan) when an
     * interview starts and keeps only the answer's words; "off" sends nothing anywhere.
     */
    NETWORK_REPUTATION: z.enum(['off', 'ipinfo']).default('off'),
    IPINFO_TOKEN: z.string().default(''),
    IPINFO_API_BASE: z.string().url().default('https://ipinfo.io'),
    NETWORK_REPUTATION_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
    /**
     * Milestone 17: transcription of interview recordings. "deepgram" sends a recording to Deepgram when
     * a reviewer asks for its transcript; "off" sends nothing. DEEPGRAM_MODEL names the Deepgram model
     * to use (see Deepgram's model list); there is deliberately no default.
     */
    TRANSCRIPTION: z.enum(['off', 'deepgram']).default('off'),
    DEEPGRAM_API_KEY: z.string().default(''),
    DEEPGRAM_MODEL: z.string().max(100).default(''),
    DEEPGRAM_API_BASE: z.string().url().default('https://api.deepgram.com'),
    TRANSCRIPTION_TIMEOUT_S: z.coerce.number().int().min(10).max(3600).default(600),
    /**
     * Milestone 19: phone dialer for CATI. "twilio" places calls through Twilio's Programmable Voice
     * API: the interviewer's phone rings first, then the respondent is dialled from TWILIO_CALLER_ID,
     * so interviewers never see respondents' numbers. "off" leaves dialling to the interviewer.
     * TELEPHONY_WEBHOOK_BASE is the public address of the API (ending in /api) that Twilio calls back.
     */
    TELEPHONY: z.enum(['off', 'twilio']).default('off'),
    TWILIO_ACCOUNT_SID: z.string().default(''),
    TWILIO_AUTH_TOKEN: z.string().default(''),
    /** A Twilio number (or verified caller id) in E.164 form, e.g. +442071234567. */
    TWILIO_CALLER_ID: z.string().default(''),
    TWILIO_API_BASE: z.string().url().default('https://api.twilio.com'),
    TELEPHONY_WEBHOOK_BASE: z.string().default(''),
    /** Seconds to let each phone ring before giving up. */
    TELEPHONY_RING_SECONDS: z.coerce.number().int().min(5).max(120).default(30),
    /**
     * Blueprint phase 3: email invitations and reminders. "sendgrid" sends through SendGrid's v3 Mail
     * Send API from EMAIL_FROM; "off" sends nothing (personal links can still be downloaded and sent
     * with another tool).
     */
    EMAIL_PROVIDER: z.enum(['off', 'sendgrid']).default('off'),
    SENDGRID_API_KEY: z.string().default(''),
    SENDGRID_API_BASE: z.string().url().default('https://api.sendgrid.com'),
    EMAIL_FROM: z.string().default(''),
    EMAIL_FROM_NAME: z.string().max(100).default('ZAPX surveys'),
    /**
     * Blueprint phase 5: SMS invitations. "twilio" sends through Twilio's Messages API with the
     * TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN above, from SMS_FROM (an E.164 number, or a Messaging
     * Service SID starting MG). "off" sends nothing.
     */
    SMS_PROVIDER: z.enum(['off', 'twilio']).default('off'),
    SMS_FROM: z.string().default(''),
    /**
     * Blueprint phase 5, data residency: the region this deployment keeps data in (e.g. "eu", "us",
     * "in"). An organization that sets its own region sees a warning when the two differ. Empty: not declared.
     */
    DATA_REGION: z.string().max(20).default(''),
    /** Largest interview recording (CAPI audio), in megabytes. Photos are capped at 15. */
    CAPTURE_MAX_MB: z.coerce.number().min(1).max(500).default(100),
    /** Delete photos and recordings this many days after they were uploaded. 0 keeps them until erased. */
    CAPTURE_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
    /** Exports with more rows than this are refused by the download endpoint and run as background jobs. */
    EXPORT_SYNC_MAX_ROWS: z.coerce.number().int().min(1).default(10_000),
    /** Background jobs (Milestone 7): run the job worker in this process. Turn off in the API when a separate worker runs. */
    JOB_WORKER: z.enum(['on', 'off']).default('on'),
    JOB_POLL_MS: z.coerce.number().int().min(100).max(600_000).default(2_000),
    /** Where the local file store keeps files (exports, uploads for AI jobs). */
    FILES_DIR: z.string().default('.data/files'),
    /** Where file bytes live (Milestone 13): the local FILES_DIR, or a private S3 bucket. */
    FILE_STORE: z.enum(['local', 's3']).default('local'),
    S3_BUCKET: optionalString,
    S3_REGION: z.string().default('eu-west-1'),
    /** Key prefix inside the bucket, e.g. "zapx/production". */
    S3_PREFIX: optionalString,
    /** KMS key id or ARN for SSE-KMS. Without it objects use SSE-S3 (AES-256). */
    S3_KMS_KEY_ID: optionalString,
    /** S3-compatible endpoint for testing (MinIO, LocalStack). Leave unset on AWS. */
    S3_ENDPOINT: optionalString,
    /** Export files are deleted after this many hours. */
    EXPORT_FILE_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(72),
    /** Retention: finished jobs, and delivered or failed webhook deliveries, are deleted after this many days. */
    JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    /** Plan for organizations created by sign-up (Milestone 8): free, team, business or enterprise. */
    DEFAULT_PLAN: z.enum(['free', 'team', 'business', 'enterprise']).default('enterprise'),
    /** Billing (Milestone 13): off, or stripe (Checkout, customer portal and webhooks). */
    BILLING: z.enum(['off', 'stripe']).default('off'),
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    /** Plan code to Stripe price ID, as JSON: {"team": "price_...", "business": "price_..."}. */
    STRIPE_PRICES: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return {} as Partial<Record<'free' | 'team' | 'business' | 'enterprise', string>>;
        try {
          return z
            .partialRecord(z.enum(['free', 'team', 'business', 'enterprise']), z.string().regex(/^price_[A-Za-z0-9]+$/))
            .parse(JSON.parse(v)) as Partial<Record<'free' | 'team' | 'business' | 'enterprise', string>>;
        } catch {
          ctx.addIssue({ code: 'custom', message: 'STRIPE_PRICES must be JSON: {"team": "price_..."}' });
          return z.NEVER;
        }
      }),
    /** Pin the Stripe API version (e.g. 2026-09-30.clover); unset uses the account's default. */
    STRIPE_API_VERSION: optionalString,
    /** Only for tests: a Stripe-compatible fake. */
    STRIPE_API_BASE: z.string().url().default('https://api.stripe.com'),
    /** Plan an organization falls back to when its subscription ends. */
    BILLING_FALLBACK_PLAN: z.enum(['free', 'team', 'business', 'enterprise']).default('free'),
    /** Public address of the studio; SSO callbacks are ${STUDIO_URL}/api/auth/sso/callback. */
    STUDIO_URL: z.string().url().default('http://localhost:3000'),
    /** Development and tests only: allow http and private-network identity providers. */
    SSO_ALLOW_INSECURE_ISSUER: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /** Load balancers and proxies in front of the API that add X-Forwarded-For (1 behind one ALB). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    /**
     * Shared secret the CDN sends as X-Zapx-Edge (Milestone 13). When set, the viewer's address
     * (EDGE_CLIENT_ADDRESS_HEADER) and country (GEO_COUNTRY_HEADER) are believed only on requests
     * that carry it, and those headers are removed from every other request.
     */
    EDGE_SHARED_SECRET: z
      .string()
      .min(32)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    EDGE_CLIENT_ADDRESS_HEADER: z
      .string()
      .regex(/^[a-z0-9-]*$/i)
      .default('')
      .transform((v) => v.toLowerCase()),
    COOKIE_SECURE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /** Sign-in attempts allowed per minute from one address (raise only for automated test runs). */
    LOGIN_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
    /** Milestone 20: wrong passwords in a row before an account is locked, and for how long. */
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(100).default(10),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /** Hours a password reset link works (administrator link or "forgot password" email). */
    PASSWORD_RESET_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  })
  .superRefine((c, ctx) => {
    if (c.EMAIL_PROVIDER === 'sendgrid' && (!c.SENDGRID_API_KEY || !/^[^@\s]+@[^@\s]+$/.test(c.EMAIL_FROM)))
      ctx.addIssue({
        code: 'custom',
        path: ['SENDGRID_API_KEY'],
        message: 'EMAIL_PROVIDER=sendgrid needs SENDGRID_API_KEY and an EMAIL_FROM address',
      });
    if (c.TRANSCRIPTION === 'deepgram' && (!c.DEEPGRAM_API_KEY || !c.DEEPGRAM_MODEL))
      ctx.addIssue({
        code: 'custom',
        path: ['DEEPGRAM_API_KEY'],
        message: 'TRANSCRIPTION=deepgram needs DEEPGRAM_API_KEY and DEEPGRAM_MODEL',
      });
    if (c.TELEPHONY === 'twilio') {
      for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_CALLER_ID', 'TELEPHONY_WEBHOOK_BASE'] as const)
        if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `TELEPHONY=twilio needs ${k}` });
      if (c.TWILIO_CALLER_ID && !/^\+[1-9][0-9]{6,14}$/.test(c.TWILIO_CALLER_ID))
        ctx.addIssue({ code: 'custom', path: ['TWILIO_CALLER_ID'], message: 'TWILIO_CALLER_ID must be E.164, e.g. +442071234567' });
      if (c.TELEPHONY_WEBHOOK_BASE && !/^https?:\/\/[^/]+(\/.*)?$/.test(c.TELEPHONY_WEBHOOK_BASE))
        ctx.addIssue({ code: 'custom', path: ['TELEPHONY_WEBHOOK_BASE'], message: 'TELEPHONY_WEBHOOK_BASE must be a URL' });
    }
    if (c.SMS_PROVIDER === 'twilio') {
      for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM'] as const)
        if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `SMS_PROVIDER=twilio needs ${k}` });
      if (c.SMS_FROM && !/^(\+[1-9][0-9]{6,14}|MG[0-9a-fA-F]{32})$/.test(c.SMS_FROM))
        ctx.addIssue({
          code: 'custom',
          path: ['SMS_FROM'],
          message: 'SMS_FROM must be an E.164 number or a Messaging Service SID (MG...)',
        });
    }
    if (c.NETWORK_REPUTATION === 'ipinfo' && !c.IPINFO_TOKEN)
      ctx.addIssue({ code: 'custom', path: ['IPINFO_TOKEN'], message: 'IPINFO_TOKEN is required when NETWORK_REPUTATION=ipinfo' });
    // Milestone 20: refuse to start in production with settings that are only safe on a laptop.
    if (c.NODE_ENV === 'production') {
      if (!c.COOKIE_SECURE)
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production (sessions only over https)' });
      if (KNOWN_DEV_SECRETS.some((d) => c.JWT_SECRET.includes(d)))
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'is the example value; generate one with openssl rand -hex 32' });
      if (c.SECRETS_KEY && (c.SECRETS_KEY === c.JWT_SECRET || KNOWN_DEV_SECRETS.some((d) => c.SECRETS_KEY!.includes(d))))
        ctx.addIssue({ code: 'custom', path: ['SECRETS_KEY'], message: 'must be its own random value, not JWT_SECRET or the example' });
    }
    if (c.NODE_ENV === 'production' && !c.SECRETS_KEY)
      ctx.addIssue({ code: 'custom', path: ['SECRETS_KEY'], message: 'SECRETS_KEY is required in production' });
    if (c.NODE_ENV === 'production' && c.CALLBACK_ALLOW_PRIVATE_HOSTS) {
      ctx.addIssue({ code: 'custom', path: ['CALLBACK_ALLOW_PRIVATE_HOSTS'], message: 'must be false in production' });
    }
    if (c.BILLING === 'stripe') {
      for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const)
        if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `BILLING=stripe needs ${k}` });
      if (!Object.keys(c.STRIPE_PRICES).length)
        ctx.addIssue({ code: 'custom', path: ['STRIPE_PRICES'], message: 'BILLING=stripe needs STRIPE_PRICES' });
    }
    if (c.FILE_STORE === 's3' && !c.S3_BUCKET)
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'FILE_STORE=s3 needs S3_BUCKET' });
    if (c.NODE_ENV === 'production' && c.SSO_ALLOW_INSECURE_ISSUER) {
      ctx.addIssue({ code: 'custom', path: ['SSO_ALLOW_INSECURE_ISSUER'], message: 'must be false in production' });
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
