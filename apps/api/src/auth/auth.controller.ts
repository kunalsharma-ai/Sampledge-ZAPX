import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { compare, hash, hashSync } from 'bcryptjs';
import type { Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import { AUTH_COOKIE, type AuthUser } from './auth.types';
import { ALL_ROLES, CurrentUser, Public, Roles } from './decorators';

const loginSchema = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) });
const registerSchema = z.object({
  organization: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});

const SESSION_HOURS = 12;
/** Used when the email is unknown so that response timing does not reveal which accounts exist. */
const DUMMY_HASH = hashSync('zapx-timing-equalizer', 10);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  private async issue(res: Response, user: { id: string; tenantId: string; role: AuthUser['role']; email: string }) {
    const token = await this.jwt.signAsync(
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

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parseBody(loginSchema, body);
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Compare against a dummy hash when the user does not exist to keep timing uniform.
    const ok = await compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Email or password is incorrect');
    const token = await this.issue(res, user);
    await this.audit.record({ ...user, role: user.role }, 'auth.login', 'user', user.id);
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, token };
  }

  /** Self-service sign-up creating a new tenant. Disabled unless ALLOW_SIGNUP=true. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    if (!config().ALLOW_SIGNUP) throw new ForbiddenException('Sign-up is disabled');
    const input = parseBody(registerSchema, body);
    if (await this.prisma.user.findUnique({ where: { email: input.email } }))
      throw new ForbiddenException('An account with this email already exists');
    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: input.organization } });
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

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
  }

  @Get('me')
  @Roles(...ALL_ROLES)
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, email: true, name: true, role: true, projectScope: true, tenant: { select: { id: true, name: true } } },
    });
    // With an API key the effective role can be lower than the member's own.
    return { ...u, role: user.role, viaApiKey: user.apiKeyId ?? null };
  }
}
