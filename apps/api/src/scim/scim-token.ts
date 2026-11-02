/** SCIM bearer tokens: scim_<12 hex prefix>_<32 char secret>. Only a SHA-256 hash of the secret is stored. */
import { randomBytes } from 'node:crypto';
import { hashSecret } from '../auth/api-keys';

export function generateScimToken() {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  return { token: `scim_${prefix}_${secret}`, prefix, secretHash: hashSecret(secret) };
}

export function parseScimToken(token: string) {
  const m = /^scim_([0-9a-f]{12})_([A-Za-z0-9_-]{32})$/.exec(token);
  return m ? { prefix: m[1]!, secret: m[2]! } : null;
}
