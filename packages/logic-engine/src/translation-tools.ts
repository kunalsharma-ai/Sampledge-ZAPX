/**
 * Blueprint phase 2: translation memory, glossary and per-language QA. Pure functions; the API
 * collects the organization's approved translations and glossary and passes them in.
 */
import type { Presentation, SurveyDefinition } from '@zapx/survey-schema';
import { textKeys, translationStatus } from './localize.js';

export interface GlossaryTerm {
  /** Term in the source language, e.g. "Net Promoter Score". */
  source: string;
  /** Required translation, e.g. "Net Promoter Score" (kept) or "Indice de recommandation". */
  target: string;
  note?: string;
}

/** Approved translations by exact source text, for one language. */
export type TranslationMemory = Map<string, string>;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Build a memory from reviewed translations of one language. When the same source text was
 * translated differently, the most frequent translation wins (ties: the first seen).
 */
export function buildTranslationMemory(entries: Iterable<{ source: string; text: string }>): TranslationMemory {
  const counts = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const src = norm(e.source);
    const text = e.text.trim();
    if (!src || !text) continue;
    const m = counts.get(src) ?? new Map<string, number>();
    m.set(text, (m.get(text) ?? 0) + 1);
    counts.set(src, m);
  }
  const memory: TranslationMemory = new Map();
  for (const [src, m] of counts) {
    let best = '';
    let n = 0;
    for (const [t, c] of m) if (c > n) [best, n] = [t, c];
    memory.set(src, best);
  }
  return memory;
}

/** Translations the memory can fill: texts that are missing or outdated and whose source was approved before. */
export function memoryMatches(
  def: SurveyDefinition,
  presentation: Presentation,
  tag: string,
  memory: TranslationMemory,
): Record<string, { text: string; source: string }> {
  const lang = presentation.languages.find((l) => l.tag === tag);
  if (!lang) return {};
  const out: Record<string, { text: string; source: string }> = {};
  for (const k of textKeys(def, presentation)) {
    const e = lang.texts[k.key];
    if (e && e.text.trim() && e.source === k.source) continue;
    const hit = memory.get(norm(k.source));
    if (hit) out[k.key] = { text: hit, source: k.source };
  }
  return out;
}

export type TranslationIssueKind = 'missing' | 'outdated' | 'unreviewed' | 'placeholders' | 'glossary' | 'too_long' | 'unchanged';

export interface TranslationIssue {
  key: string;
  kind: TranslationIssueKind;
  severity: 'error' | 'warning';
  message: string;
}

/** Above this length ratio a translation probably breaks buttons and narrow layouts. */
const MAX_EXPANSION = 2.5;

/**
 * Per-language QA: everything that blocks publishing (missing, outdated, unreviewed, broken piping)
 * plus warnings a reviewer should look at (glossary terms not used, much longer than the source,
 * identical to the source).
 */
export function translationQa(
  def: SurveyDefinition,
  presentation: Presentation,
  tag: string,
  glossary: GlossaryTerm[] = [],
): TranslationIssue[] {
  const lang = presentation.languages.find((l) => l.tag === tag);
  const status = translationStatus(def, presentation).find((s) => s.tag === tag);
  if (!lang || !status) return [];
  const issues: TranslationIssue[] = [];
  const add = (key: string, kind: TranslationIssueKind, severity: 'error' | 'warning', message: string) =>
    issues.push({ key, kind, severity, message });
  for (const k of status.missing) add(k, 'missing', 'error', 'Not translated.');
  for (const k of status.outdated) add(k, 'outdated', 'error', 'The source text changed after it was translated.');
  for (const k of status.unreviewed) add(k, 'unreviewed', 'error', 'Machine translation not yet reviewed by a person.');
  for (const k of status.placeholderMismatch) add(k, 'placeholders', 'error', 'Piping placeholders such as {{Q1}} differ from the source.');
  const terms = glossary.filter((g) => g.source.trim() && g.target.trim());
  for (const k of textKeys(def, presentation)) {
    const e = lang.texts[k.key];
    if (!e || !e.text.trim() || e.source !== k.source) continue;
    const src = k.source.toLowerCase();
    const txt = e.text.toLowerCase();
    for (const g of terms)
      if (src.includes(g.source.toLowerCase()) && !txt.includes(g.target.toLowerCase()))
        add(k.key, 'glossary', 'warning', `Glossary: "${g.source}" should be translated as "${g.target}".`);
    const plain = k.source.replace(/\{\{[^}]+\}\}/g, '');
    if (plain.length >= 12 && e.text.length > MAX_EXPANSION * k.source.length)
      add(
        k.key,
        'too_long',
        'warning',
        `Translation is ${Math.round((e.text.length / k.source.length) * 10) / 10}× longer than the source; check it fits on small screens.`,
      );
    if (/\p{L}{3}/u.test(plain) && norm(e.text) === norm(k.source) && !terms.some((g) => norm(g.target) === norm(e.text)))
      add(k.key, 'unchanged', 'warning', 'Same as the source text. Fine for brand names; otherwise translate it.');
  }
  return issues;
}

/** Glossary terms that occur in the given texts, to send with an AI translation request. */
export function glossaryFor(texts: string[], glossary: GlossaryTerm[]): GlossaryTerm[] {
  const all = texts.join('\n').toLowerCase();
  return glossary.filter((g) => g.source.trim() && all.includes(g.source.toLowerCase()));
}
