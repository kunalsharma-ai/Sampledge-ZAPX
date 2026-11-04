import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { parseBody } from '../common/validation';
import { FieldworkService } from './fieldwork.service';

const methodSchema = z.enum(['PHONE', 'VISIT', 'RECORDING']);
const sampleSchema = z.object({
  percent: z.number().min(1).max(100),
  minPerInterviewer: z.number().int().min(0).max(100).default(0),
  method: methodSchema.default('PHONE'),
});
const recordSchema = z.object({
  state: z.enum(['VERIFIED', 'FAILED', 'UNREACHABLE']),
  method: methodSchema.optional(),
  mismatches: z.array(z.string().min(1).max(64)).max(100).default([]),
  note: z.string().max(2000).optional(),
});
const decideSchema = z.object({ decision: z.enum(['uphold', 'overturn']), note: z.string().min(1).max(2000) });
const appealSchema = z.object({ clientId: z.string().uuid(), message: z.string().trim().min(5).max(2000) });
const stateSchema = z.enum(['PENDING', 'VERIFIED', 'FAILED', 'UNREACHABLE']).optional();

/** Supervisor tools in the studio: back-checks, the dashboard and appeals. */
@Controller('surveys/:id')
export class FieldworkController {
  constructor(private readonly fieldwork: FieldworkService) {}

  @Get('supervisor')
  supervisor(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fieldwork.supervisor(user, id);
  }

  @Get('backchecks')
  backChecks(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('state') state?: string) {
    return this.fieldwork.backChecks(user, id, parseBody(stateSchema, state?.toUpperCase() || undefined));
  }

  @Post('backchecks/sample')
  @Roles(...CAN_EDIT)
  sample(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.fieldwork.sample(user, id, parseBody(sampleSchema, body));
  }

  @Put('backchecks/:checkId')
  @Roles(...CAN_EDIT)
  record(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('checkId') checkId: string, @Body() body: unknown) {
    return this.fieldwork.recordBackCheck(user, id, checkId, parseBody(recordSchema, body));
  }

  @Get('appeals')
  appeals(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.fieldwork.appeals(user, id);
  }

  @Put('appeals/:appealId')
  @Roles(...CAN_EDIT)
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('appealId') appealId: string, @Body() body: unknown) {
    const input = parseBody(decideSchema, body);
    return this.fieldwork.decideAppeal(user, id, appealId, input.decision, input.note);
  }
}

/** Appeals from the interviewer app. */
@Controller('capi')
@Roles('INTERVIEWER')
export class CapiAppealsController {
  constructor(private readonly fieldwork: FieldworkService) {}

  @Get('interviews')
  mine(@CurrentUser() user: AuthUser) {
    return this.fieldwork.myInterviews(user);
  }

  @Post('appeals')
  appeal(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseBody(appealSchema, body);
    return this.fieldwork.appeal(user, input.clientId, input.message);
  }
}
