import {
  BadRequestException,
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
import { PasswordResetService, newPasswordSchema } from './password-reset.service';
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

const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: newPasswordSchema });
const forgotSchema = z.object({ email: z.string().email().toLowerCase() });
const resetSchema = z.object({ token: z.string().min(20).max(200), password: newPasswordSchema });

/** Used when the email is unknown so that response timing does not reveal which accounts exist. */
const DUMMY_HASH = hashSync('zapx-timing-equalizer', 10);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly sso: SsoService,
    private readonly resets: PasswordResetService,
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

  /**
   * Change my own password. Needs the current one; signs out my other sessions and keeps this one
   * (a new session cookie is set). Not for API keys or members who must use single sign-on.
   */
  @Post('change-password')
  @Roles(...ALL_ROLES)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    if (user.apiKeyId) throw new ForbiddenException('Changing a password needs a signed-in session, not an API key');
    const input = parseBody(changePasswordSchema, body);
    const member = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (await this.sso.passwordBlocked(member.tenantId, member.role)) {
      throw new ForbiddenException({ message: 'Your organization signs in with single sign-on.', code: 'SSO_REQUIRED' });
    }
    // 400, not 401: a wrong current password must not look like an expired session to the studio.
    if (!(await compare(input.currentPassword, member.passwordHash))) throw new BadRequestException('Your current password is incorrect');
    if (input.currentPassword === input.newPassword) throw new BadRequestException('Choose a password different from the current one');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: member.id },
        data: { passwordHash: await hash(input.newPassword, 10), failedLogins: 0, lockedUntil: null, sessionsRevokedAt: now },
      }),
      this.prisma.passwordReset.updateMany({ where: { userId: member.id, usedAt: null }, data: { usedAt: now } }),
    ]);
    // Every session issued before now is signed out, this one included; the new cookie keeps the member signed in.
    await issueSession(this.jwt, res, member, now);
    await this.audit.record(user, 'auth.password_change', 'user', member.id);
    return { ok: true };
  }

  /**
   * Forgot password: emails a one-time link when email is set up (EMAIL_PROVIDER). Always answers
   * 204, whether or not the account exists, so the form cannot be used to find accounts.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(204)
  async forgot(@Body() body: unknown) {
    const { email } = parseBody(forgotSchema, body);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.disabledAt) return;
    if (await this.sso.passwordBlocked(user.tenantId, user.role)) return;
    if (await this.resets.recentlySent(user.id)) return;
    const link = await this.resets.create(user, null);
    const sent = await this.resets.email({ email: user.email, name: user.name }, link.url, link.expiresAt, false);
    await this.audit.record({ tenantId: user.tenantId, id: user.id }, 'auth.password_reset_requested', 'user', user.id, { emailed: sent });
  }

  /** Whether "forgot password" can send email, so the sign-in page can say what will happen. */
  @Public()
  @Get('password-options')
  passwordOptions() {
    return { forgotPasswordEmail: config().EMAIL_PROVIDER !== 'off' };
  }

  /** Sets a new password from a reset link. Signs out every session; the member then signs in. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body() body: unknown) {
    const input = parseBody(resetSchema, body);
    const user = await this.resets.consume(input.token, input.password);
    await this.audit.record({ tenantId: user.tenantId, id: user.id }, 'auth.password_reset', 'user', user.id);
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
