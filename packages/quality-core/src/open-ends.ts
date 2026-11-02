/**
 * Open-ended answer checks. Deliberately conservative: a flag lowers the quality score and sends
 * the interview to human review; it never decides on its own that a person is a bad respondent.
 */
import { createHash } from 'node:crypto';

export type OpenEndIssue = 'gibberish' | 'low_effort';

const LOW_EFFORT = new Set([
  'idk',
  'dk',
  'na',
  'n/a',
  'nil',
  'ok',
  'okay',
  'good',
  'fine',
  'nice',
  'yes',
  'no',
  'test',
  'abc',
  'xyz',
  'asd',
]);
const KEYBOARD_RUNS = [
  'qwert',
  'werty',
  'asdf',
  'sdfg',
  'dfgh',
  'fghj',
  'ghjk',
  'hjkl',
  'zxcv',
  'xcvb',
  'cvbn',
  'vbnm',
  'qwer',
  'uiop',
  'yxcv',
];
const LATIN_LETTER = /[a-zÀ-ɏ]/;
const VOWEL = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿœ]/;

/** Lower-case, accents kept, punctuation and repeated whitespace removed. */
export function normalizeOpenEnd(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify one open answer. Returns null when nothing looks wrong. Only Latin-script text is checked
 * for gibberish (vowel and keyboard heuristics do not apply to other scripts); repeated characters
 * and repeated words are checked in every script.
 */
export function openEndIssue(raw: string): OpenEndIssue | null {
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  if (/\d/.test(text) && /^[\d\s.,:/-]+$/.test(text)) return null; // numbers, dates, prices: not judged here
  if (LOW_EFFORT.has(text) || /^[\p{P}\p{S}\s]+$/u.test(text) || [...text].length <= 1) return 'low_effort';

  const compact = text.replace(/\s+/g, '');
  if (/^(.)\1{3,}$/u.test(compact)) return 'gibberish'; // "aaaaa", "!!!!"
  if (/^(.{2,4})\1{2,}$/u.test(compact)) return 'gibberish'; // "asasas", "abcabcabc"

  const words = normalizeOpenEnd(text).split(' ').filter(Boolean);
  if (words.length >= 3 && new Set(words).size === 1) return 'gibberish'; // "good good good"

  const latin = [...compact].filter((c) => LATIN_LETTER.test(c));
  if (latin.length >= 5 && latin.length >= compact.length * 0.6) {
    if (KEYBOARD_RUNS.some((k) => compact.includes(k)) && words.length <= 2) return 'gibberish';
    const vowels = latin.filter((c) => VOWEL.test(c)).length;
    if (vowels / latin.length < 0.12) return 'gibberish'; // "sdfghjk", "xcvbnm"
    if (words.some((w) => /[bcdfghjklmnpqrstvwxz]{6,}/.test(w))) return 'gibberish';
  }
  return null;
}

/**
 * Fingerprint for spotting the same answer from different respondents (copy-paste, bots, answer
 * farms). Short answers are excluded: two people can honestly write "too expensive".
 */
export const FINGERPRINT_MIN_CHARS = 25;

export function openEndFingerprint(raw: string): string | null {
  const n = normalizeOpenEnd(raw);
  if (n.length < FINGERPRINT_MIN_CHARS) return null;
  return createHash('sha256').update(n).digest('hex');
}
