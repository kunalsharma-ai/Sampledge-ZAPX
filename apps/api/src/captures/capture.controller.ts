import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import type { UploadedFile } from '../imports/documents';
import { parseBody } from '../common/validation';
import { isFirstRead, sendBytes } from '../common/send-bytes';
import { config } from '../config';
import { InterviewService } from '../interview/interview.service';
import { CaptureService, PHOTO_MAX_MB } from './capture.service';
import { JobsService, presentJob } from '../jobs/jobs.service';
import { TranscriptionService } from './transcription.service';

const maxBytes = () => Math.max(PHOTO_MAX_MB, config().CAPTURE_MAX_MB) * 1024 * 1024;

const deviceUploadSchema = z.object({
  clientId: z.string().uuid(),
  surveyId: z.string().min(1).max(64),
  ref: z.string().min(1).max(64),
  kind: z.enum(['photo', 'audio']),
});

/** Photos and interview recordings (Milestone 12). */
const transcribeSchema = z.object({
  captureIds: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{10,64}$/))
    .max(200)
    .optional(),
});

@Controller()
export class CaptureController {
  constructor(
    private readonly captures: CaptureService,
    private readonly interview: InterviewService,
    private readonly jobs: JobsService,
    private readonly transcription: TranscriptionService,
  ) {}

  /** A respondent's photo answer. Access is by the interview's session token, like every respondent call. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/r/:token/captures')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PHOTO_MAX_MB * 1024 * 1024, files: 1, fields: 3 } }))
  respondentPhoto(@Param('token') token: string, @Body() body: { questionId?: unknown }, @UploadedFileParam() file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach a photo');
    if (typeof body?.questionId !== 'string') throw new BadRequestException('questionId is required');
    return this.interview.uploadPhoto(token, body.questionId, file.buffer);
  }

  /** The interviewer app uploads photos and recordings before the interview itself syncs. */
  @Roles('INTERVIEWER')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('capi/captures')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxBytes(), files: 1, fields: 6 } }))
  device(@CurrentUser() user: AuthUser, @Body() body: unknown, @UploadedFileParam() file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach the file');
    return this.captures.uploadFromDevice(user, parseBody(deviceUploadSchema, body), file.buffer);
  }

  /** Open a photo or recording. Private: never cached by shared caches, never embedded by other sites. */
  @SkipThrottle()
  @Get('captures/:id')
  async open(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { meta, data } = await this.captures.open(user, id, isFirstRead(req));
    res.setHeader('Content-Type', meta.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    sendBytes(req, res, data);
  }

  @Get('surveys/:id/captures')
  summary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.captures.countOf(user, id);
  }

  /**
   * Transcribe recordings in the background (Milestone 17): the ones named, or every recording of
   * the survey that has no transcript yet. Each recording is sent to the transcription provider.
   */
  @Roles('ADMIN', 'PROGRAMMER')
  @Post('surveys/:id/captures/transcribe')
  @HttpCode(202)
  async transcribe(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    if (!this.transcription.current()) throw new BadRequestException('Transcription is not turned on for this installation.');
    const input = parseBody(transcribeSchema, body ?? {});
    const job = await this.jobs.enqueue(user, 'transcribe', id, input.captureIds?.length ? { captureIds: input.captureIds } : {});
    return presentJob(job);
  }

  /** Erase every photo and recording of the survey. Cannot be undone. */
  @Roles('ADMIN')
  @Post('surveys/:id/captures/erase')
  @HttpCode(200)
  erase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.captures.eraseSurvey(user, id);
  }
}
