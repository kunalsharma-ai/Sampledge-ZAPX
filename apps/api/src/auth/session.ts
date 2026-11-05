import type { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { AUTH_COOKIE, type AuthUser } from './auth.types';

export const SESSION_HOURS = 12;
/** Session tokens are HMAC-SHA256 only; a token that names another algorithm (or "none") is refused. */
export const SESSION_ALGORITHMS = ['HS256'] as const;

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: config().COOKIE_SECURE, path: '/' };
}

/** Sign a studio session and set it as the httpOnly cookie. Returns the token for API clients. */
export async function issueSession(
  jwt: JwtService,
  res: Response,
  user: { id: string; tenantId: string; role: AuthUser['role']; email: string },
  /** Make the session count as issued after this moment (used right after signing out other sessions). */
  issuedAfter?: Date,
) {
  // iatMs: issue time in milliseconds, so a session issued in the same second as "sign out other
  // sessions" (password change) is told apart from the ones it signed out.
  const iatMs = Math.max(Date.now(), (issuedAfter?.getTime() ?? 0) + 1);
  const token = await jwt.signAsync(
    { sub: user.id, tid: user.tenantId, role: user.role, email: user.email, iatMs },
    // jti lets one session be signed out on the server (Milestone 20) before it expires.
    { expiresIn: `${SESSION_HOURS}h`, algorithm: 'HS256', jwtid: randomBytes(16).toString('base64url') },
  );
  res.cookie(AUTH_COOKIE, token, { ...sessionCookieOptions(), maxAge: SESSION_HOURS * 3600 * 1000 });
  return token;
}
