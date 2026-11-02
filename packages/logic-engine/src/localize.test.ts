import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePresentation, parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import {
  chooseLanguage,
  classifyDevice,
  localizeDefinition,
  localizeMessages,
  renderQuestion,
  textKeys,
  translationStatus,
  validatePage,
} from './index.js';

const r = parseSurveyDefinition(JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8')));
if (!r.ok) throw new Error('demo invalid');
const demo: SurveyDefinition = r.definition;

function frenchFor(def: SurveyDefinition, status: 'machine' | 'reviewed' = 'reviewed') {
  const texts: Record<string, { text: string; source: string; status: 'machine' | 'reviewed' }> = {};
  for (const k of textKeys(def)) texts[k.key] = { text: `FR ${k.source}`, source: k.source, status };
  return { tag: 'fr', name: 'Français', enabled: true, texts };
}

describe('localization', () => {
  it('lists every text with a stable key', () => {
    const keys = textKeys(demo).map((k) => k.key);
    expect(keys).toContain('q.AGE.text');
    expect(keys).toContain('q.AWARE.opt.99');
    expect(keys).toContain('q.RATE.row.' + (demo.pages[2]!.questions[0] as { rows: Array<{ id: string }> }).rows[0]!.id);
    expect(keys).toContain('ui.next');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('translates text without touching ids, codes or logic', () => {
    const fr = frenchFor(demo);
    const loc = localizeDefinition(demo, fr);
    const q = loc.pages[1]!.questions[0] as { id: string; text: string; options: Array<{ code: number; label: string }> };
    expect(q.id).toBe('AWARE');
    expect(q.text.startsWith('FR ')).toBe(true);
    expect(q.options.map((o) => o.code)).toEqual(
      (demo.pages[1]!.questions[0] as { options: Array<{ code: number }> }).options.map((o) => o.code),
    );
    expect(loc.terminations).toEqual(demo.terminations);
    // Piping uses translated labels.
    const grid = renderQuestion(loc.pages[2]!.questions[0]!, loc, { AWARE: [1] }, 'x');
    expect(grid.renderedText).toContain('FR ');
  });

  it('falls back to the source for missing or outdated entries', () => {
    const fr = frenchFor(demo);
    fr.texts['q.AGE.text']!.source = 'An older wording';
    delete fr.texts['q.GENDER.text'];
    const loc = localizeDefinition(demo, fr);
    const [age, gender] = loc.pages[0]!.questions;
    expect(age!.text).toBe(demo.pages[0]!.questions[0]!.text);
    expect(gender!.text).toBe(demo.pages[0]!.questions[1]!.text);
    const p = parsePresentation({ languages: [fr] });
    if (!p.ok) throw new Error('bad');
    const status = translationStatus(demo, p.presentation)[0]!;
    expect(status.outdated).toEqual(['q.AGE.text']);
    expect(status.missing).toEqual(['q.GENDER.text']);
    expect(status.complete).toBe(false);
  });

  it('flags machine translations and broken placeholders', () => {
    const fr = frenchFor(demo, 'machine');
    const pipeKey = textKeys(demo).find((k) => k.source.includes('{{'))!.key;
    fr.texts[pipeKey]!.text = 'Sans placeholder';
    const p = parsePresentation({ languages: [fr] });
    if (!p.ok) throw new Error('bad');
    const s = translationStatus(demo, p.presentation)[0]!;
    expect(s.unreviewed.length).toBe(s.translated);
    expect(s.placeholderMismatch).toEqual([pipeKey]);
  });

  it('translates validation messages', () => {
    const fr = frenchFor(demo);
    fr.texts['ui.required'] = { text: 'Réponse obligatoire.', source: 'This question requires an answer.', status: 'reviewed' };
    const msg = localizeMessages(undefined, fr);
    const res = validatePage(demo, demo.pages[0]!, {}, {}, msg);
    expect(res.errors[0]!.message).toBe('Réponse obligatoire.');
  });

  it('chooses the respondent language', () => {
    expect(chooseLanguage('en', ['fr', 'es-MX'], 'fr', undefined)).toBe('fr');
    expect(chooseLanguage('en', ['fr', 'es-MX'], 'de', 'es-ES,es;q=0.9,en;q=0.5')).toBe('es-MX');
    expect(chooseLanguage('en', ['fr'], undefined, 'de-DE')).toBe('en');
    expect(chooseLanguage('en', [], undefined, undefined)).toBe('en');
  });
});

describe('device classification', () => {
  it('classifies common browsers', () => {
    expect(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe('mobile');
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 13; SM-X700) Safari/537.36')).toBe('tablet');
    expect(classifyDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', { touch: true })).toBe('tablet');
    expect(classifyDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15')).toBe('desktop');
    expect(classifyDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', { touch: true, screenShortSide: 1080 })).toBe('desktop');
  });
});
