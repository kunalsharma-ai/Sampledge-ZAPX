import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { parseBody } from '../common/validation';
import { CapiService } from './capi.service';

const assignSchema = z.object({
  interviewerId: z.string().min(1).max(64),
  target: z.number().int().min(1).max(100000).nullable().optional(),
});

const interviewSchema = z.object({
  clientId: z.string().uuid(),
  surveyId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(64),
  answers: z.record(z.string().max(64), z.unknown()).refine((a) => Object.keys(a).length <= 500, 'Too many answers'),
  startedAt: z.string().max(40),
  finishedAt: z.string().max(40),
  durationMs: z
    .number()
    .min(0)
    .max(7 * 24 * 3600 * 1000),
  language: z.string().max(35).optional(),
  endedEarly: z.boolean().optional(),
});

const syncSchema = z.object({
  deviceId: z.string().uuid(),
  interviews: z.array(interviewSchema).min(1).max(100),
});

/** Interviewer assignments, managed in the studio. */
@Controller('surveys/:id/capi')
export class CapiAssignmentsController {
  constructor(private readonly capi: CapiService) {}

  @Get('assignments')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.capi.assignments(user, id);
  }

  @Post('assignments')
  @Roles(...CAN_EDIT)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(assignSchema, body);
    return this.capi.assign(user, id, input.interviewerId, input.target ?? null);
  }

  @Delete('assignments/:assignmentId')
  @HttpCode(204)
  @Roles(...CAN_EDIT)
  async unassign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('assignmentId') assignmentId: string) {
    await this.capi.unassign(user, id, assignmentId);
  }
}

/** The offline interviewer app's API. Interviewers only. */
@Controller('capi')
@Roles('INTERVIEWER')
export class CapiAppController {
  constructor(private readonly capi: CapiService) {}

  @Get('package')
  package(@CurrentUser() user: AuthUser) {
    return this.capi.package(user);
  }

  @Post('sync')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async sync(@CurrentUser() user: AuthUser, @Body() body: unknown, @Headers('user-agent') userAgent?: string) {
    const input = parseBody(syncSchema, body);
    return { results: await this.capi.sync(user, input.deviceId, input.interviews, userAgent) };
  }
}
