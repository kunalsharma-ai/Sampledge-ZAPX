import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { parseCsv } from '../imports/template-import';
import type { UploadedFile } from '../imports/documents';
import { CatiService, DISPOSITIONS, type CaseInput, type Disposition } from './cati.service';

const CALLERS = ['ADMIN', 'PROGRAMMER', 'INTERVIEWER'] as const;
const MAX_CASES = 20_000;

const casesSchema = z.object({
  maxAttempts: z.number().int().min(1).max(20).default(6),
  cases: z
    .array(
      z.object({
        code: z.string().max(64),
        phone: z.string().max(40),
        name: z.string().max(120).optional(),
        data: z.record(z.string()).optional(),
      }),
    )
    .min(1)
    .max(MAX_CASES),
});
const disposeSchema = z.object({
  disposition: z.enum(Object.keys(DISPOSITIONS) as [Disposition, ...Disposition[]]),
  note: z.string().max(1000).optional(),
  callbackAt: z.coerce.date().optional(),
  /** When the interviewer opened the case (for call length); clamped to the last 12 hours. */
  openedAt: z.coerce.date().optional(),
});

/** Reads a call list CSV: columns id (or code), phone, optional name, and any other columns as sample data. */
export function casesFromCsv(text: string): CaseInput[] {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, '')).filter((r) => r.some((c) => c.trim()));
  if (!header) throw new BadRequestException('The file is empty');
  const cols = header.map((h) => h.trim());
  const lower = cols.map((h) => h.toLowerCase());
  const at = (...names: string[]) => lower.findIndex((h) => names.includes(h));
  const idCol = at('id', 'code', 'uid', 'respondent_id');
  const phoneCol = at('phone', 'phone_number', 'telephone', 'mobile');
  const nameCol = at('name', 'full_name');
  if (idCol < 0 || phoneCol < 0) throw new BadRequestException('The file needs an "id" column and a "phone" column');
  if (rows.length > MAX_CASES) throw new BadRequestException(`Upload at most ${MAX_CASES} rows at a time`);
  return rows.map((r) => {
    const data: Record<string, string> = {};
    cols.forEach((h, i) => {
      if (i !== idCol && i !== phoneCol && i !== nameCol && r[i] !== undefined && r[i] !== '') data[h] = r[i]!;
    });
    return { code: r[idCol] ?? '', phone: r[phoneCol] ?? '', name: nameCol >= 0 ? r[nameCol] : undefined, data };
  });
}

/** CATI (Milestone 9): call lists for programmers, and the calling queue for interviewers. */
@Controller()
export class CatiController {
  constructor(private readonly cati: CatiService) {}

  // ---- Programmers ----

  @Post('surveys/:id/cati/cases')
  @Roles(...CAN_EDIT)
  add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(casesSchema, body);
    return this.cati.addCases(user, id, input.cases, input.maxAttempts);
  }

  @Post('surveys/:id/cati/cases/upload')
  @Roles(...CAN_EDIT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { maxAttempts?: string },
    @UploadedFileParam() file?: UploadedFile,
  ) {
    if (!file) throw new BadRequestException('Attach a CSV file');
    const maxAttempts = Math.min(20, Math.max(1, Number(body?.maxAttempts) || 6));
    return this.cati.addCases(user, id, casesFromCsv(file.buffer.toString('utf8')), maxAttempts);
  }

  @Get('surveys/:id/cati/summary')
  @Roles('ADMIN', 'PROGRAMMER', 'VIEWER')
  summary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cati.summary(user, id);
  }

  @Get('surveys/:id/cati/cases')
  @Roles('ADMIN', 'PROGRAMMER', 'VIEWER')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('status') status?: string) {
    if (status && !['PENDING', 'CALLBACK', 'IN_CALL', 'DONE', 'CLOSED'].includes(status)) throw new BadRequestException('Unknown status');
    return this.cati.listCases(user, id, status);
  }

  @Post('cati/cases/:id/reopen')
  @Roles(...CAN_EDIT)
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cati.reopen(user, id);
  }

  @Post('surveys/:id/cati/erase-phones')
  @Roles('ADMIN')
  @HttpCode(200)
  erase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cati.erasePhones(user, id);
  }

  // ---- Interviewers (and admins or programmers who make calls) ----

  @Get('cati/dispositions')
  @Roles(...CALLERS)
  dispositions() {
    return Object.entries(DISPOSITIONS).map(([code, d]) => ({ code, label: d.label }));
  }

  @Get('cati/surveys')
  @Roles(...CALLERS)
  surveys(@CurrentUser() user: AuthUser) {
    return this.cati.mySurveys(user);
  }

  @Post('cati/surveys/:id/next')
  @Roles(...CALLERS)
  @HttpCode(200)
  async next(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { case: await this.cati.next(user, id) };
  }

  @Post('cati/cases/:id/interview')
  @Roles(...CALLERS)
  @HttpCode(200)
  interview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cati.interview(user, id);
  }

  @Post('cati/cases/:id/disposition')
  @Roles(...CALLERS)
  @HttpCode(200)
  dispose(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(disposeSchema, body);
    const now = Date.now();
    const opened =
      input.openedAt && input.openedAt.getTime() <= now && now - input.openedAt.getTime() < 12 * 3_600_000 ? input.openedAt : new Date(now);
    return this.cati.dispose(user, id, input, opened);
  }

  @Post('cati/cases/:id/release')
  @Roles(...CALLERS)
  @HttpCode(204)
  release(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cati.release(user, id);
  }
}
