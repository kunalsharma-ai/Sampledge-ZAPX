/** Talking to the ZAPX API: sign-in, survey package download and sync. Only ever called online. */
import { mediaIdsOf, parseSurveyDefinition } from '@zapx/survey-schema';
import { defaultMediaUrl } from '@zapx/survey-renderer';
import { deviceId, interviews, meta, type Interviewer, type LocalInterview, type SurveyPackage } from './store';

export class NotSignedIn extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'x-zapx-csrf': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new NotSignedIn('Please sign in again to sync.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (data as { message?: string | string[] }).message;
    throw new Error(Array.isArray(m) ? m.join(', ') : (m ?? `Request failed (${res.status})`));
  }
  return data as T;
}

export async function signIn(email: string, password: string): Promise<Interviewer> {
  const r = await call<{ user: Interviewer & { role: string } }>('/auth/login', { email, password });
  if (r.user.role !== 'INTERVIEWER') {
    await call('/auth/logout', {}).catch(() => undefined);
    throw new Error('This app is for interviewers. Other team members use the ZAPX studio.');
  }
  const me: Interviewer = { id: r.user.id, name: r.user.name, email: r.user.email };
  await meta.set('interviewer', me);
  return me;
}

export async function signOut() {
  await call('/auth/logout', {}).catch(() => undefined);
  await meta.del('interviewer');
}

/** Cache for survey media (images, video, audio); the service worker answers from it offline. */
export const MEDIA_CACHE = 'zapx-capi-media';

/**
 * Download every media file the surveys show, so interviews work offline. Files never change under
 * an id, so ones already cached are skipped. Returns the ids that could not be downloaded.
 */
export async function cacheMedia(pkg: SurveyPackage): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  const ids = new Set<string>();
  for (const s of pkg.surveys) {
    const parsed = parseSurveyDefinition(s.version.definition);
    if (parsed.ok) for (const id of mediaIdsOf(parsed.definition)) ids.add(id);
  }
  const cache = await caches.open(MEDIA_CACHE);
  const failed: string[] = [];
  for (const id of ids) {
    const url = defaultMediaUrl(id);
    if (await cache.match(url)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      await cache.put(url, res);
    } catch {
      failed.push(id);
    }
  }
  return failed;
}

/** Download the assigned surveys (their live versions) and their media for offline use. */
export async function downloadPackage(): Promise<SurveyPackage> {
  const pkg = await call<SurveyPackage>('/capi/package');
  await meta.set('package', pkg);
  const failed = await cacheMedia(pkg);
  await meta.set('mediaMissing', failed);
  return pkg;
}

export interface SyncSummary {
  sent: number;
  stored: number;
  rejected: number;
}

/** Upload finished interviews of the signed-in interviewer, in small batches. */
export async function syncNow(interviewerId: string): Promise<SyncSummary> {
  const device = await deviceId();
  const waiting = (await interviews.all()).filter((i) => i.state === 'finished' && i.interviewerId === interviewerId);
  const summary: SyncSummary = { sent: 0, stored: 0, rejected: 0 };
  for (let n = 0; n < waiting.length; n += 10) {
    const batch = waiting.slice(n, n + 10);
    const { results } = await call<{ results: Array<{ clientId: string; result: string; status?: string; reason?: string }> }>(
      '/capi/sync',
      {
        deviceId: device,
        interviews: batch.map(toUpload),
      },
    );
    for (const r of results) {
      const local = batch.find((b) => b.clientId === r.clientId);
      if (!local) continue;
      summary.sent++;
      if (r.result === 'rejected') summary.rejected++;
      else summary.stored++;
      await interviews.put({
        ...local,
        state: r.result === 'rejected' ? 'rejected' : 'synced',
        serverStatus: r.status ?? null,
        serverReason: r.reason ?? null,
      });
    }
  }
  return summary;
}

function toUpload(i: LocalInterview) {
  return {
    clientId: i.clientId,
    surveyId: i.surveyId,
    versionId: i.versionId,
    answers: i.answers,
    startedAt: i.startedAt,
    finishedAt: i.finishedAt ?? new Date().toISOString(),
    durationMs: Math.round(i.durationMs),
    language: i.language,
    ...(i.endedEarly ? { endedEarly: true } : {}),
  };
}
