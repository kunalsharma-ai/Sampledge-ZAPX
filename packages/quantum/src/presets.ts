/**
 * The Quantum theme presets: 16 families (Neon AI, the default, the original ten, and five from the
 * SampCode blueprint's Theme Studio). Each preset is a colour family with a dark and a light scheme, so
 * the person's light/dark/system choice works with every preset. Only key colours are listed here:
 * the theme engine derives the remaining tokens and corrects anything that would miss WCAG contrast.
 */

export const PRESET_IDS = [
  'neon-ai',
  'quantum-midnight',
  'aurora-intelligence',
  'obsidian-elite',
  'cyber-pulse',
  'arctic-glass',
  'royal-amethyst',
  'solar-titanium',
  'oceanic-intelligence',
  'minimal-executive',
  'adaptive-dynamic',
  'holographic-glass',
  'forest-intelligence',
  'sunset-fusion',
  'obsidian-gold',
  'crimson-carbon',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface SchemeSeed {
  bg: string;
  surface: string;
  text: string;
  /** Primary accent for this scheme (fills, links, focus). Falls back to the preset accent. */
  accent?: string;
}

export interface ThemePreset {
  id: PresetId;
  name: string;
  description: string;
  /** The scheme the preset was designed around; used for its gallery card. */
  native: 'dark' | 'light';
  /** Primary, secondary and tertiary accents. The last two are decorative (gradients, mesh light). */
  accents: [string, string, string];
  dark: SchemeSeed;
  light: SchemeSeed;
  /** True when the person's custom accent drives the theme (Adaptive Dynamic). */
  usesCustomAccent?: boolean;
}

export const PRESETS: Record<PresetId, ThemePreset> = {
  'neon-ai': {
    id: 'neon-ai',
    name: 'Neon AI',
    description: 'Deep indigo glass with violet, magenta and cyan neon light.',
    native: 'dark',
    accents: ['#7c5cff', '#e046f0', '#22d3ee'],
    dark: { bg: '#090620', surface: '#140f3a', text: '#efeaff' },
    light: { bg: '#f5f2ff', surface: '#ffffff', text: '#1a1240', accent: '#6d28d9' },
  },
  'quantum-midnight': {
    id: 'quantum-midnight',
    name: 'Quantum Midnight',
    description: 'Deep navy with electric blue and violet light.',
    native: 'dark',
    accents: ['#4f7dff', '#8b5cf6', '#38bdf8'],
    dark: { bg: '#070b1a', surface: '#0e1530', text: '#e8ecfb' },
    light: { bg: '#f3f5fd', surface: '#ffffff', text: '#0f1530', accent: '#2f5bea' },
  },
  'aurora-intelligence': {
    id: 'aurora-intelligence',
    name: 'Aurora Intelligence',
    description: 'Teal and emerald gradients over a cool blue base.',
    native: 'dark',
    accents: ['#14b8a6', '#10b981', '#3b82f6'],
    dark: { bg: '#03141a', surface: '#0a2028', text: '#e3f6f3' },
    light: { bg: '#f0f9f7', surface: '#ffffff', text: '#0b2422', accent: '#0f766e' },
  },
  'obsidian-elite': {
    id: 'obsidian-elite',
    name: 'Obsidian Elite',
    description: 'Charcoal and graphite with platinum detail.',
    native: 'dark',
    accents: ['#cfd5df', '#8a93a3', '#eef1f5'],
    dark: { bg: '#0b0c0f', surface: '#15171c', text: '#eceef2' },
    light: { bg: '#f4f5f7', surface: '#ffffff', text: '#15171c', accent: '#383e4a' },
  },
  'cyber-pulse': {
    id: 'cyber-pulse',
    name: 'Cyber Pulse',
    description: 'Midnight black with cyan and magenta energy.',
    native: 'dark',
    accents: ['#22d3ee', '#e040fb', '#7c3aed'],
    dark: { bg: '#05050a', surface: '#0e0e18', text: '#eef0fb' },
    light: { bg: '#f6f6fb', surface: '#ffffff', text: '#11111c', accent: '#0e7490' },
  },
  'arctic-glass': {
    id: 'arctic-glass',
    name: 'Arctic Glass',
    description: 'White, ice blue and silver. Bright and calm.',
    native: 'light',
    accents: ['#2b8ad6', '#94a3b8', '#7dd3fc'],
    dark: { bg: '#0a1119', surface: '#111b26', text: '#e6eef6', accent: '#5fb2f0' },
    light: { bg: '#eef4f9', surface: '#ffffff', text: '#0e1b28' },
  },
  'royal-amethyst': {
    id: 'royal-amethyst',
    name: 'Royal Amethyst',
    description: 'Dark purple and lavender with gold accents.',
    native: 'dark',
    accents: ['#a78bfa', '#f2c14e', '#7c3aed'],
    dark: { bg: '#110a1d', surface: '#1b122d', text: '#f1ecfb' },
    light: { bg: '#f7f4fc', surface: '#ffffff', text: '#1e1530', accent: '#6d28d9' },
  },
  'solar-titanium': {
    id: 'solar-titanium',
    name: 'Solar Titanium',
    description: 'Graphite and warm gray lit by amber.',
    native: 'dark',
    accents: ['#f59e0b', '#fbbf24', '#a8a29e'],
    dark: { bg: '#11100f', surface: '#1b1917', text: '#f3efe9' },
    light: { bg: '#f8f6f2', surface: '#ffffff', text: '#1f1b16', accent: '#b45309' },
  },
  'oceanic-intelligence': {
    id: 'oceanic-intelligence',
    name: 'Oceanic Intelligence',
    description: 'Deep ocean blue with turquoise currents.',
    native: 'dark',
    accents: ['#0ea5e9', '#2dd4bf', '#1d4ed8'],
    dark: { bg: '#03111f', surface: '#081d33', text: '#e4f1fb' },
    light: { bg: '#f0f7fb', surface: '#ffffff', text: '#082033', accent: '#0369a1' },
  },
  'minimal-executive': {
    id: 'minimal-executive',
    name: 'Minimal Executive',
    description: 'White and slate with understated accents.',
    native: 'light',
    accents: ['#3d5a80', '#64748b', '#94a3b8'],
    dark: { bg: '#0f1115', surface: '#171a20', text: '#e8eaee', accent: '#8aa4c8' },
    light: { bg: '#f8fafc', surface: '#ffffff', text: '#111827' },
  },
  'adaptive-dynamic': {
    id: 'adaptive-dynamic',
    name: 'Adaptive Dynamic',
    description: 'Built around the accent colour you choose.',
    native: 'dark',
    accents: ['#6366f1', '#ec4899', '#22d3ee'],
    dark: { bg: '#0a0b10', surface: '#14151d', text: '#ebecf3' },
    light: { bg: '#f6f6f9', surface: '#ffffff', text: '#14151d' },
    usesCustomAccent: true,
  },
  'holographic-glass': {
    id: 'holographic-glass',
    name: 'Holographic Glass',
    description: 'Frosted pearl glass with iridescent pink, cyan and lilac light.',
    native: 'light',
    accents: ['#8b5cf6', '#ec4899', '#06b6d4'],
    dark: { bg: '#0d0b18', surface: '#191628', text: '#f1effa', accent: '#b69cff' },
    light: { bg: '#f4f2fb', surface: '#ffffff', text: '#1b1730', accent: '#6d28d9' },
  },
  'forest-intelligence': {
    id: 'forest-intelligence',
    name: 'Forest Intelligence',
    description: 'Deep pine green with moss and fresh lime highlights.',
    native: 'dark',
    accents: ['#22c55e', '#84cc16', '#14b8a6'],
    dark: { bg: '#06120c', surface: '#0d1f16', text: '#e6f4ea' },
    light: { bg: '#f1f8f3', surface: '#ffffff', text: '#0e2016', accent: '#15803d' },
  },
  'sunset-fusion': {
    id: 'sunset-fusion',
    name: 'Sunset Fusion',
    description: 'Dusky plum fading into coral, orange and rose.',
    native: 'dark',
    accents: ['#fb7185', '#f97316', '#c026d3'],
    dark: { bg: '#170a14', surface: '#24111f', text: '#fbecef' },
    light: { bg: '#fdf4f3', surface: '#ffffff', text: '#2a1220', accent: '#be123c' },
  },
  'obsidian-gold': {
    id: 'obsidian-gold',
    name: 'Obsidian Gold',
    description: 'Black volcanic glass with polished gold.',
    native: 'dark',
    accents: ['#d4a72c', '#f5d061', '#8a6d1f'],
    dark: { bg: '#080706', surface: '#14120e', text: '#f5efe2' },
    light: { bg: '#faf7f0', surface: '#ffffff', text: '#1d1a12', accent: '#8a6410' },
  },
  'crimson-carbon': {
    id: 'crimson-carbon',
    name: 'Crimson Carbon',
    description: 'Carbon black weave with crimson and steel.',
    native: 'dark',
    accents: ['#ef4444', '#f43f5e', '#94a3b8'],
    dark: { bg: '#0b0a0b', surface: '#171415', text: '#f3eded' },
    light: { bg: '#f8f5f5', surface: '#ffffff', text: '#1f1416', accent: '#b91c1c' },
  },
};

export const PRESET_LIST: ThemePreset[] = PRESET_IDS.map((id) => PRESETS[id]);
