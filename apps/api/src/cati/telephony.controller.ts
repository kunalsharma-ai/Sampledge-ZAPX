import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Public, Roles } from '../auth/decorators';
import { TelephonyService } from './telephony.service';

const CALLERS = ['ADMIN', 'PROGRAMMER', 'INTERVIEWER'] as const;
const phoneSchema = z.object({ phone: z.string().max(40).nullable() });
const dialerSchema = z.object({
  enabled: z.boolean(),
  recordCalls: z.boolean(),
  recordingNotice: z.string().max(300).optional(),
});

/** The phone dialer (Milestone 19): settings, calls, and the Twilio webhooks. */
@Controller()
export class TelephonyController {
  constructor(private readonly telephony: TelephonyService) {}

  @Get('cati/me')
  @Roles(...CALLERS)
  me(@CurrentUser() user: AuthUser) {
    return this.telephony.me(user);
  }

  @Put('cati/me/phone')
  @Roles(...CALLERS)
  setPhone(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.telephony.setMyPhone(user, parseBody(phoneSchema, body).phone);
  }

  @Get('surveys/:id/cati/dialer')
  @Roles('ADMIN', 'PROGRAMMER', 'VIEWER')
  dialer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.telephony.dialer(user, id);
  }

  @Put('surveys/:id/cati/dialer')
  @Roles(...CAN_EDIT)
  setDialer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.telephony.setDialer(user, id, parseBody(dialerSchema, body));
  }

  @Post('cati/cases/:id/dial')
  @Roles(...CALLERS)
  @HttpCode(200)
  dial(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.telephony.dial(user, id);
  }

  @Get('cati/cases/:id/dial')
  @Roles(...CALLERS)
  async latest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { dial: await this.telephony.latest(user, id) };
  }

  @Post('cati/dials/:id/hangup')
  @Roles(...CALLERS)
  @HttpCode(200)
  hangUp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.telephony.hangUp(user, id);
  }

  // ---- Twilio webhooks: authenticated by X-Twilio-Signature, not by a session ----

  private verified(req: Request) {
    const params = (req.body ?? {}) as Record<string, unknown>;
    const path = req.originalUrl.replace(/^\/api(?=\/)/, '');
    const sig = req.headers['x-twilio-signature'];
    if (!this.telephony.verifyTwilio(path, params, typeof sig === 'string' ? sig : undefined))
      throw new ForbiddenException('Invalid Twilio signature');
    return params;
  }

  @Public()
  @SkipThrottle()
  @Post('telephony/twilio/answer')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  answer(@Req() req: Request, @Query('d') d: string) {
    this.verified(req);
    return this.telephony.onAnswer(d);
  }

  @Public()
  @SkipThrottle()
  @Post('telephony/twilio/notice')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  notice(@Req() req: Request, @Query('d') d: string) {
    this.verified(req);
    return this.telephony.onNotice(d);
  }

  @Public()
  @SkipThrottle()
  @Post('telephony/twilio/bridged')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  bridged(@Req() req: Request, @Query('d') d: string) {
    return this.telephony.onBridged(d, this.verified(req));
  }

  @Public()
  @SkipThrottle()
  @Post('telephony/twilio/status')
  @HttpCode(204)
  status(@Req() req: Request, @Query('d') d: string) {
    return this.telephony.onStatus(d, this.verified(req));
  }

  @Public()
  @SkipThrottle()
  @Post('telephony/twilio/recording')
  @HttpCode(204)
  recording(@Req() req: Request, @Query('d') d: string) {
    return this.telephony.onRecording(d, this.verified(req));
  }
}
