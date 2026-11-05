import { hkdfSync } from 'node:crypto';
import { config } from '../config';

/**
 * Keys for HMACs that are not session tokens (security review S5). Each purpose gets its own key,
 * derived with HKDF from SIGNING_KEYS_SECRET, so rotating JWT_SECRET after a leak only signs people
 * out: shared test links keep working and network/device hashes stay comparable for duplicate checks.
 *
 * Without SIGNING_KEYS_SECRET (development; production requires it) the keys are derived from
 * JWT_SECRET exactly as before, so nothing changes for an existing installation until it is set.
 * Setting it for the first time is a one-off change: old test links stop working and duplicate checks
 * start comparing against new hashes (see docs/handbook/DEPLOYMENT.md, "Rotating secrets").
 */
export type SigningPurpose = 'test-link' | 'network-hash' | 'device-hash' | 'sso-state';

const cache = new Map<string, Buffer>();

export function signingKey<T extends Buffer | string>(purpose: SigningPurpose, legacy: (jwtSecret: string) => T): T | Buffer {
  const c = config();
  if (!c.SIGNING_KEYS_SECRET) return legacy(c.JWT_SECRET);
  const id = `${c.SIGNING_KEYS_SECRET}\u0000${purpose}`;
  let key = cache.get(id);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', c.SIGNING_KEYS_SECRET, 'zapx-signing-keys', `zapx:${purpose}`, 32));
    cache.set(id, key);
  }
  return key;
}
