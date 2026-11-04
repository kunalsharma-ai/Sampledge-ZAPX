import { describe, expect, it } from 'vitest';
import { formatNumber, textDirection } from './index.js';

describe('locale helpers', () => {
  it('knows right-to-left languages', () => {
    for (const t of ['ar', 'ar-EG', 'he', 'fa-IR', 'ur', 'yi', 'pa-Arab', 'ckb']) expect(textDirection(t)).toBe('rtl');
    for (const t of ['en', 'hi', 'zh-Hans', 'az-Latn', 'pa', undefined]) expect(textDirection(t)).toBe('ltr');
  });
  it('formats numbers per language', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
    expect(formatNumber(12, 'ar-EG')).toBe('١٢');
    expect(formatNumber(3, 'not a tag!')).toBe('3');
  });
});
