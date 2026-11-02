import { Body, Controller, Get, HttpCode, Post, Put, Query, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { parseBody } from '../common/validation';
import type { AuthUser } from './auth.types';
import { CurrentUser, Public, Roles } from './decorators';
import { issueSession } from './session';
import { SsoError, SsoService } from './sso.service';
import { SamlService } from './saml.service';

const SSO_COOKIE = 'zapx_sso';
const SSO_COOKIE_PATH = '/api/auth/sso';

const startSchema = z.object({ email: z.string().email().toLowerCase(), next: z.string().max(500).optional() });
const configSchema = z.object({
  enabled: z.boolean(),
  protocol: z.enum(['OIDC', 'SAML']).default('OIDC'),
  issuer: z.union([z.string().url().max(500), z.literal('')]).default(''),
  clientId: z.string().max(300).default(''),
  clientSecret: z.string().min(1).max(2000).optional(),
  domains: z
    .array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Enter domains like example.com'))
    .min(1)
    .max(20),
  enforced: z.boolean().default(false),
  jitRole: z.enum(['PROGRAMMER', 'VIEWER', 'INTERVIEWER']).nullable().default(null),
  samlEntryPoint: z.string().url().max(1000).nullable().optional(),
  samlIdpIssuer: z.string().min(1).max(500).nullable().optional(),
  samlCerts: z.array(z.string().min(100).max(10_000)).max(3).optional(),
});

/** OpenID Connect single sign-on: the login flow (public) and the organization's settings (admins). */
@Controller()
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly jwt: JwtService,
    private readonly saml: SamlService,
  ) {}

  /** Step 1: the person typed their work email. Answers with the provider URL to send the browser to. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('auth/sso/start')
  @HttpCode(200)
  async start(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, next } = parseBody(startSchema, body);
    const { url, cookie, maxAgeMs } = await this.sso.begin(email, next);
    // OpenID Connect keeps its state in a cookie; SAML keeps the request on the server (see SamlService).
    if (cookie)
      res.cookie(SSO_COOKIE, cookie, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config().COOKIE_SECURE,
        maxAge: maxAgeMs,
        path: SSO_COOKIE_PATH,
      });
    return { url };
  }

  /** SAML service provider metadata (Milestone 13): import it in the identity provider. */
  @Public()
  @Get('auth/sso/saml/metadata')
  metadata(@Res() res: Response) {
    res.type('application/samlmetadata+xml').send(this.saml.metadata());
  }

  /** SAML Assertion Consumer Service: the identity provider posts the response here. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('auth/sso/saml/acs')
  async acs(@Body() body: Record<string, unknown>, @Res() res: Response) {
    try {
      const { user, next } = await this.sso.completeSaml(body ?? {});
      await issueSession(this.jwt, res, user);
      // A 303 turns the IdP's POST into a GET on the studio page.
      res.redirect(303, next);
    } catch (e) {
      const message =
        e instanceof SsoError || (e as { status?: number }).status ? (e as Error).message : 'Single sign-on failed. Try again.';
      res.redirect(303, `/login?sso_error=${encodeURIComponent(message)}`);
    }
  }

  /** Step 2: the provider sends the browser back here with a code. Ends on a studio page either way. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('auth/sso/callback')
  async callback(@Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[SSO_COOKIE];
    res.clearCookie(SSO_COOKIE, { path: SSO_COOKIE_PATH });
    try {
      const { user, next } = await this.sso.complete(query, cookie);
      await issueSession(this.jwt, res, user);
      res.redirect(302, next);
    } catch (e) {
      const message =
        e instanceof SsoError || (e as { status?: number }).status ? (e as Error).message : 'Single sign-on failed. Try again.';
      res.redirect(302, `/login?sso_error=${encodeURIComponent(message)}`);
    }
  }

  @Get('sso')
  @Roles('ADMIN')
  get(@CurrentUser() user: AuthUser) {
    return this.sso.getConfig(user.tenantId);
  }

  @Put('sso')
  @Roles('ADMIN')
  save(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.sso.saveConfig(user, parseBody(configSchema, body));
  }
}
