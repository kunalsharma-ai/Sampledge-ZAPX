import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { parseBody } from '../common/validation';
import { InterviewService } from './interview.service';
import { config } from '../config';

const signalsSchema = z.object({
  hp: z.boolean().optional(),
  interactions: z.number().int().min(0).max(1_000_000).optional(),
  pasted: z.array(z.string().max(64)).max(100).optional(),
});

const answersSchema = z.object({
  pageId: z.string().min(1).max(64),
  answers: z.record(z.string().max(64), z.unknown()).refine((a) => Object.keys(a).length <= 500, 'Too many answers'),
  signals: signalsSchema.optional(),
});

const clientSchema = z.object({
  touch: z.boolean().optional(),
  screenShortSide: z.number().min(0).max(20000).optional(),
  automation: z.boolean().optional(),
  traits: z
    .record(z.string().max(20), z.union([z.string().max(100), z.number(), z.boolean()]))
    .refine((t) => Object.keys(t).length <= 20, 'Too many traits')
    .optional(),
});
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
    @Ip() ip: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Headers('user-agent') userAgent?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const geoHeader = config().GEO_COUNTRY_HEADER;
    const geo = geoHeader ? headers[geoHeader] : undefined;
    const b = (body && typeof body === 'object' ? body : {}) as { query?: unknown; client?: unknown };
    const query = (b.query && typeof b.query === 'object' ? b.query : {}) as Record<string, unknown>;
    const client = clientSchema.safeParse(b.client ?? {});
    return this.interview.start(surveyId, query, {
      userAgent,
      ip,
      acceptLanguage: acceptLanguage?.slice(0, 200),
      client: client.success ? client.data : {},
      geoCountry: typeof geo === 'string' ? geo.slice(0, 2) : undefined,
    });
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
    return this.interview.submit(token, input.pageId, input.answers, input.signals);
  }

  @Post('r/:token/back')
  @HttpCode(200)
  back(@Param('token') token: string) {
    return this.interview.back(token);
  }
}
