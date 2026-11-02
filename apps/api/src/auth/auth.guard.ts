import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service';
import { parseApiKey, secretMatches } from './api-keys';
import { API_KEY_PREFIX, AUTH_COOKIE, CSRF_HEADER, lowerRole, type AuthUser, type RoleName } from './auth.types';
import { IS_PUBLIC, ROLES } from './decorators';

/** lastUsedAt is written at most this often per key, so busy integrations do not write on every call. */
const LAST_USED_GRANULARITY_MS = 60_000;

/**
 * Global guard: every endpoint requires a valid session unless marked @Public().
 * Accepts the httpOnly session cookie (studio), a Bearer session token, or a Bearer
 * organization API key (zapx_<prefix>_<secret>).
 *
 * The member is read from the database on every request, so a role or project-scope change
 * applies at once instead of when the session token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const cookie = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
    const token = bearer ?? cookie;
    if (!token) throw new UnauthorizedException('Not signed in');

    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('Missing CSRF header');
    }

    req.user = bearer?.startsWith(API_KEY_PREFIX) ? await this.fromApiKey(bearer) : await this.fromSession(token);

    const roles = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES, targets);
    // Interviewers are deny-by-default: they reach only endpoints that list them explicitly
    // (the CAPI app API), never the studio's projects, surveys, data or settings.
    if (req.user.role === 'INTERVIEWER' && !roles?.includes('INTERVIEWER')) throw new ForbiddenException('Your role cannot do this');
    if (roles && !roles.includes(req.user.role)) throw new ForbiddenException('Your role cannot do this');
    return true;
  }

  private async fromSession(token: string): Promise<AuthUser> {
    let payload: { sub: string; tid: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    const u = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, tenantId: true, role: true, email: true, projectScope: true },
    });
    if (!u || u.tenantId !== payload.tid) throw new UnauthorizedException('Session expired');
    return u;
  }

  private async fromApiKey(token: string): Promise<AuthUser> {
    const parsed = parseApiKey(token);
    const key = parsed
      ? await this.prisma.apiKey.findUnique({
          where: { prefix: parsed.prefix },
          include: { createdBy: { select: { id: true, tenantId: true, role: true, email: true, projectScope: true } } },
        })
      : null;
    if (!parsed || !key || !secretMatches(parsed.secret, key.secretHash)) throw new UnauthorizedException('Invalid API key');
    if (key.revokedAt) throw new UnauthorizedException('This API key was revoked');
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('This API key has expired');
    const creator = key.createdBy;
    // A key never outranks the member who made it, and stops working for interviewers.
    if (creator.tenantId !== key.tenantId || creator.role === 'INTERVIEWER') throw new UnauthorizedException('Invalid API key');
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { ...creator, role: lowerRole(key.role, creator.role), apiKeyId: key.id };
  }
}
