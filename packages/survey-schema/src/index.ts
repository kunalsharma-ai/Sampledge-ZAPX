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

export const optionSchema = z.object({
  /** Answer code stored in the data. Stable across languages and themes. */
  code: z.number().int(),
  label: z.string().min(1),
  /** Keep this option in place when the list is randomized (e.g. "Other", "None"). */
  anchor: z.boolean().optional(),
  /** Multiple choice only: selecting this option clears and blocks all others (e.g. "None"). */
  exclusive: z.boolean().optional(),
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

export const infoElementSchema = z.object({
  id: variableName,
  type: z.literal('info'),
  text: z.string().min(1),
  condition: expression.optional(),
});

export const questionSchema = z.discriminatedUnion('type', [
  singleQuestionSchema,
  multiQuestionSchema,
  openQuestionSchema,
  numericQuestionSchema,
  gridQuestionSchema,
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

export const pageSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string().optional(),
  /** Show the page only when this expression is true. */
  condition: expression.optional(),
  questions: z.array(questionSchema).min(1),
});
export type Page = z.infer<typeof pageSchema>;

/** Final statuses a respondent can reach. Each maps to a vendor redirect. */
export const OUTCOME_STATUSES = [
  'complete',
  'terminate',
  'quota_full',
  'quality_fail',
  'security_reject',
  'duplicate',
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
    })
    .default({}),
});
export type SurveyDefinition = z.infer<typeof surveyDefinitionSchema>;
export type SurveyDefinitionInput = z.input<typeof surveyDefinitionSchema>;

export interface SchemaIssue {
  path: string;
  message: string;
}

/** Validate and normalize (apply defaults to) an untrusted survey definition. */
export function parseSurveyDefinition(
  input: unknown,
): { ok: true; definition: SurveyDefinition } | { ok: false; issues: SchemaIssue[] } {
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
  | number[] // multi
  | string // open
  | Record<string, number> // grid: rowId -> column code
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
  texts: z.record(z.string().max(200), translationEntrySchema).default({}),
});
export type Language = z.infer<typeof languageSchema>;

export const presentationSchema = z.object({
  theme: themeSchema.default({}),
  devices: deviceSettingsSchema.default({}),
  /** Name of the source language, shown in the respondent language menu. */
  sourceLanguageName: z.string().max(60).optional(),
  languages: z.array(languageSchema).max(60).default([]),
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
