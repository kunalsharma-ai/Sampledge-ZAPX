import { isHexColor } from './color';
import { PRESET_IDS, type PresetId } from './presets';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'comfortable' | 'spacious';
/** `system` follows the operating system's reduce-motion setting (full, or subtle when reduced). */
export type MotionLevel = 'system' | 'full' | 'subtle' | 'off';

/** A person's (or an organization's default) appearance settings. Stored as JSON. */
export interface Appearance {
  version: 1;
  preset: PresetId;
  mode: ThemeMode;
  /** Custom accent colour (#rrggbb). Drives Adaptive Dynamic and overrides other presets' accent. */
  accent: string | null;
  /** 0-100: strength of the background gradient light. */
  background: number;
  /** 0-100: translucency and blur of panels. 0 = solid panels. */
  glass: number;
  /** 0-100: how far primary actions and highlights blend into the secondary accent. */
  gradient: number;
  density: Density;
  highContrast: boolean;
  motion: MotionLevel;
}

export const DEFAULT_APPEARANCE: Appearance = {
  version: 1,
  preset: 'quantum-midnight',
  mode: 'system',
  accent: null,
  background: 55,
  glass: 45,
  gradient: 60,
  density: 'comfortable',
  highContrast: false,
  motion: 'system',
};

const MODES: ThemeMode[] = ['system', 'light', 'dark'];
const DENSITIES: Density[] = ['compact', 'comfortable', 'spacious'];
const MOTIONS: MotionLevel[] = ['system', 'full', 'subtle', 'off'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function percent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : fallback;
}

/**
 * Reads stored or submitted settings tolerantly: unknown keys are dropped and anything missing or
 * invalid falls back to `base`. Use `validateAppearance` where invalid input should be rejected.
 */
export function sanitizeAppearance(input: unknown, base: Appearance = DEFAULT_APPEARANCE): Appearance {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const accent = typeof v.accent === 'string' && isHexColor(v.accent) ? normalizeHex(v.accent) : v.accent === null ? null : base.accent;
  return {
    version: 1,
    preset: pick(v.preset, PRESET_IDS, base.preset),
    mode: pick(v.mode, MODES, base.mode),
    accent,
    background: percent(v.background, base.background),
    glass: percent(v.glass, base.glass),
    gradient: percent(v.gradient, base.gradient),
    density: pick(v.density, DENSITIES, base.density),
    highContrast: typeof v.highContrast === 'boolean' ? v.highContrast : base.highContrast,
    motion: pick(v.motion, MOTIONS, base.motion),
  };
}

/** Strict check for API input: returns a list of problems (empty when valid). */
export function validateAppearance(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Appearance must be an object'];
  const v = input as Record<string, unknown>;
  const issues: string[] = [];
  const known = new Set(['version', 'preset', 'mode', 'accent', 'background', 'glass', 'gradient', 'density', 'highContrast', 'motion']);
  for (const k of Object.keys(v)) if (!known.has(k)) issues.push(`Unknown setting: ${k}`);
  if (v.version !== undefined && v.version !== 1) issues.push('version must be 1');
  if (v.preset !== undefined && !(PRESET_IDS as readonly unknown[]).includes(v.preset)) issues.push('preset is not a known theme');
  if (v.mode !== undefined && !(MODES as unknown[]).includes(v.mode)) issues.push('mode must be system, light or dark');
  if (v.accent !== undefined && v.accent !== null && !(typeof v.accent === 'string' && isHexColor(v.accent)))
    issues.push('accent must be a hex colour such as #4f7dff, or null');
  for (const k of ['background', 'glass', 'gradient'] as const)
    if (v[k] !== undefined && !(typeof v[k] === 'number' && Number.isFinite(v[k]) && v[k] >= 0 && v[k] <= 100))
      issues.push(`${k} must be a number from 0 to 100`);
  if (v.density !== undefined && !(DENSITIES as unknown[]).includes(v.density))
    issues.push('density must be compact, comfortable or spacious');
  if (v.highContrast !== undefined && typeof v.highContrast !== 'boolean') issues.push('highContrast must be true or false');
  if (v.motion !== undefined && !(MOTIONS as unknown[]).includes(v.motion)) issues.push('motion must be system, full, subtle or off');
  return issues;
}

function normalizeHex(value: string): string {
  let h = value.trim().replace('#', '').toLowerCase();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return `#${h}`;
}
