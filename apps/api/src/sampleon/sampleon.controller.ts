/** SAMPLEON integration endpoints (see sampleon.service.ts). */
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Public, Roles } from '../auth/decorators';
import { SampleonService } from './sampleon.service';

@Controller()
export class SampleonController {
  constructor(private readonly sampleon: SampleonService) {}

  /** Audience requests for this survey, and the launch URL SAMPLEON (or PROJEXA) should use. */
  @Get('surveys/:id/sampleon')
  overview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sampleon.overview(user, id);
  }

  /**
   * Make the survey ready to receive SAMPLEON respondents (creates the project's SAMPLEON vendor)
   * and return the launch URL. Used for PROJEXA-linked surveys, where PROJEXA sends the request.
   */
  @Post('surveys/:id/sampleon/connect')
  @Roles(...CAN_EDIT)
  connect(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sampleon.connect(user, id);
  }

  /** Ask SAMPLEON for an audience for an independent ZAPX survey. */
  @Post('surveys/:id/sampleon/audience-requests')
  @Roles(...CAN_EDIT)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.sampleon.submit(user, id, body);
  }

  /** SAMPLEON's signed event webhook. */
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post('v1/sampleon/events')
  @HttpCode(200)
  events(@Req() req: Request & { rawBody?: Buffer }) {
    return this.sampleon.receive(req);
  }
}
