import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { METRICS, OPS, TRIGGERS } from './automation-rules';
import { AutomationService } from './automation.service';

/** Blueprint phase 5: automation rules, their runs and approvals. */
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('vocabulary')
  vocabulary() {
    return { triggers: TRIGGERS, metrics: METRICS, ops: OPS };
  }

  /** Surveys a rule can watch (the member's own access). */
  @Get('surveys')
  surveys(@CurrentUser() user: AuthUser) {
    return this.automation.surveys(user);
  }

  @Get('rules')
  list(@CurrentUser() user: AuthUser, @Query('surveyId') surveyId?: string) {
    return this.automation.list(user, surveyId);
  }

  @Post('rules')
  @Roles(...CAN_EDIT)
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.automation.create(user, body);
  }

  @Patch('rules/:id')
  @Roles(...CAN_EDIT)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.automation.update(user, id, body);
  }

  @Delete('rules/:id')
  @Roles(...CAN_EDIT)
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.automation.remove(user, id);
  }

  @Post('rules/:id/dry-run')
  @Roles(...CAN_EDIT)
  @HttpCode(200)
  dryRun(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { event?: Record<string, unknown> }) {
    return this.automation.dryRun(user, id, body?.event && typeof body.event === 'object' ? body.event : {});
  }

  @Get('runs')
  runs(@CurrentUser() user: AuthUser, @Query('ruleId') ruleId?: string, @Query('state') state?: string) {
    return this.automation.runs(user, { ruleId, state });
  }

  /** Approvals are for administrators only. */
  @Post('runs/:id/approve')
  @Roles('ADMIN')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.decide(user, id, 'approve');
  }

  @Post('runs/:id/reject')
  @Roles('ADMIN')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.decide(user, id, 'reject');
  }
}

/** In-app notifications of the signed-in member. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.automation.notifications(user);
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.automation.markRead(user);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.automation.markRead(user, id);
  }
}
