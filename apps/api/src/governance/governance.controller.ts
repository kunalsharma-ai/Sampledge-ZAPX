import { Body, Controller, Get, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { GovernanceService } from './governance.service';

/** Blueprint phase 5: data residency and retention (administrators). */
@Controller('organization/governance')
@Roles('ADMIN')
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.governance.get(user.tenantId);
  }

  @Put()
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.governance.update(user, body);
  }
}
