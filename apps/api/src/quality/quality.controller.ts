import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { parseBody } from '../common/validation';
import { QualityService, type ReviewFilter } from './quality.service';

const decisionSchema = z.object({
  responseIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  decision: z.enum(['accept', 'reject']),
  note: z.string().trim().max(500).optional(),
});

const FILTERS: ReviewFilter[] = ['pending', 'accepted', 'rejected', 'flagged'];

/** Quality review queue and fieldwork dashboard for one survey. */
@Controller('surveys/:id')
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Get('quality')
  queue(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('filter') filter?: string, @Query('take') take?: string) {
    const f = FILTERS.includes(filter as ReviewFilter) ? (filter as ReviewFilter) : 'pending';
    return this.quality.queue(user, id, f, Math.min(500, Math.max(1, Number(take) || 100)));
  }

  /** Accept or reject completes. Rejecting is final: the quota place is released and the vendor is told quality_fail. */
  @Post('quality/decisions')
  @HttpCode(200)
  @Roles(...CAN_EDIT)
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(decisionSchema, body);
    return this.quality.decide(user, id, [...new Set(input.responseIds)], input.decision, input.note || undefined);
  }

  @Get('fieldwork')
  fieldwork(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quality.fieldwork(user, id);
  }
}
