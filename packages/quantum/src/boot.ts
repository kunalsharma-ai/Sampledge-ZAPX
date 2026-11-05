import type { Appearance } from './appearance';
import { resolveTheme } from './engine';

/** localStorage key holding the last applied theme, read before the page paints. */
export const THEME_CACHE_KEY = 'zapx.quantum.theme.v1';

export interface ThemeCache {
  appearance: Appearance;
  /** Both schemes, so a `system` mode can pick the right one before any script bundle runs. */
  light: { vars: Record<string, string>; attrs: Record<string, string> };
  dark: { vars: Record<string, string>; attrs: Record<string, string> };
}

export function buildThemeCache(appearance: Appearance, prefersReducedMotion: boolean): ThemeCache {
  const light = resolveTheme(appearance, { prefersDark: false, prefersReducedMotion });
  const dark = resolveTheme(appearance, { prefersDark: true, prefersReducedMotion });
  return { appearance, light: { vars: light.vars, attrs: light.attrs }, dark: { vars: dark.vars, attrs: dark.attrs } };
}

/**
 * A tiny script for the document head: applies the cached theme before first paint so pages never
 * flash the default colours. It only reads localStorage and sets styles; it never throws.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_CACHE_KEY)})||'null');if(!c||!c.appearance)return;var m=c.appearance.mode;var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var t=d?c.dark:c.light;var r=document.documentElement;for(var k in t.vars)r.style.setProperty(k,t.vars[k]);for(var a in t.attrs)r.setAttribute(a,t.attrs[a]);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
