import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { compare, hash, hashSync } from 'bcryptjs';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import { AUTH_COOKIE, type AuthUser } from './auth.types';
import { issueSession, sessionCookieOptions } from './session';
import { verifySession } from './auth.guard';
import { isCommonPassword } from './password-policy';
import { SsoService } from './sso.service';
import { IntegrationSettingsService } from '../platform/integration-settings.service';
import { ALL_ROLES, CurrentUser, Public, Roles } from './decorators';

const loginSchema = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) });
const registerSchema = z.object({
  organization: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200)
    .refine((p) => !isCommonPassword(p), 'This password is too common. Choose another one.'),
});

/** Used when the email is unknown so that response timing does not reveal which accounts exist. */
const DUMMY_HASH = hashSync('zapx-timing-equalizer', 10);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly sso: SsoService,
    private readonly integrations: IntegrationSettingsService,
  ) {}

  private issue(res: Response, user: { id: string; tenantId: string; role: AuthUser['role']; email: string }) {
    return issueSession(this.jwt, res, user);
  }

  @Public()
  @Throttle({ default: { limit: () => config().LOGIN_RATE_PER_MINUTE, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parseBody(loginSchema, body);
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Compare against a dummy hash when the user does not exist to keep timing uniform.
    const ok = await compare(password, user?.passwordHash ?? DUMMY_HASH);
    // Account lockout (Milestone 20): after LOGIN_MAX_FAILURES wrong passwords in a row the account
    // refuses every password, right or wrong, until the lock ends. This stops password guessing that
    // is spread over many addresses, which the per-address rate limit alone cannot.
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        { message: 'Too many failed sign-ins for this account. Try again later or ask your administrator.', code: 'ACCOUNT_LOCKED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!user || !ok) {
      if (user) await this.recordFailure(user);
      throw new UnauthorizedException('Email or password is incorrect');
    }
    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    if (user.disabledAt) throw new UnauthorizedException('Your account is disabled. Ask your administrator.');
    if (await this.sso.passwordBlocked(user.tenantId, user.role)) {
      throw new ForbiddenException({
        message: 'Your organization signs in with single sign-on. Use "Sign in with SSO".',
        code: 'SSO_REQUIRED',
      });
    }
    const token = await this.issue(res, user);
    await this.audit.record({ ...user, role: user.role }, 'auth.login', 'user', user.id);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, token };
  }

  /** Self-service sign-up creating a new tenant. Disabled unless ALLOW_SIGNUP=true. */
  @Public()
  @Throttle({ default: { limit: () => config().SIGNUP_RATE_PER_MINUTE, ttl: 60_000 } })
  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    if (!config().ALLOW_SIGNUP) throw new ForbiddenException('Sign-up is disabled');
    const input = parseBody(registerSchema, body);
    if (await this.prisma.user.findUnique({ where: { email: input.email } }))
      throw new ForbiddenException('An account with this email already exists');
    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: input.organization, plan: config().DEFAULT_PLAN } });
      return tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email,
          name: input.name,
          role: 'ADMIN',
          passwordHash: await hash(input.password, 10),
        },
      });
    });
    const token = await this.issue(res, user);
    await this.audit.record(user, 'auth.register', 'tenant', user.tenantId);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, token };
  }

  private async recordFailure(user: { id: string; tenantId: string; role: AuthUser['role']; email: string }) {
    const c = config();
    const u = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    if (u.failedLogins < c.LOGIN_MAX_FAILURES) return;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: new Date(Date.now() + c.LOGIN_LOCK_MINUTES * 60_000) },
    });
    await this.audit.record(user, 'auth.locked', 'user', user.id, { minutes: c.LOGIN_LOCK_MINUTES });
  }

  /** Signs this session out on the server too, so a copied token stops working (Milestone 20). */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = bearer ?? (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
    res.clearCookie(AUTH_COOKIE, sessionCookieOptions());
    const p = token ? await verifySession(this.jwt, token) : null;
    if (!p?.jti || !p.exp) return;
    await this.prisma.revokedSession.upsert({
      where: { jti: p.jti },
      create: { jti: p.jti, userId: p.sub, expiresAt: new Date(p.exp * 1000) },
      update: {},
    });
    await this.prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }

  /** Ends every session of the signed-in member on every device (API keys are managed separately). */
  @Post('logout-all')
  @Roles(...ALL_ROLES)
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    if (user.apiKeyId) throw new ForbiddenException('Sign out everywhere needs a signed-in session, not an API key');
    await this.prisma.user.update({ where: { id: user.id }, data: { sessionsRevokedAt: new Date() } });
    res.clearCookie(AUTH_COOKIE, sessionCookieOptions());
    await this.audit.record(user, 'auth.logout_all', 'user', user.id);
  }

  @Get('me')
  @Roles(...ALL_ROLES)
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        projectScope: true,
        tenant: { select: { id: true, name: true, platformOperator: true } },
      },
    });
    const { platformOperator, ...tenant } = u.tenant;
    // With an API key the effective role can be lower than the member's own.
    return {
      ...u,
      tenant,
      role: user.role,
      viaApiKey: user.apiKeyId ?? null,
      // Administrators of the organization that runs the installation manage Settings > Integrations.
      canManageIntegrations:
        user.role === 'ADMIN' && !user.apiKeyId && (platformOperator || (await this.integrations.isOperator(tenant.id))),
    };
  }
}
