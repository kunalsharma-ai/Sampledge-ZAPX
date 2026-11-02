/**
 * Canonical ZAPX survey definition (schema version 1).
 *
 * This is the single source of truth for a questionnaire. The studio, the API, the respondent
 * runtime, QA and (later) AI, translation and the offline CAPI app all read and write this format.
 * Presentation concerns (themes, translations, device layouts) are layered on top and keyed by
 * question ID; they never change logic or answer codes.
 */
import { z } from 'zod';

/** Variable names: start with a letter, then letters, digits or underscores (e.g. Q1, S2a, AGE). */
export const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Reserved words of the logic expression language; they cannot be used as variable names. */
export const RESERVED_WORDS = ['and', 'or', 'not', 'in', 'true', 'false', 'null'] as const;

const variableName = z
  .string()
  .regex(VARIABLE_NAME, 'Must start with a letter and contain only letters, digits or _ (max 64)')
  .refine((v) => !(RESERVED_WORDS as readonly string[]).includes(v.toLowerCase()), {
    message: 'Reserved word',
  });

/** An expression in the ZAPX logic language, e.g. `Q1 == 2 and AGE >= 18`. */
const expression = z.string().min(1).max(2000);

// ---- Media (Milestone 11) --------------------------------------------------------------------------
// Media are uploaded to ZAPX and referenced by id. External URLs are not allowed: they would leak
// respondents' network addresses to third parties and could change after the survey is approved.

export const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
/** Id of an uploaded media file (served at /api/public/media/:id). */
export const MEDIA_ID = /^[A-Za-z0-9_-]{10,64}$/;

export const mediaRefSchema = z.object({
  kind: z.enum(MEDIA_KINDS),
  id: z.string().regex(MEDIA_ID, 'Upload the file in the studio'),
  /** Text alternative: required for images, describes the content for screen readers. */
  alt: z.string().max(300).default(''),
  caption: z.string().max(500).optional(),
});
export type MediaRef = z.infer<typeof mediaRefSchema>;

/** Media shown with a question or information element (an ad, a pack shot, a concept, an audio clip). */
export const questionMediaSchema = mediaRefSchema.extend({
  /** Video and audio: the respondent must play it to the end before continuing (the Next button waits). */
  requireComplete: z.boolean().default(false),
});
export type QuestionMedia = z.infer<typeof questionMediaSchema>;

export const optionSchema = z.object({
  /** Answer code stored in the data. Stable across languages and themes. */
  code: z.number().int(),
  label: z.string().min(1),
  /** Keep this option in place when the list is randomized (e.g. "Other", "None"). */
  anchor: z.boolean().optional(),
  /** Multiple choice only: selecting this option clears and blocks all others (e.g. "None"). */
  exclusive: z.boolean().optional(),
  /** Image choice: a picture shown with (or instead of) the label. The label stays the alternative text. */
  image: z.string().regex(MEDIA_ID).optional(),
});
export type Option = z.infer<typeof optionSchema>;

const validationRule = z.object({
  /** Must evaluate to true for the answer to be accepted. */
  expr: expression,
  message: z.string().min(1),
});
export type ValidationRule = z.infer<typeof validationRule>;

const baseQuestion = {
  id: variableName,
  /** Question text. Supports piping with {{VAR}} (e.g. "You said {{Q1}}"). */
  text: z.string().min(1),
  /** Optional instruction shown under the question text. */
  help: z.string().optional(),
  /** Show the question only when this expression is true. */
  condition: expression.optional(),
  required: z.boolean().default(true),
  validations: z.array(validationRule).default([]),
  /** Image, video or audio shown above the answers. */
  media: questionMediaSchema.optional(),
};

export const singleQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('single'),
  options: z.array(optionSchema).min(1),
  randomize: z.boolean().default(false),
});

export const multiQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('multi'),
  options: z.array(optionSchema).min(1),
  randomize: z.boolean().default(false),
  minSelected: z.number().int().min(0).optional(),
  maxSelected: z.number().int().min(1).optional(),
});

export const openQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('open'),
  multiline: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(10000).default(2000),
});

export const numericQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('numeric'),
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.boolean().default(true),
  unit: z.string().optional(),
  /** slider: a slider between min and max (both required), moved in `step`s. */
  display: z.enum(['input', 'slider']).default('input'),
  step: z.number().positive().optional(),
  /** Slider end labels. */
  minLabel: z.string().max(200).optional(),
  maxLabel: z.string().max(200).optional(),
});

/** Rating scale or NPS: one whole number between min and max, shown as a row of buttons. */
export const scaleQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('scale'),
  min: z.number().int().min(-10).max(10).default(0),
  max: z.number().int().min(1).max(20).default(10),
  minLabel: z.string().max(200).optional(),
  maxLabel: z.string().max(200).optional(),
  /** Net Promoter Score: 0-10, analysis reports promoters (9-10), passives and detractors (0-6). */
  nps: z.boolean().default(false),
  /** An answer outside the scale, such as "Don't know", stored as its own code. */
  dontKnow: optionSchema.pick({ code: true, label: true }).optional(),
});

/** Ranking: put the options in order. Stored as the codes in rank order (first = rank 1). */
export const rankingQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('ranking'),
  options: z.array(optionSchema).min(2).max(30),
  randomize: z.boolean().default(false),
  /** Rank only the top N (default: all options). */
  rankCount: z.number().int().min(1).max(30).optional(),
});

/** Constant sum: share a total (100 points, 10 visits, a budget) across the options. Stored as code -> amount. */
export const sumQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('sum'),
  options: z.array(optionSchema).min(2).max(30),
  randomize: z.boolean().default(false),
  total: z.number().positive().max(1_000_000).default(100),
  integer: z.boolean().default(true),
  unit: z.string().max(20).optional(),
});

export const gridRowSchema = z.object({
  /** Row variable suffix; the stored variable is `<questionId>_<rowId>` (e.g. Q5_r1). */
  id: z.string().regex(/^[A-Za-z0-9_]{1,32}$/),
  label: z.string().min(1),
});
export type GridRow = z.infer<typeof gridRowSchema>;

export const gridQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('grid'),
  rows: z.array(gridRowSchema).min(1),
  /** Scale columns shared by every row (single choice per row). */
  columns: z.array(optionSchema).min(1),
  randomizeRows: z.boolean().default(false),
});

/**
 * Photo (Milestone 12): the respondent or interviewer takes or chooses a picture (a receipt, a shelf,
 * a product at home). The answer is a capture reference; the file itself is private to the
 * organization and never shown to other respondents.
 */
export const photoQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('photo'),
});

/** Reference to a captured photo or recording, unique within one interview. */
export const CAPTURE_REF = /^[A-Za-z0-9_-]{8,64}$/;

export const infoElementSchema = z.object({
  id: variableName,
  type: z.literal('info'),
  text: z.string().min(1),
  condition: expression.optional(),
  media: questionMediaSchema.optional(),
});

export const questionSchema = z.discriminatedUnion('type', [
  singleQuestionSchema,
  multiQuestionSchema,
  openQuestionSchema,
  numericQuestionSchema,
  gridQuestionSchema,
  scaleQuestionSchema,
  rankingQuestionSchema,
  sumQuestionSchema,
  photoQuestionSchema,
  infoElementSchema,
]);
export type Question = z.infer<typeof questionSchema>;
export type QuestionInput = z.input<typeof questionSchema>;
export type QuestionType = Question['type'];
export type SingleQuestion = z.infer<typeof singleQuestionSchema>;
export type MultiQuestion = z.infer<typeof multiQuestionSchema>;
export type OpenQuestion = z.infer<typeof openQuestionSchema>;
export type NumericQuestion = z.infer<typeof numericQuestionSchema>;
export type GridQuestion = z.infer<typeof gridQuestionSchema>;
export type InfoElement = z.infer<typeof infoElementSchema>;
export type ScaleQuestion = z.infer<typeof scaleQuestionSchema>;
export type RankingQuestion = z.infer<typeof rankingQuestionSchema>;
export type SumQuestion = z.infer<typeof sumQuestionSchema>;
export type PhotoQuestion = z.infer<typeof photoQuestionSchema>;

/** Codes a scale question can store: every point of the scale, plus "don't know" when offered. */
export function scaleCodes(q: Pick<ScaleQuestion, 'min' | 'max' | 'dontKnow'>): number[] {
  const out: number[] = [];
  for (let i = q.min; i <= q.max; i++) out.push(i);
  if (q.dontKnow) out.push(q.dontKnow.code);
  return out;
}

/** Media ids used anywhere in a definition (question media and option images). */
export function mediaIdsOf(def: { pages: Array<{ questions: Question[] }> }): string[] {
  const ids = new Set<string>();
  for (const p of def.pages)
    for (const q of p.questions) {
      if (q.media) ids.add(q.media.id);
      if ('options' in q) for (const o of q.options) if (o.image) ids.add(o.image);
    }
  return [...ids];
}

export const pageSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string().optional(),
  /** Show the page only when this expression is true. */
  condition: expression.optional(),
  questions: z.array(questionSchema).min(1),
});
export type Page = z.infer<typeof pageSchema>;

/** Final statuses a respondent can reach. Each maps to a vendor redirect. */
/** The same eight statuses as PROJEXA. `partial` = abandoned; `technical_error` = ZAPX could not continue. */
export const OUTCOME_STATUSES = [
  'complete',
  'terminate',
  'quota_full',
  'quality_fail',
  'security_reject',
  'duplicate',
  'partial',
  'technical_error',
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const terminationSchema = z.object({
  id: variableName,
  /** Evaluated after every page; when true the respondent ends with `status`. */
  condition: expression,
  status: z.enum(['terminate', 'quality_fail']).default('terminate'),
  label: z.string().optional(),
});
export type Termination = z.infer<typeof terminationSchema>;

export const quotaSchema = z.object({
  id: variableName,
  label: z.string().optional(),
  /** Respondents matching this expression count toward the quota. */
  condition: expression,
  /** Number of completes allowed. */
  target: z.number().int().min(0),
});
export type Quota = z.infer<typeof quotaSchema>;

// ---- Data quality (Milestone 5) -----------------------------------------------------------------
// Quality settings are part of the versioned definition: an in-survey quality reject changes where a
// respondent is redirected, so it is published, diffed and reviewed like any other logic.

export const qualityCheckSchema = z.object({
  id: variableName,
  /** When true for a completed interview, the check fails (e.g. `ATTN != 3`). Uses the logic language. */
  condition: expression,
  label: z.string().max(200).optional(),
  /** Points taken off the quality score when the check fails. */
  weight: z.number().int().min(1).max(100).default(20),
});
export type QualityCheck = z.infer<typeof qualityCheckSchema>;

export const qualitySettingsSchema = z.object({
  /** Score every complete and record the reasons. Off: no score, no review queue, no in-survey rejects. */
  enabled: z.boolean().default(true),
  /** Hard floor: an interview faster than this many seconds is a speeder. */
  minSeconds: z.number().int().min(0).max(36000).optional(),
  /** Relative speeder: faster than this share of the median length of interview (needs 20 completes). */
  speederRatio: z.number().min(0).max(1).default(0.4),
  /** Grids with at least this many rows are checked for straightlining (same column in every row). */
  straightlineMinRows: z.number().int().min(2).max(100).default(5),
  /** Open answers are checked for gibberish, very short answers and copies of other respondents' answers. */
  openEnds: z.boolean().default(true),
  /** Flag several completes from the same network (a keyed hash of the IP address, never the address). */
  sameNetwork: z.boolean().default(true),
  /**
   * Fraud signals (Milestone 12): automated browsers, the hidden honeypot field, pages answered with
   * no keyboard, pointer or touch input, pasted open answers, the same device as another complete,
   * and devices or networks the organization blocked.
   */
  fraud: z.boolean().default(true),
  /**
   * Countries respondents are expected to answer from (ISO 3166 two-letter codes). Checked against
   * the country the edge network reports (GEO_COUNTRY_HEADER); empty uses the vendor's cc parameter.
   */
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/, 'Use two-letter country codes such as GB'))
    .max(250)
    .default([]),
  /** Survey-specific checks, such as attention or consistency checks. */
  checks: z.array(qualityCheckSchema).max(50).default([]),
  /** Completes scoring below this go to the review queue. */
  reviewBelow: z.number().int().min(0).max(100).default(70),
  /**
   * Completes scoring below this end as quality_fail inside the survey (redirected as quality fail,
   * not counted toward quotas). 0 = never reject automatically; people decide in the review queue.
   */
  rejectBelow: z.number().int().min(0).max(100).default(0),
});
export type QualitySettings = z.infer<typeof qualitySettingsSchema>;

/**
 * Quality settings of a definition, with defaults. Versions published before Milestone 5 have no
 * `settings.quality`, so always read it through this function.
 */
export function qualitySettingsOf(def: { settings?: { quality?: unknown } }): QualitySettings {
  const parsed = qualitySettingsSchema.safeParse(def.settings?.quality ?? {});
  return parsed.success ? parsed.data : qualitySettingsSchema.parse({});
}

// ---- Face-to-face capture (Milestone 12) -----------------------------------------------------------

export const capiSettingsSchema = z.object({
  /** Record where CAPI interviews happen (start and end). required: an interview cannot start without a location. */
  gps: z.enum(['off', 'optional', 'required']).default('off'),
  /** consent: the interviewer asks the respondent before recording the interview's audio. Never recorded silently. */
  audio: z.enum(['off', 'consent']).default('off'),
  /** What the interviewer reads out to ask for consent to record. */
  consentText: z.string().max(1000).optional(),
});
export type CapiSettings = z.infer<typeof capiSettingsSchema>;

export const DEFAULT_RECORDING_CONSENT =
  'May I record the sound of this interview? It is only used to check the quality of my work, is kept securely and is not shared.';

export function capiSettingsOf(def: { settings?: { capi?: unknown } }): CapiSettings {
  const parsed = capiSettingsSchema.safeParse(def.settings?.capi ?? {});
  return parsed.success ? parsed.data : capiSettingsSchema.parse({});
}

export const surveyDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  /** BCP 47 language tag of the source text. */
  language: z.string().default('en'),
  welcome: z.string().optional(),
  thankYou: z.string().optional(),
  pages: z.array(pageSchema).min(1),
  terminations: z.array(terminationSchema).default([]),
  quotas: z.array(quotaSchema).default([]),
  settings: z
    .object({
      allowBack: z.boolean().default(false),
      showProgress: z.boolean().default(true),
      quality: qualitySettingsSchema.prefault({}),
      capi: capiSettingsSchema.prefault({}),
    })
    .prefault({}),
});
export type SurveyDefinition = z.infer<typeof surveyDefinitionSchema>;
export type SurveyDefinitionInput = z.input<typeof surveyDefinitionSchema>;

export interface SchemaIssue {
  path: string;
  message: string;
}

/** Validate and normalize (apply defaults to) an untrusted survey definition. */
export function parseSurveyDefinition(input: unknown): { ok: true; definition: SurveyDefinition } | { ok: false; issues: SchemaIssue[] } {
  const result = surveyDefinitionSchema.safeParse(input);
  if (result.success) return { ok: true, definition: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

/** Answer value shapes stored per question type. */
export type AnswerValue =
  | number // single, numeric
  | number[] // multi; ranking (codes in rank order)
  | string // open; photo (capture reference)
  | Record<string, number> // grid: rowId -> column code; sum: option code -> amount
  | null;

export type Answers = Record<string, AnswerValue>;

/** Iterate every question in page order. */
export function allQuestions(def: SurveyDefinition): Question[] {
  return def.pages.flatMap((p) => p.questions);
}

/** A minimal valid survey, used for new drafts. */
export function emptySurvey(title: string): SurveyDefinition {
  return surveyDefinitionSchema.parse({
    schemaVersion: 1,
    title,
    pages: [
      {
        id: 'P1',
        questions: [
          {
            id: 'Q1',
            type: 'single',
            text: 'Which of these best describes you?',
            options: [
              { code: 1, label: 'Option A' },
              { code: 2, label: 'Option B' },
            ],
          },
        ],
      },
    ],
  });
}

// ---- Presentation layer (Milestone 3) ---------------------------------------------------------
// Themes, translations and device settings are layered on top of the definition. They are keyed by
// question id and text key and can never change ids, answer codes or routing.

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2f5bea');

/** Logos are embedded as small data URLs (PNG, JPEG or WebP only; SVG can carry script). */
export const LOGO_MAX_BYTES = 200_000;
const logoDataUrl = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, 'Logo must be a PNG, JPEG or WebP image')
  .refine((v) => Math.floor(((v.length - v.indexOf(',') - 1) * 3) / 4) <= LOGO_MAX_BYTES, 'Logo must be 200 KB or smaller');

export const THEME_FONTS = ['system', 'humanist', 'rounded', 'serif'] as const;
export const THEME_MOTION = ['none', 'subtle', 'lively'] as const;

export const themeSchema = z.object({
  preset: z.string().max(40).default('zapx'),
  /** Buttons, selected answers, progress. */
  accent: hexColor.default('#2f5bea'),
  background: hexColor.default('#f6f7fb'),
  surface: hexColor.default('#ffffff'),
  text: hexColor.default('#1b1f2a'),
  /** auto: respondents in dark mode get the built-in dark palette; light: always this palette. */
  colorScheme: z.enum(['auto', 'light']).default('auto'),
  font: z.enum(THEME_FONTS).default('system'),
  /** Corner radius of cards, answers and buttons, in pixels. */
  radius: z.number().int().min(0).max(28).default(12),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  /** Page and answer animations. Always off for respondents who ask for reduced motion. */
  motion: z.enum(THEME_MOTION).default('subtle'),
  progress: z.enum(['bar', 'percent', 'none']).default('bar'),
  logo: logoDataUrl.optional(),
  logoAlt: z.string().max(120).optional(),
  nextLabel: z.string().max(40).optional(),
  backLabel: z.string().max(40).optional(),
});
export type Theme = z.infer<typeof themeSchema>;

export const DEVICE_TYPES = ['desktop', 'tablet', 'mobile'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const deviceSettingsSchema = z.object({
  /** Devices allowed to take the survey. Others are screened out before a response is created. */
  allowed: z.array(z.enum(DEVICE_TYPES)).min(1).default(['desktop', 'tablet', 'mobile']),
  /** How grids appear on narrow screens: one card per row, or the full table with sideways scrolling. */
  gridOnMobile: z.enum(['cards', 'scroll']).default('cards'),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

/** A translated text. `source` is the source text it was translated from, to detect outdated entries. */
export const translationEntrySchema = z.object({
  text: z.string().max(10000),
  source: z.string().max(10000),
  /** machine: written by AI and not yet approved by a person. */
  status: z.enum(['machine', 'reviewed']),
});
export type TranslationEntry = z.infer<typeof translationEntrySchema>;

export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

export const languageSchema = z.object({
  tag: z.string().regex(LANGUAGE_TAG, 'Use a language tag such as fr, es-MX or zh-Hans'),
  name: z.string().min(1).max(60),
  /** Offered to respondents only when enabled (publishing then requires it to be complete and reviewed). */
  enabled: z.boolean().default(false),
  texts: z.record(z.string().max(200), translationEntrySchema).prefault({}),
});
export type Language = z.infer<typeof languageSchema>;

export const presentationSchema = z.object({
  theme: themeSchema.prefault({}),
  devices: deviceSettingsSchema.prefault({}),
  /** Name of the source language, shown in the respondent language menu. */
  sourceLanguageName: z.string().max(60).optional(),
  languages: z.array(languageSchema).max(60).default([]),
  /** Offer a "Read aloud" button that speaks the question with the device's own voices (no upload). */
  readAloud: z.boolean().default(false),
});
export type Presentation = z.infer<typeof presentationSchema>;
export type PresentationInput = z.input<typeof presentationSchema>;

export function parsePresentation(input: unknown): { ok: true; presentation: Presentation } | { ok: false; issues: SchemaIssue[] } {
  const result = presentationSchema.safeParse(input ?? {});
  if (result.success) return { ok: true, presentation: result.data };
  return { ok: false, issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

export function defaultPresentation(): Presentation {
  return presentationSchema.parse({});
}
