import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from './session';
import { ApiError } from './api';

/** GET a path and keep it fresh; pass null to skip. Re-runs when the path changes. */
export function useApi<T>(path: string | null) {
  const { api } = useSession();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get<T>(path);
      if (n === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [api, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Run a mutation and expose its pending state and error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <R>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
