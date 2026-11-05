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

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(1_000_000).optional(),
  at: z.string().max(40).optional(),
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
  /** Milestone 12: where the interview started and ended, when the survey records locations. */
  location: z
    .object({
      start: pointSchema.nullable().optional(),
      end: pointSchema.nullable().optional(),
    })
    .optional(),
  /** recorded: the respondent agreed and audio was uploaded; declined; unavailable: no microphone. */
  audio: z.enum(['recorded', 'declined', 'unavailable']).optional(),
  /** Blueprint phase 3: when each page was shown and how long it stayed on screen. */
  pageTimes: z
    .array(
      z.object({
        pageId: z.string().min(1).max(64),
        shownAt: z.string().max(40),
        ms: z
          .number()
          .min(0)
          .max(24 * 3600 * 1000),
      }),
    )
    .max(1000)
    .optional(),
  /** Times the interviewer left the app (hidden) or paused the interview, and for how long. */
  interruptions: z
    .array(
      z.object({
        kind: z.enum(['hidden', 'paused']),
        at: z.string().max(40),
        ms: z
          .number()
          .min(0)
          .max(7 * 24 * 3600 * 1000),
      }),
    )
    .max(500)
    .optional(),
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
