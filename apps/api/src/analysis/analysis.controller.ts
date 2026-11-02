import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import { AnalysisService, filtersSchema, reportConfigSchema, weightingSchema } from './analysis.service';

const READERS = ['ADMIN', 'PROGRAMMER', 'VIEWER'] as const;
const frequenciesSchema = z.object({
  filters: filtersSchema,
  weighting: weightingSchema,
  variables: z.array(z.string().max(100)).max(500).optional(),
});
const weightsSchema = z.object({ filters: filtersSchema, weighting: weightingSchema.unwrap() });
const crosstabSchema = z.object({
  filters: filtersSchema,
  weighting: weightingSchema,
  banner: z.string().max(100),
  stubs: z.array(z.string().max(100)).min(1).max(200),
  confidence: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.99)]).default(0.95),
});
const reportSchema = z.object({ name: z.string().trim().min(1).max(120), config: reportConfigSchema });

/** Analysis and saved reports (Milestone 10). Viewers can run and download; programmers save. */
@Controller()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get('surveys/:id/analysis/variables')
  @Roles(...READERS)
  variables(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analysis.variables(user, id);
  }

  @Post('surveys/:id/analysis/frequencies')
  @Roles(...READERS)
  @HttpCode(200)
  frequencies(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(frequenciesSchema, body ?? {});
    return this.analysis.frequencies(user, id, input.filters, input.variables, input.weighting);
  }

  @Post('surveys/:id/analysis/crosstab')
  @Roles(...READERS)
  @HttpCode(200)
  crosstab(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.analysis.crosstabs(user, id, parseBody(crosstabSchema, body));
  }

  @Post('surveys/:id/analysis/weights')
  @Roles(...READERS)
  @HttpCode(200)
  weights(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(weightsSchema, body);
    return this.analysis.weights(user, id, input.filters, input.weighting);
  }

  @Get('surveys/:id/reports')
  @Roles(...READERS)
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analysis.listReports(user, id);
  }

  @Post('surveys/:id/reports')
  @Roles(...CAN_EDIT)
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(reportSchema, body);
    return this.analysis.saveReport(user, id, input.name, input.config);
  }

  @Get('reports/:id')
  @Roles(...READERS)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analysis.report(user, id);
  }

  @Put('reports/:id')
  @Roles(...CAN_EDIT)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(reportSchema, body);
    const r = await this.analysis.report(user, id);
    return this.analysis.saveReport(user, r.surveyId, input.name, input.config, id);
  }

  @Delete('reports/:id')
  @Roles(...CAN_EDIT)
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analysis.deleteReport(user, id);
  }

  @Post('reports/:id/run')
  @Roles(...READERS)
  @HttpCode(200)
  async run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.analysis.report(user, id);
    return this.analysis.run(user, r.surveyId, reportConfigSchema.parse(r.config));
  }

  @Get('reports/:id/export.xlsx')
  @Roles(...READERS)
  async export(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: ExpressResponse) {
    const file = await this.analysis.exportReport(user, id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.send(file.data);
  }
}
