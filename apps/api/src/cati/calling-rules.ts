/**
 * Calling rules (Milestone 18): calling hours in the respondent's local time, and the
 * organization's do-not-call list. Both apply in the queue, so an interviewer is never offered a
 * case they must not call.
 */
import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

/** True when the runtime (and so Postgres, which uses the same IANA database) knows the zone. */
export function isTimeZone(tz: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Keyed hash of a normalized phone number, per organization. Derived from SECRETS_KEY (like the sealed numbers). */
export function phoneHash(tenantId: string, phone: string): string {
  const c = config();
  const key = createHash('sha256')
    .update(`zapx-phone-hash:${c.SECRETS_KEY ?? c.JWT_SECRET}`)
    .digest();
  return createHmac('sha256', key).update(`${tenantId}:${phone}`).digest('hex').slice(0, 40);
}

export interface CallingHours {
  timeZone: string;
  callFrom: number;
  callUntil: number;
  days: number[];
}

/** Whether `at` falls inside the calling hours, in `timeZone` (the case's, else the survey's). */
export function withinHours(h: CallingHours, at: Date, timeZone = h.timeZone): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  return h.days.includes(day) && minute >= h.callFrom && minute < h.callUntil;
}

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
