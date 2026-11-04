import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  PRESET_LIST,
  THEME_BOOT_SCRIPT,
  buildThemeCache,
  contrast,
  contrastReport,
  ensureContrast,
  mix,
  resolveTheme,
  sanitizeAppearance,
  validateAppearance,
  type Appearance,
} from './index';

const env = { prefersDark: true, prefersReducedMotion: false };

describe('colour helpers', () => {
  it('measures WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  it('mixes and corrects towards the readable side', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    const fixed = ensureContrast('#3a3a3a', ['#111111'], 4.5);
    expect(contrast(fixed, '#111111')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('every preset meets its contrast promises', () => {
  const variants: Array<[string, Partial<Appearance>]> = [
    ['dark', { mode: 'dark' }],
    ['light', { mode: 'light' }],
    ['dark, high contrast', { mode: 'dark', highContrast: true }],
    ['light, high contrast', { mode: 'light', highContrast: true }],
    ['dark, full gradient', { mode: 'dark', gradient: 100 }],
    ['light, full gradient', { mode: 'light', gradient: 100 }],
  ];
  for (const preset of PRESET_LIST) {
    for (const [label, patch] of variants) {
      it(`${preset.name} (${label})`, () => {
        const a = { ...DEFAULT_APPEARANCE, preset: preset.id, ...patch };
        const report = contrastReport(resolveTheme(a, env), a.highContrast);
        const failing = report.filter((c) => !c.passes);
        expect(failing).toEqual([]);
      });
    }
  }

  it('keeps any custom accent readable, even very light or very dark ones', () => {
    for (const accent of ['#ffff00', '#000000', '#ffffff', '#7f7f7f', '#00ff88', '#ff0066']) {
      for (const mode of ['dark', 'light'] as const) {
        const a = { ...DEFAULT_APPEARANCE, preset: 'adaptive-dynamic' as const, accent, mode, gradient: 100 };
        const failing = contrastReport(resolveTheme(a, env)).filter((c) => !c.passes);
        expect(failing, `${accent} ${mode}`).toEqual([]);
      }
    }
  });
});

describe('theme engine', () => {
  it('follows the system scheme only in system mode', () => {
    const a = { ...DEFAULT_APPEARANCE, mode: 'system' as const };
    expect(resolveTheme(a, { prefersDark: true, prefersReducedMotion: false }).scheme).toBe('dark');
    expect(resolveTheme(a, { prefersDark: false, prefersReducedMotion: false }).scheme).toBe('light');
    expect(resolveTheme({ ...a, mode: 'light' }, env).scheme).toBe('light');
  });

  it('honours reduced motion and the motion setting', () => {
    const sys = resolveTheme(DEFAULT_APPEARANCE, { prefersDark: true, prefersReducedMotion: true });
    expect(sys.attrs['data-q-motion']).toBe('subtle');
    expect(sys.vars['--q-move']).toBe('0');
    const off = resolveTheme({ ...DEFAULT_APPEARANCE, motion: 'off' }, env);
    expect(off.vars['--q-dur-base']).toBe('0ms');
    const full = resolveTheme({ ...DEFAULT_APPEARANCE, motion: 'full' }, { prefersDark: true, prefersReducedMotion: true });
    expect(full.vars['--q-dur-base']).toBe('200ms');
  });

  it('turns glass and background light off in high contrast', () => {
    const t = resolveTheme({ ...DEFAULT_APPEARANCE, glass: 100, background: 100, highContrast: true }, env);
    expect(t.vars['--q-glass-blur']).toBe('0px');
    expect(t.vars['--q-mesh-1']).toMatch(/\/ 0\)$/);
  });

  it('maps density to control sizes', () => {
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, density: 'compact' }, env).vars['--q-control-h']).toBe('30px');
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, density: 'spacious' }, env).vars['--q-control-h']).toBe('42px');
  });

  it('caches both schemes for the boot script', () => {
    const cache = buildThemeCache({ ...DEFAULT_APPEARANCE, mode: 'system' }, false);
    expect(cache.light.attrs['data-q-scheme']).toBe('light');
    expect(cache.dark.attrs['data-q-scheme']).toBe('dark');
    expect(THEME_BOOT_SCRIPT).toContain('zapx.quantum.theme.v1');
    expect(() => new Function(THEME_BOOT_SCRIPT)).not.toThrow();
  });
});

describe('appearance settings', () => {
  it('defaults to the Neon AI theme in dark mode', () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({ preset: 'neon-ai', mode: 'dark' });
    expect(buildThemeCache(DEFAULT_APPEARANCE, false).light.attrs['data-q-scheme']).toBe('dark');
  });

  it('sanitizes stored settings', () => {
    const a = sanitizeAppearance({ preset: 'cyber-pulse', glass: 250, accent: '#ABC', density: 'huge', extra: 1 });
    expect(a.preset).toBe('cyber-pulse');
    expect(a.glass).toBe(100);
    expect(a.accent).toBe('#aabbcc');
    expect(a.density).toBe('comfortable');
    expect(a).not.toHaveProperty('extra');
    expect(sanitizeAppearance('nonsense')).toEqual(DEFAULT_APPEARANCE);
  });

  it('validates input strictly', () => {
    expect(validateAppearance({ ...DEFAULT_APPEARANCE })).toEqual([]);
    expect(validateAppearance({ preset: 'neon' })).toEqual(['preset is not a known theme']);
    expect(validateAppearance({ glass: -1, accent: 'blue', hack: true })).toHaveLength(3);
    expect(validateAppearance([])).toHaveLength(1);
  });
});
