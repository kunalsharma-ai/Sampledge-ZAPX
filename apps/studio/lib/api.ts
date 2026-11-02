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
  role: 'ADMIN' | 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';
  projectScope: 'ALL' | 'ASSIGNED';
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

/** A background job (Milestone 7), as GET /api/jobs/:id returns it. */
export interface Job<R = Record<string, unknown>> {
  id: string;
  type: 'export' | 'qa_run' | 'ai_propose';
  surveyId: string | null;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress: number;
  progressNote: string | null;
  result: R | null;
  error: string | null;
  attempts: number;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const jobDone = (j: Job<unknown>) => j.status === 'SUCCEEDED' || j.status === 'FAILED' || j.status === 'CANCELLED';

/**
 * Poll a job until it finishes, reporting each update. Resolves with the finished job; rejects with
 * an Error carrying the job's message when it failed or was cancelled.
 */
export async function waitForJob<R>(id: string, onUpdate?: (j: Job<R>) => void, signal?: { stopped: boolean }): Promise<Job<R>> {
  let delay = 500;
  for (;;) {
    const j = await api<Job<R>>(`/jobs/${id}`);
    onUpdate?.(j);
    if (j.status === 'SUCCEEDED') return j;
    if (j.status === 'FAILED') throw new Error(j.error ?? 'The job failed.');
    if (j.status === 'CANCELLED') throw new Error('The job was cancelled.');
    if (signal?.stopped) return j;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(3000, Math.round(delay * 1.5));
  }
}
