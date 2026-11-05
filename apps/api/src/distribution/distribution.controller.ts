import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { CAN_EDIT, CurrentUser, Public, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { parseBody } from '../common/validation';
import { DistributionService } from './distribution.service';

const importSchema = z.object({ csv: z.string().min(1).max(5_000_000) });
const waveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(20_000),
  sendAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  reminderDays: z.number().int().min(0).max(60).default(0),
  maxReminders: z.number().int().min(0).max(5).default(0),
  reminderSubject: z.string().trim().max(200).optional(),
});

/** Contacts and email invitation waves of a survey. */
@Controller('surveys/:id')
export class DistributionController {
  constructor(private readonly distribution: DistributionService) {}

  @Get('contacts')
  contacts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.distribution.contacts(user, id);
  }

  @Post('contacts/import')
  @Roles(...CAN_EDIT)
  importContacts(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.distribution.importContacts(user, id, parseBody(importSchema, body).csv);
  }

  @Delete('contacts')
  @Roles(...CAN_EDIT)
  deleteContacts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.distribution.deleteContacts(user, id);
  }

  @Get('distributions')
  waves(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.distribution.waves(user, id);
  }

  @Post('distributions')
  @Roles(...CAN_EDIT)
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.distribution.createWave(user, id, parseBody(waveSchema, body));
  }

  @Post('distributions/:waveId/cancel')
  @HttpCode(204)
  @Roles(...CAN_EDIT)
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('waveId') waveId: string) {
    await this.distribution.cancelWave(user, id, waveId);
  }

  @Get('distributions/:waveId/links.csv')
  @Roles(...CAN_EDIT)
  async links(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('waveId') waveId: string, @Res() res: ExpressResponse) {
    const csv = await this.distribution.linksCsv(user, id, waveId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="personal-links-${waveId}.csv"`);
    res.send(csv);
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}button{font:inherit;padding:.6rem 1.2rem}</style></head><body>${body}</body></html>`;

/** One-click unsubscribe from survey invitations (public, by the invitation's random id). */
@Controller('public/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly distribution: DistributionService) {}

  /** A page with a button: link scanners that open the link do not unsubscribe anyone. */
  @Public()
  @Get(':uid')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  form() {
    return page(
      'Unsubscribe',
      '<h1>Stop survey emails?</h1><p>You will not get more invitations or reminders for this survey.</p><form method="post"><button type="submit">Unsubscribe</button></form>',
    );
  }

  /** The button, and one-click unsubscribe from the mail app (List-Unsubscribe-Post). */
  @Public()
  @Post(':uid')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Param('uid') uid: string) {
    const ok = uid.length <= 64 && (await this.distribution.unsubscribe(uid));
    return ok
      ? page('Unsubscribed', '<h1>You are unsubscribed</h1><p>You will not get more emails about this survey.</p>')
      : page('Link not found', '<h1>This link is not valid</h1><p>It may have been mistyped.</p>');
  }
}
