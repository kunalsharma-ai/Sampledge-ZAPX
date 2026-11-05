import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import { changedKeys, EntitlementsStore, isOn, NONE, type Entitlements, type Transport } from './entitlements';
import { FEATURES, isFeatureKey, type FeatureKey } from './features';
import { useSession } from './session';
import type { ApiClient } from './api';

interface EntitlementsState {
  value: Entitlements;
  loaded: boolean;
  has(key: FeatureKey): boolean;
  refresh(): Promise<void>;
  /** The last change pushed by the super admin, shown as a banner for a few seconds. */
  notice: string | null;
}

const Ctx = createContext<EntitlementsState | null>(null);

function transportFor(api: ApiClient): Transport {
  return {
    async get(path, etag) {
      const res = await api.raw('GET', path, { headers: etag ? { 'If-None-Match': etag } : {} });
      if (res.status === 304) return { status: 304 };
      const body = res.ok ? await res.json() : undefined;
      if (res.status === 401) await api.get('/auth/me').catch(() => undefined); // lets the session sign out
      return { status: res.status, body, etag: res.headers.get('ETag') };
    },
    stream(path, onMessage, onError) {
      const es = new EventSource<'entitlements'>(`${api.baseUrl}${path}`, {
        headers: api.headers(),
        pollingInterval: 5000, // reconnect delay after the server closes the stream
      });
      es.addEventListener('entitlements', (ev) => {
        try {
          onMessage(JSON.parse(ev.data ?? 'null'));
        } catch {
          /* ignore a malformed event */
        }
      });
      es.addEventListener('error', () => onError());
      return () => {
        es.removeAllEventListeners();
        es.close();
      };
    },
  };
}

function describe(keys: string[], next: Entitlements): string {
  if (next.suspended) return 'Your organization has been suspended by the administrator.';
  if (next.surfaceAllowed === false) return 'The administrator has turned the mobile app off for you.';
  const on = keys.filter((k) => isOn(next, k));
  const off = keys.filter((k) => !isOn(next, k));
  const label = (k: string) => (isFeatureKey(k) ? FEATURES[k].label : k);
  const parts: string[] = [];
  if (on.length) parts.push(`Now available: ${on.map(label).join(', ')}`);
  if (off.length) parts.push(`Removed: ${off.map(label).join(', ')}`);
  return parts.join('. ');
}

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { api, member, setDeniedHandler } = useSession();
  const [value, setValue] = useState<Entitlements>(NONE);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const store = useMemo(() => new EntitlementsStore(transportFor(api)), [api]);

  useEffect(() => {
    if (!member) {
      store.reset();
      setValue(NONE);
      setLoaded(false);
      return;
    }
    // Pick up an answer the store already has (the effect can re-run while signed in).
    if (store.isLoaded) {
      setValue(store.value);
      setLoaded(true);
    }
    const unsub = store.subscribe((next, prev) => {
      setValue(next);
      setLoaded(true);
      // Announce changes only after a real first answer (prev.version is empty before it).
      if (prev.version && next.version) {
        const keys = changedKeys(prev, next);
        if (keys.length || next.suspended !== prev.suspended || next.surfaceAllowed !== prev.surfaceAllowed)
          setNotice(describe(keys, next));
      }
    });
    store.start();
    void store.refresh().finally(() => setLoaded(store.isLoaded));
    setDeniedHandler(() => void store.refresh());
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void store.refresh().catch(() => undefined);
    });
    return () => {
      unsub();
      store.stop();
      sub.remove();
      setDeniedHandler(null);
    };
  }, [store, member, setDeniedHandler]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const state: EntitlementsState = {
    value,
    loaded,
    has: (k) => isOn(value, k),
    refresh: () => store.refresh(),
    notice,
  };
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useEntitlements(): EntitlementsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEntitlements outside EntitlementsProvider');
  return v;
}

export function useFeature(key: FeatureKey): boolean {
  return useEntitlements().has(key);
}
