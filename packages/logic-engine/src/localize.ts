/**
 * Translation layer. A translation never edits the definition: it is a map from stable text keys
 * (e.g. `q.Q1.opt.2`) to translated text, applied on top of the source definition at run time.
 * Ids, answer codes and conditions are untouched, so data from every language lines up.
 */
import type { Language, Presentation, SurveyDefinition } from '@zapx/survey-schema';
import { SYSTEM_MESSAGES, type SystemMessages } from './interview.js';
import { PIPE_PATTERN } from './interview.js';

export interface TextKey {
  key: string;
  /** Source-language text. */
  source: string;
  /** Where it appears, for translators. */
  context: string;
}

/** Every translatable text of a survey, in questionnaire order, followed by system messages. */
export function textKeys(def: SurveyDefinition, presentation?: Pick<Presentation, 'theme'>): TextKey[] {
  const keys: TextKey[] = [];
  const add = (key: string, source: string | undefined, context: string) => {
    if (source && source.trim()) keys.push({ key, source, context });
  };
  add('survey.title', def.title, 'Survey title');
  add('survey.welcome', def.welcome, 'Welcome text');
  add('survey.thankYou', def.thankYou, 'Thank-you text');
  for (const p of def.pages) {
    add(`page.${p.id}.title`, p.title, `Page ${p.id} title`);
    for (const q of p.questions) {
      add(`q.${q.id}.text`, q.text, `${q.id} question text`);
      if (q.media) {
        add(`q.${q.id}.media.alt`, q.media.alt, `${q.id} ${q.media.kind} description`);
        add(`q.${q.id}.media.caption`, q.media.caption, `${q.id} ${q.media.kind} caption`);
      }
      if (q.type === 'info') continue;
      add(`q.${q.id}.help`, q.help, `${q.id} help text`);
      q.validations.forEach((v, i) => add(`q.${q.id}.val.${i}`, v.message, `${q.id} validation message`));
      if (q.type === 'single' || q.type === 'multi' || q.type === 'ranking' || q.type === 'sum')
        q.options.forEach((o) => add(`q.${q.id}.opt.${o.code}`, o.label, `${q.id} answer ${o.code}`));
      if (q.type === 'scale' || q.type === 'numeric') {
        add(`q.${q.id}.minLabel`, q.minLabel, `${q.id} low end label`);
        add(`q.${q.id}.maxLabel`, q.maxLabel, `${q.id} high end label`);
      }
      if (q.type === 'scale' && q.dontKnow) add(`q.${q.id}.dontKnow`, q.dontKnow.label, `${q.id} answer ${q.dontKnow.code}`);
      if (q.type === 'sum') add(`q.${q.id}.unit`, q.unit, `${q.id} unit`);
      if (q.type === 'grid') {
        q.rows.forEach((r) => add(`q.${q.id}.row.${r.id}`, r.label, `${q.id} row ${r.id}`));
        q.columns.forEach((c) => add(`q.${q.id}.col.${c.code}`, c.label, `${q.id} column ${c.code}`));
      }
      if (q.type === 'numeric') add(`q.${q.id}.unit`, q.unit, `${q.id} unit`);
    }
  }
  const ui = systemMessagesFor(presentation);
  for (const [k, v] of Object.entries(ui)) add(`ui.${k}`, v, 'Respondent screen text');
  return keys;
}

/** Source-language system messages, with button labels from the theme. */
export function systemMessagesFor(presentation?: Pick<Presentation, 'theme'>): SystemMessages {
  return {
    ...SYSTEM_MESSAGES,
    ...(presentation?.theme.nextLabel ? { next: presentation.theme.nextLabel } : {}),
    ...(presentation?.theme.backLabel ? { back: presentation.theme.backLabel } : {}),
  };
}

/** Translated text for a key, falling back to the source when missing or outdated. */
function pick(lang: Language | undefined, key: string, source: string): string {
  const e = lang?.texts[key];
  return e && e.source === source && e.text.trim() ? e.text : source;
}

/** The definition with every text replaced by its translation. Logic is identical to the source. */
export function localizeDefinition(def: SurveyDefinition, lang: Language | undefined): SurveyDefinition {
  if (!lang) return def;
  const t = (key: string, source: string) => pick(lang, key, source);
  const tOpt = (key: string, source: string | undefined) => (source === undefined ? undefined : t(key, source));
  return {
    ...def,
    language: lang.tag,
    title: t('survey.title', def.title),
    welcome: tOpt('survey.welcome', def.welcome),
    thankYou: tOpt('survey.thankYou', def.thankYou),
    pages: def.pages.map((p) => ({
      ...p,
      title: tOpt(`page.${p.id}.title`, p.title),
      questions: p.questions.map((q) => {
        const text = t(`q.${q.id}.text`, q.text);
        const media = q.media
          ? { ...q.media, alt: t(`q.${q.id}.media.alt`, q.media.alt), caption: tOpt(`q.${q.id}.media.caption`, q.media.caption) }
          : undefined;
        if (q.type === 'info') return { ...q, text, media };
        const base = {
          ...q,
          text,
          media,
          help: tOpt(`q.${q.id}.help`, q.help),
          validations: q.validations.map((v, i) => ({ ...v, message: t(`q.${q.id}.val.${i}`, v.message) })),
        };
        if (base.type === 'single' || base.type === 'multi' || base.type === 'ranking' || base.type === 'sum') {
          const opts = { ...base, options: base.options.map((o) => ({ ...o, label: t(`q.${q.id}.opt.${o.code}`, o.label) })) };
          return opts.type === 'sum' ? { ...opts, unit: tOpt(`q.${q.id}.unit`, opts.unit) } : opts;
        }
        if (base.type === 'scale') {
          return {
            ...base,
            minLabel: tOpt(`q.${q.id}.minLabel`, base.minLabel),
            maxLabel: tOpt(`q.${q.id}.maxLabel`, base.maxLabel),
            dontKnow: base.dontKnow ? { ...base.dontKnow, label: t(`q.${q.id}.dontKnow`, base.dontKnow.label) } : undefined,
          };
        }
        if (base.type === 'grid') {
          return {
            ...base,
            rows: base.rows.map((r) => ({ ...r, label: t(`q.${q.id}.row.${r.id}`, r.label) })),
            columns: base.columns.map((c) => ({ ...c, label: t(`q.${q.id}.col.${c.code}`, c.label) })),
          };
        }
        if (base.type === 'numeric')
          return {
            ...base,
            unit: tOpt(`q.${q.id}.unit`, base.unit),
            minLabel: tOpt(`q.${q.id}.minLabel`, base.minLabel),
            maxLabel: tOpt(`q.${q.id}.maxLabel`, base.maxLabel),
          };
        return base;
      }),
    })),
  } as SurveyDefinition;
}

/** System messages in a language (falls back to the source text per message). */
export function localizeMessages(presentation: Pick<Presentation, 'theme'> | undefined, lang: Language | undefined): SystemMessages {
  const src = systemMessagesFor(presentation);
  if (!lang) return src;
  const out = { ...src };
  for (const k of Object.keys(src) as Array<keyof SystemMessages>) out[k] = pick(lang, `ui.${k}`, src[k]);
  return out;
}

export interface TranslationStatus {
  tag: string;
  name: string;
  enabled: boolean;
  total: number;
  translated: number;
  reviewed: number;
  /** Keys with no translation. */
  missing: string[];
  /** Keys translated from a source text that has since changed. */
  outdated: string[];
  /** Keys written by AI and not yet approved by a person. */
  unreviewed: string[];
  /** Keys whose translation drops or adds a piping placeholder like {{Q1}}. */
  placeholderMismatch: string[];
  /** Ready to offer to respondents: everything translated, current and reviewed. */
  complete: boolean;
}

function placeholders(text: string): string {
  return [...text.matchAll(new RegExp(PIPE_PATTERN.source, 'g'))]
    .map((m) => m[0])
    .sort()
    .join('|');
}

function messagePlaceholders(text: string): string {
  return [...text.matchAll(/\{(n|label|device)\}/g)]
    .map((m) => m[0])
    .sort()
    .join('|');
}

export function translationStatus(def: SurveyDefinition, presentation: Presentation): TranslationStatus[] {
  const keys = textKeys(def, presentation);
  return presentation.languages.map((lang) => {
    const missing: string[] = [];
    const outdated: string[] = [];
    const unreviewed: string[] = [];
    const placeholderMismatch: string[] = [];
    let translated = 0;
    let reviewed = 0;
    for (const k of keys) {
      const e = lang.texts[k.key];
      if (!e || !e.text.trim()) {
        missing.push(k.key);
        continue;
      }
      if (e.source !== k.source) {
        outdated.push(k.key);
        continue;
      }
      translated++;
      if (e.status === 'reviewed') reviewed++;
      else unreviewed.push(k.key);
      if (placeholders(e.text) !== placeholders(k.source) || messagePlaceholders(e.text) !== messagePlaceholders(k.source))
        placeholderMismatch.push(k.key);
    }
    return {
      tag: lang.tag,
      name: lang.name,
      enabled: lang.enabled,
      total: keys.length,
      translated,
      reviewed,
      missing,
      outdated,
      unreviewed,
      placeholderMismatch,
      complete: !missing.length && !outdated.length && !unreviewed.length && !placeholderMismatch.length,
    };
  });
}

/** Pick the respondent's language: an explicit choice, then the browser's preferences, then the source. */
export function chooseLanguage(
  sourceTag: string,
  offered: string[],
  requested: string | undefined,
  acceptLanguage: string | undefined,
): string {
  const all = [sourceTag, ...offered];
  const match = (want: string) => {
    const w = want.toLowerCase();
    return all.find((t) => t.toLowerCase() === w) ?? all.find((t) => t.toLowerCase().split('-')[0] === w.split('-')[0]);
  };
  if (requested) {
    const m = match(requested);
    if (m) return m;
  }
  if (acceptLanguage) {
    const prefs = acceptLanguage
      .split(',')
      .map((part) => {
        const [tag, ...params] = part.trim().split(';');
        const q = params.find((x) => x.trim().startsWith('q='));
        return { tag: tag!.trim(), q: q ? Number(q.trim().slice(2)) || 0 : 1 };
      })
      .filter((p) => p.tag && p.tag !== '*')
      .sort((a, b) => b.q - a.q);
    for (const p of prefs.slice(0, 10)) {
      const m = match(p.tag);
      if (m) return m;
    }
  }
  return sourceTag;
}
