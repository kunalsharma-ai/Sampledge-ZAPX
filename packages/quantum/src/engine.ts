import type { Appearance, Density } from './appearance';
import { contrast, ensureContrast, mix, readableOn, withAlpha } from './color';
import { PRESETS, type ThemePreset } from './presets';

export interface Environment {
  /** The operating system prefers a dark colour scheme. */
  prefersDark: boolean;
  /** The operating system asks for reduced motion. */
  prefersReducedMotion: boolean;
}

export interface ResolvedTheme {
  scheme: 'light' | 'dark';
  /** CSS custom properties to set on the document element. */
  vars: Record<string, string>;
  /** Attributes to set on the document element (CSS hooks). */
  attrs: Record<string, string>;
  /** The solid colours behind the tokens, for contrast reporting. */
  palette: Palette;
}

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  text: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentText: string;
  onAccent: string;
  accentSoft: string;
  gradientEnd: string;
  focus: string;
  good: string;
  warn: string;
  bad: string;
  info: string;
}

const STATUS = {
  dark: { good: '#4ade80', warn: '#fbbf24', bad: '#f87171', info: '#60a5fa' },
  light: { good: '#15803d', warn: '#b45309', bad: '#c62828', info: '#1d4ed8' },
};

const DENSITY: Record<Density, Record<string, string>> = {
  compact: {
    '--q-control-h': '30px',
    '--q-pad-x': '10px',
    '--q-pad-y': '4px',
    '--q-cell-y': '4px',
    '--q-gap': '8px',
    '--q-panel-pad': '12px',
  },
  comfortable: {
    '--q-control-h': '36px',
    '--q-pad-x': '14px',
    '--q-pad-y': '7px',
    '--q-cell-y': '7px',
    '--q-gap': '12px',
    '--q-panel-pad': '16px',
  },
  spacious: {
    '--q-control-h': '42px',
    '--q-pad-x': '16px',
    '--q-pad-y': '10px',
    '--q-cell-y': '10px',
    '--q-gap': '16px',
    '--q-panel-pad': '22px',
  },
};

/** Text and status colours must reach 4.5:1 (7:1 in high contrast) on every surface they sit on. */
function buildPalette(preset: ThemePreset, scheme: 'light' | 'dark', a: Appearance): Palette {
  const seed = preset[scheme];
  const hc = a.highContrast;
  const custom = a.accent ?? null;
  const baseAccent = custom ?? seed.accent ?? preset.accents[0];
  // Adaptive Dynamic tints its neutrals with the chosen accent.
  const tint = preset.usesCustomAccent ? baseAccent : null;
  const bg = tint ? mix(seed.bg, tint, scheme === 'dark' ? 0.05 : 0.025) : seed.bg;
  const surface = tint ? mix(seed.surface, tint, scheme === 'dark' ? 0.06 : 0.015) : seed.surface;
  const text = hc ? (scheme === 'dark' ? '#ffffff' : '#000000') : seed.text;
  const surface2 = mix(surface, text, scheme === 'dark' ? 0.04 : 0.03);
  const surface3 = mix(surface, text, scheme === 'dark' ? 0.08 : 0.06);
  const surfaces = [bg, surface, surface2, surface3];
  const textRatio = hc ? 7 : 4.5;

  const textMuted = ensureContrast(mix(text, surface, hc ? 0.12 : 0.36), surfaces, textRatio);
  const border = hc ? ensureContrast(mix(surface, text, 0.5), [surface, bg], 4.5) : mix(surface, text, scheme === 'dark' ? 0.12 : 0.11);
  const borderStrong = ensureContrast(mix(surface, text, 0.3), [surface, surface2], 3);

  // Fill colour: the text drawn on it must read at 4.5:1.
  let accent = baseAccent;
  let onAccent = readableOn(accent);
  if (contrast(onAccent, accent) < 4.5) accent = ensureContrast(accent, [onAccent], 4.5);
  onAccent = readableOn(accent);
  const accentSoft = mix(surface, accent, scheme === 'dark' ? 0.2 : 0.1);
  const accentText = ensureContrast(accent, [...surfaces, accentSoft], textRatio);

  // Gradient end for primary actions; the button label must still pass against it.
  const blend = hc ? 0 : (a.gradient / 100) * 0.85;
  let gradientEnd = mix(accent, preset.accents[1], blend);
  if (contrast(onAccent, gradientEnd) < 4.5) gradientEnd = ensureContrast(gradientEnd, [onAccent], 4.5);

  const focus = ensureContrast(accentText, [bg, surface], 3);
  const status = STATUS[scheme];
  const statusOn = (c: string) => ensureContrast(c, [...surfaces, mix(surface, c, 0.14)], textRatio);

  return {
    bg,
    surface,
    surface2,
    surface3,
    text,
    textMuted,
    border,
    borderStrong,
    accent,
    accentText,
    onAccent,
    accentSoft,
    gradientEnd,
    focus,
    good: statusOn(status.good),
    warn: statusOn(status.warn),
    bad: statusOn(status.bad),
    info: statusOn(status.info),
  };
}

export function resolveScheme(a: Appearance, env: Environment): 'light' | 'dark' {
  return a.mode === 'system' ? (env.prefersDark ? 'dark' : 'light') : a.mode;
}

export function resolveMotion(a: Appearance, env: Environment): 'full' | 'subtle' | 'off' {
  if (a.motion === 'system') return env.prefersReducedMotion ? 'subtle' : 'full';
  return a.motion;
}

/** Turns appearance settings into CSS custom properties and document attributes. Pure. */
export function resolveTheme(a: Appearance, env: Environment): ResolvedTheme {
  const preset = PRESETS[a.preset];
  const scheme = resolveScheme(a, env);
  const p = buildPalette(preset, scheme, a);
  const motion = resolveMotion(a, env);
  const hc = a.highContrast;
  const dark = scheme === 'dark';

  const glass = hc ? 0 : a.glass / 100;
  const meshStrength = hc ? 0 : (a.background / 100) * (dark ? 0.55 : 0.32);
  const [, accent2, accent3] = preset.accents;
  const accentForMesh = p.accent;

  const vars: Record<string, string> = {
    '--q-bg': p.bg,
    '--q-surface': p.surface,
    '--q-surface-2': p.surface2,
    '--q-surface-3': p.surface3,
    '--q-glass': withAlpha(p.surface, 1 - glass * 0.42),
    '--q-glass-2': withAlpha(p.surface2, 1 - glass * 0.5),
    '--q-glass-blur': `${Math.round(glass * 18)}px`,
    '--q-text': p.text,
    '--q-text-muted': p.textMuted,
    '--q-border': p.border,
    '--q-border-strong': p.borderStrong,
    '--q-accent': p.accent,
    '--q-accent-text': p.accentText,
    '--q-on-accent': p.onAccent,
    '--q-accent-soft': p.accentSoft,
    '--q-accent-2': accent2,
    '--q-accent-3': accent3,
    '--q-gradient': `linear-gradient(135deg, ${p.accent} 0%, ${p.gradientEnd} 100%)`,
    '--q-gradient-text': hc
      ? p.accentText
      : `linear-gradient(120deg, ${p.accentText} 0%, ${ensureContrast(mix(p.accentText, accent2, 0.7), [p.surface, p.bg], 4.5)} 100%)`,
    '--q-mesh-1': withAlpha(accentForMesh, meshStrength),
    '--q-mesh-2': withAlpha(accent2, meshStrength * 0.8),
    '--q-mesh-3': withAlpha(accent3, meshStrength * 0.6),
    '--q-focus': p.focus,
    '--q-good': p.good,
    '--q-warn': p.warn,
    '--q-bad': p.bad,
    '--q-info': p.info,
    '--q-good-soft': mix(p.surface, p.good, 0.14),
    '--q-warn-soft': mix(p.surface, p.warn, 0.14),
    '--q-bad-soft': mix(p.surface, p.bad, 0.14),
    '--q-info-soft': mix(p.surface, p.info, 0.14),
    '--q-shadow': dark
      ? '0 1px 0 rgb(255 255 255 / 0.04) inset, 0 10px 30px -12px rgb(0 0 0 / 0.6)'
      : '0 1px 2px rgb(16 24 40 / 0.06), 0 10px 30px -14px rgb(16 24 40 / 0.18)',
    '--q-shadow-pop': dark ? '0 18px 50px -12px rgb(0 0 0 / 0.7)' : '0 18px 50px -16px rgb(16 24 40 / 0.3)',
    '--q-glow': hc ? 'none' : `0 0 0 1px ${withAlpha(p.accent, 0.35)}, 0 8px 24px -8px ${withAlpha(p.accent, dark ? 0.55 : 0.35)}`,
    ...DENSITY[a.density],
    '--q-dur-fast': motion === 'off' ? '0ms' : motion === 'subtle' ? '100ms' : '140ms',
    '--q-dur-base': motion === 'off' ? '0ms' : motion === 'subtle' ? '140ms' : '200ms',
    '--q-dur-slow': motion === 'off' ? '0ms' : motion === 'subtle' ? '180ms' : '320ms',
    // Movement distance: subtle motion fades without sliding or scaling.
    '--q-move': motion === 'full' ? '1' : '0',
  };

  return {
    scheme,
    vars,
    attrs: {
      'data-q-theme': preset.id,
      'data-q-scheme': scheme,
      'data-q-density': a.density,
      'data-q-motion': motion,
      'data-q-contrast': hc ? 'high' : 'normal',
    },
    palette: p,
  };
}

export interface ContrastCheck {
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  passes: boolean;
}

/** The pairs the design system promises, with their measured ratios. Shown in Appearance settings. */
export function contrastReport(theme: ResolvedTheme, highContrast = false): ContrastCheck[] {
  const p = theme.palette;
  const t = highContrast ? 7 : 4.5;
  const pairs: Array<[string, string, string, number]> = [
    ['Body text on panels', p.text, p.surface, t],
    ['Body text on page background', p.text, p.bg, t],
    ['Secondary text on panels', p.textMuted, p.surface, t],
    ['Secondary text on raised rows', p.textMuted, p.surface3, t],
    ['Links on panels', p.accentText, p.surface, t],
    ['Primary button label', p.onAccent, p.accent, 4.5],
    ['Primary button label (gradient end)', p.onAccent, p.gradientEnd, 4.5],
    ['Success text', p.good, p.surface, t],
    ['Warning text', p.warn, p.surface, t],
    ['Error text', p.bad, p.surface, t],
    ['Input borders', p.borderStrong, p.surface, 3],
    ['Focus ring', p.focus, p.bg, 3],
  ];
  return pairs.map(([label, foreground, background, required]) => {
    const ratio = Math.round(contrast(foreground, background) * 100) / 100;
    return { label, foreground, background, ratio, required, passes: ratio >= required };
  });
}
