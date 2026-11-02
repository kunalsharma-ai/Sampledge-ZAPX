'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_APPEARANCE,
  THEME_CACHE_KEY,
  buildThemeCache,
  resolveTheme,
  sanitizeAppearance,
  type Appearance,
  type Environment,
  type ResolvedTheme,
  type ThemeCache,
} from '@zapx/quantum';

export type SaveState = 'idle' | 'saving' | 'saved' | 'local' | 'error';
/** Where the active appearance comes from. */
export type AppearanceSource = 'personal' | 'organization' | 'default';

interface ThemeContextValue {
  appearance: Appearance;
  resolved: ResolvedTheme;
  source: AppearanceSource;
  organizationDefault: Appearance | null;
  saveState: SaveState;
  /** Applies at once (no reload) and saves to the member's account shortly after. */
  update: (patch: Partial<Appearance>) => void;
  /** Forgets the member's own choice; the organization default (or the ZAPX default) applies. */
  resetToOrganization: () => Promise<void>;
  /** Admins: make `a` the organization default, or clear it with null. */
  setOrganizationDefault: (a: Appearance | null) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function environment(): Environment {
  if (typeof window === 'undefined' || !window.matchMedia) return { prefersDark: false, prefersReducedMotion: false };
  return {
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

function readCache(): Appearance | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    const c = raw ? (JSON.parse(raw) as Partial<ThemeCache>) : null;
    return c?.appearance ? sanitizeAppearance(c.appearance) : null;
  } catch {
    return null;
  }
}

function apply(a: Appearance, env: Environment): ResolvedTheme {
  const t = resolveTheme(a, env);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(t.attrs)) root.setAttribute(k, v);
  root.style.colorScheme = t.scheme;
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(buildThemeCache(a, env.prefersReducedMotion)));
  } catch {
    // Private browsing or storage full: the theme still applies for this page.
  }
  return t;
}

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  // Plain fetch rather than lib/api: a signed-out page (login) must not be redirected from here.
  return fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-zapx-csrf': '1' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [env, setEnv] = useState<Environment>({ prefersDark: false, prefersReducedMotion: false });
  const [source, setSource] = useState<AppearanceSource>('default');
  const [organizationDefault, setOrgDefault] = useState<Appearance | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const signedIn = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // First load: the cached theme (already painted by the head script), then the account's settings.
  useEffect(() => {
    const e = environment();
    setEnv(e);
    const cached = readCache();
    if (cached) setAppearance(cached);
    let cancelled = false;
    call('/me/preferences', 'GET')
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        signedIn.current = true;
        const body = (await res.json()) as { appearance: unknown; organizationDefault: unknown };
        const org = body.organizationDefault ? sanitizeAppearance(body.organizationDefault) : null;
        setOrgDefault(org);
        if (body.appearance) {
          setAppearance(sanitizeAppearance(body.appearance));
          setSource('personal');
        } else {
          setAppearance(org ?? DEFAULT_APPEARANCE);
          setSource(org ? 'organization' : 'default');
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow operating-system changes (dark mode at sunset, reduce motion) live.
  useEffect(() => {
    if (!window.matchMedia) return;
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setEnv(environment());
    dark.addEventListener('change', onChange);
    motion.addEventListener('change', onChange);
    return () => {
      dark.removeEventListener('change', onChange);
      motion.removeEventListener('change', onChange);
    };
  }, []);

  const resolved = useMemo(() => resolveTheme(appearance, env), [appearance, env]);
  useEffect(() => {
    apply(appearance, env);
  }, [appearance, env]);

  const current = useRef(appearance);
  current.current = appearance;

  const update = useCallback((patch: Partial<Appearance>) => {
    const next = sanitizeAppearance({ ...current.current, ...patch }, current.current);
    current.current = next;
    setAppearance(next);
    setSource('personal');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!signedIn.current) {
      setSaveState('local');
      return;
    }
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      call('/me/preferences', 'PUT', { appearance: current.current })
        .then((res) => setSaveState(res.ok ? 'saved' : 'error'))
        .catch(() => setSaveState('error'));
    }, 400);
  }, []);

  const resetToOrganization = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (signedIn.current) {
      const res = await call('/me/preferences/appearance', 'DELETE');
      if (!res.ok) {
        setSaveState('error');
        return;
      }
    }
    setAppearance(organizationDefault ?? DEFAULT_APPEARANCE);
    setSource(organizationDefault ? 'organization' : 'default');
    setSaveState('saved');
  }, [organizationDefault]);

  const setOrganizationDefault = useCallback(async (a: Appearance | null) => {
    const res = a ? await call('/tenant/appearance', 'PUT', { appearance: a }) : await call('/tenant/appearance', 'DELETE');
    if (!res.ok) throw new Error(res.status === 403 ? 'Only admins can change the organization default' : `Could not save (${res.status})`);
    setOrgDefault(a);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ appearance, resolved, source, organizationDefault, saveState, update, resetToOrganization, setOrganizationDefault }),
    [appearance, resolved, source, organizationDefault, saveState, update, resetToOrganization, setOrganizationDefault],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/** True when decorative movement (count-ups, shimmer) should run. */
export function useFullMotion(): boolean {
  const ctx = useContext(ThemeContext);
  return ctx ? ctx.resolved.attrs['data-q-motion'] === 'full' : false;
}
