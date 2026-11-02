import type { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { config } from '../config';
import { AUTH_COOKIE, type AuthUser } from './auth.types';

export const SESSION_HOURS = 12;

/** Sign a studio session and set it as the httpOnly cookie. Returns the token for API clients. */
export async function issueSession(
  jwt: JwtService,
  res: Response,
  user: { id: string; tenantId: string; role: AuthUser['role']; email: string },
) {
  const token = await jwt.signAsync(
    { sub: user.id, tid: user.tenantId, role: user.role, email: user.email },
    { expiresIn: `${SESSION_HOURS}h` },
  );
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config().COOKIE_SECURE,
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: '/',
  });
  return token;
}
