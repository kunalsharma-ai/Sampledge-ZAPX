import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { parseSurveyDefinition } from '@zapx/survey-schema';
import { config } from '../config';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { SurveysService } from '../surveys/surveys.service';
import { ChangeSetsService } from './changesets.service';
import { ArchitectService } from '../ai/architect.service';
import { AiGateway } from '../ai/ai-gateway';
import { notConfigured } from '../ai/claude.provider';
import { AiError } from '../ai/ai-provider';
import { classifyFile, toAiDocument, type UploadedFile } from '../imports/documents';
import { buildTemplateWorkbook, importTemplateRows, parseCsv, readXlsxTable } from '../imports/template-import';

const proposeSchema = z.object({ instruction: z.string().max(20000).default('') });
const manualSchema = z.object({ title: z.string().min(1).max(200).default('Pasted definition'), definition: z.unknown() });

const upload = () => FileInterceptor('file', { limits: { fileSize: config().UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 10 } });

function aiHttpError(err: unknown): never {
  if (err instanceof AiError) throw new HttpException({ message: err.message, code: err.code }, err.status);
  throw err;
}

@Controller()
export class ChangeSetsController {
  constructor(
    private readonly changeSets: ChangeSetsService,
    private readonly surveys: SurveysService,
    private readonly architect: ArchitectService,
    private readonly gateway: AiGateway,
  ) {}

  @Get('ai/status')
  aiStatus(@CurrentUser() user: AuthUser) {
    return this.gateway.status(user.tenantId);
  }

  @Get('imports/template.xlsx')
  async template(@Res() res: ExpressResponse) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="zapx-questionnaire-template.xlsx"');
    res.send(await buildTemplateWorkbook());
  }

  /**
   * AI Survey Architect: build or edit the draft from an instruction (typed or dictated) and an
   * optional questionnaire file. Returns a change set; the draft is not touched.
   */
  @Post('surveys/:id/ai/propose')
  @Roles(...CAN_EDIT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(upload())
  async propose(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown, @UploadedFileParam() file?: UploadedFile) {
    const { instruction } = parseBody(proposeSchema, body ?? {});
    if (!instruction.trim() && !file) throw new BadRequestException('Describe what to build or change, or attach a questionnaire.');
    if (!this.architect.configured) aiHttpError(notConfigured());
    const draft = await this.surveys.draft(user, id);
    const current = parseSurveyDefinition(draft.definition);
    const documents = [];
    if (file) {
      const kind = classifyFile(file);
      if (kind === 'xlsx') throw new BadRequestException('Excel files are imported with the template importer. Use Import file instead.');
      documents.push(await toAiDocument(file, kind));
    }
    const outcome = await this.architect
      .propose(
        { tenantId: user.tenantId, userId: user.id },
        { instruction, current: current.ok ? current.definition : null, documents, surveyId: id },
      )
      .catch(aiHttpError);
    const assumptions = [...outcome.assumptions];
    if (outcome.servedByFallback) assumptions.unshift(`The primary model declined; this proposal was written by ${outcome.model}.`);
    if (outcome.remainingProblems.length) assumptions.push(`Logic problems the AI did not fix: ${outcome.remainingProblems.join('; ')}`);
    return this.changeSets.create(user, id, {
      source: 'AI',
      title: outcome.summary.split(/(?<=\.)\s/)[0]?.slice(0, 200) || 'AI proposal',
      prompt: instruction || undefined,
      sourceFileName: file?.originalname,
      proposed: outcome.definition,
      assumptions,
      confidence: { summary: outcome.summary, attempts: outcome.attempts, redactions: outcome.redactions },
      producer: outcome.model,
    });
  }

  /**
   * Import a questionnaire file. The ZAPX template (XLSX/CSV) is imported deterministically;
   * Word, PDF and text questionnaires are read by the AI architect.
   */
  @Post('surveys/:id/import')
  @Roles(...CAN_EDIT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(upload())
  async import(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown, @UploadedFileParam() file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach a file.');
    const kind = classifyFile(file);
    if (kind === 'xlsx' || kind === 'csv') {
      const survey = await this.surveys.getSurvey(user, id);
      const table =
        kind === 'xlsx'
          ? await readXlsxTable(file.buffer).catch(() => {
              throw new BadRequestException('The Excel file could not be read.');
            })
          : parseCsv(file.buffer.toString('utf8'));
      const result = importTemplateRows(table, survey.name);
      if (!result.definition) {
        throw new UnprocessableEntityException({ message: 'The file could not be imported', errors: result.errors, rows: result.rows });
      }
      return this.changeSets.create(user, id, {
        source: 'IMPORT',
        title: `Import ${file.originalname}`,
        sourceFileName: file.originalname,
        proposed: result.definition,
        assumptions: result.assumptions,
        confidence: { overall: result.confidence, rows: result.rows },
        producer: 'zapx-template-v1',
      });
    }
    return this.propose(
      user,
      id,
      {
        instruction:
          parseBody(proposeSchema, body ?? {}).instruction || 'Program this questionnaire as a new survey, replacing the current draft.',
      },
      file,
    );
  }

  /** Propose a pasted definition (e.g. from another tool) for review like any other change. */
  @Post('surveys/:id/changesets')
  @Roles(...CAN_EDIT)
  async manual(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(manualSchema, body);
    const parsed = parseSurveyDefinition(input.definition);
    if (!parsed.ok) throw new BadRequestException({ message: 'The survey definition is not valid', issues: parsed.issues });
    return this.changeSets.create(user, id, { source: 'MANUAL', title: input.title, proposed: parsed.definition, producer: 'manual' });
  }

  @Get('surveys/:id/changesets')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.changeSets.list(user, id);
  }

  @Get('changesets/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.changeSets.get(user, id);
  }

  @Post('changesets/:id/apply')
  @Roles(...CAN_EDIT)
  apply(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.changeSets.apply(user, id);
  }

  @Post('changesets/:id/reject')
  @Roles(...CAN_EDIT)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.changeSets.reject(user, id);
  }
}
