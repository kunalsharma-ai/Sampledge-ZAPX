/** Organization API key format and hashing. The secret part is never stored. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { API_KEY_PREFIX } from './auth.types';

export interface ParsedKey {
  prefix: string;
  secret: string;
}

export function generateApiKey(): { key: string; prefix: string; secretHash: string } {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  return { key: `${API_KEY_PREFIX}${prefix}_${secret}`, prefix, secretHash: hashSecret(secret) };
}

export function parseApiKey(token: string): ParsedKey | null {
  const m = /^zapx_([0-9a-f]{12})_([A-Za-z0-9_-]{32})$/.exec(token);
  return m ? { prefix: m[1]!, secret: m[2]! } : null;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
