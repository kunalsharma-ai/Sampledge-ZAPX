import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { IntegrationSettingsService } from './integration-settings.service';

const values = z.record(z.string().max(64), z.string().max(20_000).optional());
const saveSchema = z.object({ enabled: z.boolean(), values: values.default({}), clear: z.array(z.string().max(64)).max(20).optional() });
const testSchema = z.object({ values: values.default({}) });

/**
 * Platform integrations (Settings > Integrations): administrators of the organization that runs the
 * installation set the keys for Claude, IPinfo, Deepgram, Twilio, Stripe and S3 here.
 */
@Controller('platform/integrations')
@Roles('ADMIN')
export class PlatformIntegrationsController {
  constructor(private readonly settings: IntegrationSettingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.settings.list(user);
  }

  @Put(':key')
  save(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() body: unknown) {
    return this.settings.save(user, key, parseBody(saveSchema, body));
  }

  @Post(':key/test')
  @HttpCode(200)
  test(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() body: unknown) {
    return this.settings.test(user, key, parseBody(testSchema, body ?? {}).values);
  }

  @Delete(':key')
  reset(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.settings.reset(user, key);
  }
}
