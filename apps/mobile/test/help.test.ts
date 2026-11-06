import { describe, expect, it } from 'vitest';
import { HELP } from '../src/lib/help';

const SECTION_KEYS = [
  'overview',
  'quotas',
  'responses',
  'outline',
  'assist',
  'qa',
  'review',
  'fieldwork',
  'analysis',
  'reports',
  'exports',
  'distribution',
  'cati',
];

describe('help cards', () => {
  it('every survey section has a help card with what, how and where', () => {
    for (const k of SECTION_KEYS) {
      const e = HELP[`section.${k}` as keyof typeof HELP];
      expect(e, k).toBeDefined();
      expect(e.what.length).toBeGreaterThan(10);
      expect(e.how.length).toBeGreaterThan(0);
      expect(e.where.length).toBeGreaterThan(5);
    }
  });
});
