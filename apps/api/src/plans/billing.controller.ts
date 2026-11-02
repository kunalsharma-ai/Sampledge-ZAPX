import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { BillingService, StripeSignatureError } from './billing.service';

const checkoutSchema = z.object({ plan: z.enum(['free', 'team', 'business', 'enterprise']) });

/** Billing (Milestone 13): admins buy and manage the plan; Stripe reports subscription changes. */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @Roles('ADMIN')
  summary(@CurrentUser() user: AuthUser) {
    return this.billing.summary(user.tenantId);
  }

  @Post('checkout')
  @Roles('ADMIN')
  @HttpCode(200)
  checkout(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.billing.checkout(user, parseBody(checkoutSchema, body).plan);
  }

  @Post('portal')
  @Roles('ADMIN')
  @HttpCode(200)
  portal(@CurrentUser() user: AuthUser) {
    return this.billing.portal(user);
  }

  /** Stripe webhooks. Authenticated by the Stripe-Signature header over the raw body. */
  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature?: string) {
    try {
      return await this.billing.webhook(req.rawBody, signature);
    } catch (e) {
      if (e instanceof StripeSignatureError) throw new UnauthorizedException(`Invalid Stripe signature: ${e.message}`);
      if (e instanceof SyntaxError) throw new BadRequestException('Not JSON');
      throw e;
    }
  }
}
