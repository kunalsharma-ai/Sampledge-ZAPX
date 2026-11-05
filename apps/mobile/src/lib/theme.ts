import { useColorScheme } from 'react-native';
import { useSession } from './session';

/**
 * Neon AI palette from the CRM's default Quantum preset (packages/quantum, preset "neon-ai"):
 * deep indigo glass with violet, magenta and cyan light. Light mode uses the preset's light seeds.
 */
export interface Palette {
  scheme: 'dark' | 'light';
  bg: string;
  bg2: string;
  surface: string;
  surface2: string;
  border: string;
  edge: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  accent3: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
  viz: [string, string, string, string];
}

export const DARK: Palette = {
  scheme: 'dark',
  bg: '#090620',
  bg2: '#0f0a2e',
  surface: '#140f3a',
  surface2: '#1b1550',
  border: '#2c2566',
  edge: '#4a3aa8',
  text: '#efeaff',
  muted: '#a9a1d6',
  accent: '#7c5cff',
  accent2: '#e046f0',
  accent3: '#22d3ee',
  onAccent: '#ffffff',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#fb7185',
  viz: ['#22d3ee', '#8b5cf6', '#ec4899', '#d97706'],
};

export const LIGHT: Palette = {
  scheme: 'light',
  bg: '#f5f2ff',
  bg2: '#ece6ff',
  surface: '#ffffff',
  surface2: '#f4f0ff',
  border: '#ddd5f7',
  edge: '#b9a7f5',
  text: '#1a1240',
  muted: '#5b5385',
  accent: '#6d28d9',
  accent2: '#c026d3',
  accent3: '#0891b2',
  onAccent: '#ffffff',
  success: '#047857',
  warning: '#b45309',
  danger: '#be123c',
  viz: ['#0891b2', '#7c3aed', '#db2777', '#d97706'],
};

export type ThemeChoice = 'system' | 'dark' | 'light';

export function usePalette(): Palette {
  const system = useColorScheme();
  const { theme } = useSession();
  const scheme = theme === 'system' ? (system === 'light' ? 'light' : 'dark') : theme;
  return scheme === 'light' ? LIGHT : DARK;
}
