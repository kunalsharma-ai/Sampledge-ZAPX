'use client';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { message?: string | string[]; issues?: Array<{ path: string; message: string }>; [k: string]: unknown },
  ) {
    super(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? `Request failed (${status})`));
  }
}

/** Fetch wrapper: same-origin cookie session + CSRF header on every change. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-zapx-csrf': '1' } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'PROGRAMMER' | 'VIEWER';
  tenant: { id: string; name: string };
}

/** Multipart upload (files) with the same session and CSRF handling as `api`. */
export async function upload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'x-zapx-csrf': '1' }, body: form });
  if (res.status === 401 && typeof window !== 'undefined')
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
