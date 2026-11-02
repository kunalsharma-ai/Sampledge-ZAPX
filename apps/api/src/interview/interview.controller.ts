import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { parseBody } from '../common/validation';
import { InterviewService } from './interview.service';

const answersSchema = z.object({
  pageId: z.string().min(1).max(64),
  answers: z.record(z.string().max(64), z.unknown()).refine((a) => Object.keys(a).length <= 500, 'Too many answers'),
});

const clientSchema = z.object({ touch: z.boolean().optional(), screenShortSide: z.number().min(0).max(20000).optional() });
const languageSchema = z.object({ language: z.string().min(2).max(35) });

/** Respondent-facing endpoints. No login: access is by signed link and an unguessable session token. */
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('public')
export class InterviewController {
  constructor(private readonly interview: InterviewService) {}

  @Post('s/:surveyId/start')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  start(
    @Param('surveyId') surveyId: string,
    @Body() body: unknown,
    @Headers('user-agent') userAgent?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const b = (body && typeof body === 'object' ? body : {}) as { query?: unknown; client?: unknown };
    const query = (b.query && typeof b.query === 'object' ? b.query : {}) as Record<string, unknown>;
    const client = clientSchema.safeParse(b.client ?? {});
    return this.interview.start(surveyId, query, { userAgent, acceptLanguage: acceptLanguage?.slice(0, 200), client: client.success ? client.data : {} });
  }

  @Post('r/:token/language')
  @HttpCode(200)
  language(@Param('token') token: string, @Body() body: unknown) {
    return this.interview.setLanguage(token, parseBody(languageSchema, body).language);
  }

  @Get('r/:token')
  state(@Param('token') token: string) {
    return this.interview.state(token);
  }

  @Post('r/:token/answers')
  @HttpCode(200)
  submit(@Param('token') token: string, @Body() body: unknown) {
    const input = parseBody(answersSchema, body);
    return this.interview.submit(token, input.pageId, input.answers);
  }

  @Post('r/:token/back')
  @HttpCode(200)
  back(@Param('token') token: string) {
    return this.interview.back(token);
  }
}

