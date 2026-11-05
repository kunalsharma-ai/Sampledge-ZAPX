import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Constants from 'expo-constants';
import { ApiClient, normalizeServer } from './api';
import { secure } from './storage';
import { versionProblem } from './version';
import type { ThemeChoice } from './theme';

export interface Member {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER' | string;
  tenant?: { id: string; name: string };
  canManageIntegrations?: boolean;
  superAdmin?: boolean;
}

interface SessionState {
  ready: boolean;
  server: string;
  member: Member | null;
  api: ApiClient;
  theme: ThemeChoice;
  setTheme(t: ThemeChoice): void;
  signIn(server: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Keep the session going with a token the server re-issued (after a password change). */
  adoptToken(token: string): Promise<void>;
  /** Registered by the entitlements provider so the API can ask it to refresh after a 403. */
  setDeniedHandler(fn: ((feature?: string) => void) | null): void;
}

const Ctx = createContext<SessionState | null>(null);
const K = { server: 'zapx.server', token: 'zapx.token', member: 'zapx.member', theme: 'zapx.theme' };

export const defaultServer = (): string => (Constants.expoConfig?.extra?.zapxServer as string | undefined) ?? '';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState(defaultServer());
  const [token, setToken] = useState<string | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const denied = useRef<((feature?: string) => void) | null>(null);

  const clear = useCallback(async () => {
    setToken(null);
    setMember(null);
    await secure.set(K.token, null);
    await secure.set(K.member, null);
  }, []);

  const api = useMemo(
    () =>
      new ApiClient(server || 'https://invalid.local', token, {
        onUnauthorized: () => void clear(),
        onEntitlementDenied: (f) => denied.current?.(f),
      }),
    [server, token, clear],
  );

  useEffect(() => {
    void (async () => {
      const [s, t, m, th] = await Promise.all([secure.get(K.server), secure.get(K.token), secure.get(K.member), secure.get(K.theme)]);
      if (s) setServer(s);
      if (th === 'dark' || th === 'light' || th === 'system') setThemeState(th);
      if (s && t && m) {
        setToken(t);
        try {
          setMember(JSON.parse(m) as Member);
        } catch {
          /* corrupt cache: sign in again */
        }
      }
      setReady(true);
    })();
  }, []);

  // Confirm the stored session is still valid and refresh the member's details.
  useEffect(() => {
    if (!token) return;
    api
      .get<Member>('/auth/me')
      .then((m) => {
        if (m?.id) {
          setMember(m);
          void secure.set(K.member, JSON.stringify(m));
        }
      })
      .catch(() => undefined);
  }, [api, token]);

  const signIn = useCallback(async (rawServer: string, email: string, password: string) => {
    const s = normalizeServer(rawServer);
    const client = new ApiClient(s, null);
    const info = await client.get<{ service?: string; minimumAppVersion?: string | null }>('/mobile/version').catch(() => null);
    const problem = versionProblem(Constants.expoConfig?.version ?? '0.0.0', info);
    if (problem) throw new Error(problem);
    const r = await client.post<{ user: Member; token: string }>('/auth/login', { email, password });
    await secure.set(K.server, s);
    await secure.set(K.token, r.token);
    await secure.set(K.member, JSON.stringify(r.user));
    setServer(s);
    setToken(r.token);
    setMember(r.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* already signed out on the server */
    }
    await clear();
  }, [api, clear]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    void secure.set(K.theme, t);
  }, []);

  const adoptToken = useCallback(async (t: string) => {
    await secure.set(K.token, t);
    setToken(t);
  }, []);

  const setDeniedHandler = useCallback((fn: ((feature?: string) => void) | null) => {
    denied.current = fn;
  }, []);

  const value: SessionState = {
    ready,
    server,
    member: token ? member : null,
    api,
    theme,
    setTheme,
    signIn,
    signOut,
    adoptToken,
    setDeniedHandler,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
