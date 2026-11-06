/**
 * On-device storage (IndexedDB). Interviews are written after every page, so closing the app,
 * losing power or losing the connection never loses an answer. Nothing here is sent anywhere
 * except by sync, to the SampCode API this app was loaded from.
 */
import type { Answers } from '@zapx/survey-schema';

export interface PackagedSurvey {
  assignmentId: string;
  surveyId: string;
  name: string;
  status: 'DRAFT' | 'LIVE' | 'PAUSED' | 'CLOSED';
  target: number | null;
  completesSynced: number;
  version: { id: string; version: number; definition: unknown; presentation: unknown };
}

export interface Interviewer {
  id: string;
  name: string;
  email: string;
}

export interface SurveyPackage {
  interviewer: Interviewer;
  generatedAt: string;
  surveys: PackagedSurvey[];
}

export type InterviewState = 'in_progress' | 'finished' | 'synced' | 'rejected';

export interface LocalInterview {
  clientId: string;
  interviewerId: string;
  surveyId: string;
  versionId: string;
  surveyName: string;
  answers: Answers;
  pageIndex: number;
  language: string;
  startedAt: string;
  finishedAt: string | null;
  /** Time on answered pages, in milliseconds. */
  durationMs: number;
  endedEarly: boolean;
  state: InterviewState;
  /** What the device computed. Provisional: the server decides. */
  localOutcome: string | null;
  serverStatus: string | null;
  serverReason: string | null;
  /** Milestone 12: where the interview started and ended (when the survey records locations). */
  location?: { start: DevicePoint | null; end: DevicePoint | null };
  /** Recording consent: recorded, declined, or unavailable (no microphone or permission). Unset until asked. */
  audio?: 'recorded' | 'declined' | 'unavailable';
  /** Blueprint phase 3: when each page was shown and for how long (interruptions excluded). */
  pageTimes?: Array<{ pageId: string; shownAt: string; ms: number }>;
  /** Times the interviewer left the app or paused the interview. */
  interruptions?: Array<{ kind: 'hidden' | 'paused'; at: string; ms: number }>;
}

export interface DevicePoint {
  lat: number;
  lon: number;
  accuracy: number;
  at: string;
}

/** A photo answer or the interview recording, kept on the device until it is uploaded. */
export interface LocalCapture {
  /** `${clientId}:${ref}` */
  key: string;
  clientId: string;
  surveyId: string;
  ref: string;
  kind: 'photo' | 'audio';
  /** Audio is saved in pieces while recording, so closing the app keeps what was recorded. */
  parts: Blob[];
  type: string;
  state: 'waiting' | 'uploaded' | 'refused';
}

const DB = 'zapx-capi';
const VERSION = 2;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('interviews')) {
        const s = db.createObjectStore('interviews', { keyPath: 'clientId' });
        s.createIndex('state', 'state');
      }
      if (!db.objectStoreNames.contains('captures')) {
        const c = db.createObjectStore('captures', { keyPath: 'key' });
        c.createIndex('clientId', 'clientId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= open());

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const meta = {
  get: <T>(key: string) => run<T | undefined>('meta', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run('meta', 'readwrite', (s) => s.put(value, key)),
  del: (key: string) => run('meta', 'readwrite', (s) => s.delete(key)),
};

export const interviews = {
  all: () => run<LocalInterview[]>('interviews', 'readonly', (s) => s.getAll() as IDBRequest<LocalInterview[]>),
  get: (id: string) =>
    run<LocalInterview | undefined>('interviews', 'readonly', (s) => s.get(id) as IDBRequest<LocalInterview | undefined>),
  put: (i: LocalInterview) => run('interviews', 'readwrite', (s) => s.put(i)),
};

export const captures = {
  of: (clientId: string) =>
    run<LocalCapture[]>('captures', 'readonly', (s) => s.index('clientId').getAll(clientId) as IDBRequest<LocalCapture[]>),
  get: (key: string) => run<LocalCapture | undefined>('captures', 'readonly', (s) => s.get(key) as IDBRequest<LocalCapture | undefined>),
  put: (c: LocalCapture) => run('captures', 'readwrite', (s) => s.put(c)),
  del: (key: string) => run('captures', 'readwrite', (s) => s.delete(key)),
};

/** A random id for this installation (not a hardware identifier). */
export async function deviceId(): Promise<string> {
  const existing = await meta.get<string>('deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  await meta.set('deviceId', id);
  return id;
}
