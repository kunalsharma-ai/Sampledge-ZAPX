import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service';
import { parseApiKey, secretMatches } from './api-keys';
import { API_KEY_PREFIX, AUTH_COOKIE, CLIENT_HEADER, CSRF_HEADER, lowerRole, type AuthUser, type RoleName } from './auth.types';
import { IS_PUBLIC, ROLES } from './decorators';
import { SESSION_ALGORITHMS } from './session';
import { PlanCatalogService } from '../super-admin/plan-catalog.service';
import { featureForRoute, resolveEntitlements, type Entitlements } from '../super-admin/features';

/** lastSeenAt is written at most this often per member. */
const LAST_SEEN_GRANULARITY_MS = 60_000;

/** Routes a suspended organization, or a member without mobile access, can still reach. */
const ALWAYS_OPEN = new Set(['auth/me', 'auth/logout', 'auth/logout-all', 'me/entitlements', 'me/entitlements/stream', 'features']);

/** What the guard reads about the member and their organization on every request. */
const MEMBER_SELECT = {
  id: true,
  tenantId: true,
  role: true,
  email: true,
  projectScope: true,
  disabledAt: true,
  superAdmin: true,
  featureOverrides: true,
  mobileAccess: true,
  lastSeenAt: true,
  lastClient: true,
  tenant: { select: { plan: true, suspendedAt: true, featureOverrides: true } },
} as const;

interface MemberRow {
  id: string;
  tenantId: string;
  role: RoleName;
  email: string;
  projectScope: AuthUser['projectScope'];
  superAdmin: boolean;
  featureOverrides: unknown;
  mobileAccess: boolean;
  lastSeenAt: Date | null;
  lastClient: string | null;
  tenant: { plan: string; suspendedAt: Date | null; featureOverrides: unknown };
}

export class FeatureDisabledError extends ForbiddenException {
  constructor(feature: string) {
    super({ message: 'This feature is not included in your subscription. Ask your administrator.', code: 'FEATURE_DISABLED', feature });
  }
}

export type RequestWithUser = Request & { user?: AuthUser; entitlements?: Entitlements };

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
    private readonly plans: PlanCatalogService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const cookie = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
    const token = bearer ?? cookie;
    if (!token) throw new UnauthorizedException('Not signed in');

    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('Missing CSRF header');
    }

    const client = req.headers[CLIENT_HEADER] === 'mobile' ? 'mobile' : 'web';
    const viaKey = bearer?.startsWith(API_KEY_PREFIX);
    const { user, member } = viaKey ? await this.fromApiKey(bearer!) : await this.fromSession(token);
    req.user = { ...user, client };
    this.gate(req, member, client, ctx.getClass().name);

    const roles = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES, targets);
    // Interviewers are deny-by-default: they reach only endpoints that list them explicitly
    // (the CAPI app API), never the studio's projects, surveys, data or settings.
    if (req.user.role === 'INTERVIEWER' && !roles?.includes('INTERVIEWER')) throw new ForbiddenException('Your role cannot do this');
    if (roles && !roles.includes(req.user.role)) throw new ForbiddenException('Your role cannot do this');
    return true;
  }

  /**
   * Super admin control (super-admin/features.ts): a suspended organization reaches nothing, the
   * mobile app needs mobile access, the super admin console needs a signed-in super admin, and
   * every other route needs the feature it belongs to for the client that called.
   */
  private gate(req: RequestWithUser, member: MemberRow, client: 'web' | 'mobile', controller: string) {
    const path = (req.route?.path ?? req.path ?? '').replace(/^\/?api\//, '').replace(/\/$/, '');
    const ent = resolveEntitlements({ surface: client, plan: this.plans.get(member.tenant.plan), tenant: member.tenant, user: member });
    req.entitlements = ent;
    this.touch(member, client);
    if (path === 'super' || path.startsWith('super/') || controller === 'SuperAdminController') {
      if (!req.user?.superAdmin) throw new ForbiddenException({ message: 'Only the super admin can do this', code: 'SUPER_ADMIN_ONLY' });
      return;
    }
    if (ALWAYS_OPEN.has(path)) return;
    if (ent.suspended)
      throw new ForbiddenException({ message: 'Your organization is suspended. Contact the ZAPX administrator.', code: 'ORG_SUSPENDED' });
    if (!ent.surfaceAllowed)
      throw new ForbiddenException({ message: 'The mobile app is not enabled for your account.', code: 'MOBILE_DISABLED' });
    const feature = featureForRoute(req.method, path);
    if (feature && !ent.features[feature]) throw new FeatureDisabledError(feature);
  }

  /** Remember when the member was last active (shown to the super admin), at most once a minute. */
  private touch(member: MemberRow, client: 'web' | 'mobile') {
    const stale = !member.lastSeenAt || Date.now() - member.lastSeenAt.getTime() > LAST_SEEN_GRANULARITY_MS;
    if (!stale && member.lastClient === client) return;
    void this.prisma.user.update({ where: { id: member.id }, data: { lastSeenAt: new Date(), lastClient: client } }).catch(() => undefined);
  }

  private async fromSession(token: string): Promise<{ user: AuthUser; member: MemberRow }> {
    const payload = await verifySession(this.jwt, token);
    if (!payload) throw new UnauthorizedException('Session expired');
    const u = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { ...MEMBER_SELECT, sessionsRevokedAt: true },
    });
    if (!u || u.tenantId !== payload.tid) throw new UnauthorizedException('Session expired');
    if (u.disabledAt) throw new UnauthorizedException('Your account is disabled');
    // Signed out on the server (Milestone 20): "sign out everywhere", or this one session signed out.
    if (u.sessionsRevokedAt && issuedAtMs(payload) <= u.sessionsRevokedAt.getTime()) throw new UnauthorizedException('Session expired');
    if (payload.jti && (await this.prisma.revokedSession.findUnique({ where: { jti: payload.jti }, select: { jti: true } })))
      throw new UnauthorizedException('Session expired');
    const member = u as MemberRow;
    return {
      member,
      user: { id: u.id, tenantId: u.tenantId, role: u.role, email: u.email, projectScope: u.projectScope, superAdmin: u.superAdmin },
    };
  }

  private async fromApiKey(token: string): Promise<{ user: AuthUser; member: MemberRow }> {
    const parsed = parseApiKey(token);
    const key = parsed
      ? await this.prisma.apiKey.findUnique({
          where: { prefix: parsed.prefix },
          include: { createdBy: { select: MEMBER_SELECT } },
        })
      : null;
    if (!parsed || !key || !secretMatches(parsed.secret, key.secretHash)) throw new UnauthorizedException('Invalid API key');
    if (key.revokedAt) throw new UnauthorizedException('This API key was revoked');
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('This API key has expired');
    const { disabledAt, ...creator } = key.createdBy;
    const member = { ...creator, superAdmin: false } as MemberRow;
    // A key never outranks the member who made it, and stops working for interviewers and disabled members.
    if (creator.tenantId !== key.tenantId || creator.role === 'INTERVIEWER') throw new UnauthorizedException('Invalid API key');
    if (disabledAt) throw new UnauthorizedException('The member who created this API key is disabled');
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    // An API key never carries super admin rights, and is bound by its organization's features.
    const user: AuthUser = {
      id: creator.id,
      tenantId: creator.tenantId,
      email: creator.email,
      projectScope: creator.projectScope,
      role: lowerRole(key.role, creator.role),
      apiKeyId: key.id,
      superAdmin: false,
    };
    return { user, member };
  }
}

export interface SessionPayload {
  sub: string;
  tid: string;
  iat?: number;
  /** Issue time in milliseconds (sessions issued since the password-reset fix); iat has whole seconds only. */
  iatMs?: number;
  exp?: number;
  jti?: string;
}

/** When the session was issued, in milliseconds: iatMs when present, else iat (seconds). */
export const issuedAtMs = (p: SessionPayload) => (typeof p.iatMs === 'number' ? p.iatMs : (p.iat ?? 0) * 1000);

/** The payload of a valid, unexpired session token signed with HS256, or null. */
export async function verifySession(jwt: JwtService, token: string): Promise<SessionPayload | null> {
  try {
    const p = await jwt.verifyAsync<SessionPayload>(token, { algorithms: [...SESSION_ALGORITHMS] });
    return typeof p.sub === 'string' && typeof p.tid === 'string' ? p : null;
  } catch {
    return null;
  }
}
