/**
 * On-device storage (IndexedDB). Interviews are written after every page, so closing the app,
 * losing power or losing the connection never loses an answer. Nothing here is sent anywhere
 * except by sync, to the ZAPX API this app was loaded from.
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
}

const DB = 'zapx-capi';
const VERSION = 1;

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

/** A random id for this installation (not a hardware identifier). */
export async function deviceId(): Promise<string> {
  const existing = await meta.get<string>('deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  await meta.set('deviceId', id);
  return id;
}
