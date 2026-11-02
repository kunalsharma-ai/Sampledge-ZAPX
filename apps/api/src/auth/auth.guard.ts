import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AUTH_COOKIE, CSRF_HEADER, type AuthUser, type RoleName } from './auth.types';
import { IS_PUBLIC, ROLES } from './decorators';

/**
 * Global guard: every endpoint requires a valid session unless marked @Public().
 * Accepts the httpOnly session cookie (studio) or a Bearer token (API clients).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
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

    let payload: { sub: string; tid: string; role: RoleName; email: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    req.user = { id: payload.sub, tenantId: payload.tid, role: payload.role, email: payload.email };

    const roles = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(req.user.role)) throw new ForbiddenException('Your role cannot do this');
    return true;
  }
}
