/**
 * Partner-facing, versioned API (contract: docs/api/openapi.yaml). Vendors authenticate every
 * request with their vendor id and an HMAC of timestamp, method and path:
 *
 *   X-Zapx-Vendor:    <vendor id>
 *   X-Zapx-Timestamp: <unix seconds>            (must be within 5 minutes)
 *   X-Zapx-Signature: hex HMAC-SHA256(vendor secret, "<timestamp>.<METHOD>.<path?query>")
 */
import { BadRequestException, Controller, Get, Param, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { verifyRequest } from '@zapx/redirect-core';
import { Public } from '../auth/decorators';
import { AuditService } from '../common/audit.service';
import { RedirectRepository } from './redirect.repository';

const ID = /^[a-z0-9]{10,40}$/;

@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('v1/vendor')
export class VendorApiController {
  constructor(
    private readonly repo: RedirectRepository,
    private readonly audit: AuditService,
  ) {}

  private async authenticate(req: Request) {
    const id = req.header('x-zapx-vendor') ?? '';
    const timestamp = req.header('x-zapx-timestamp');
    const signature = req.header('x-zapx-signature');
    const vendor = ID.test(id) ? await this.repo.findVendorForApi(id) : null;
    // Same answer for unknown vendor and bad signature: no way to probe for vendor ids.
    if (!vendor) throw new UnauthorizedException('Invalid vendor credentials');
    const check = verifyRequest(vendor.secret, { method: req.method, pathWithQuery: req.originalUrl, timestamp, signature });
    if (!check.ok) {
      await this.audit.record({ tenantId: vendor.tenantId }, 'vendor_api.denied', 'vendor', vendor.id, {
        reason: check.reason,
        path: req.path,
      });
      throw new UnauthorizedException(
        check.reason === 'stale_timestamp' ? 'Timestamp outside the allowed window' : 'Invalid vendor credentials',
      );
    }
    return vendor;
  }

  private static present(rows: Awaited<ReturnType<RedirectRepository['outcomesForVendor']>>) {
    return rows.map((r) => ({
      responseId: r.id,
      surveyId: r.surveyId,
      uid: r.uid,
      status: r.status.toLowerCase(),
      country: r.country,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    }));
  }

  /** Outcomes recorded for this vendor's respondents, oldest first; page with `since`. */
  @Get('outcomes')
  async outcomes(
    @Req() req: Request,
    @Query('since') since?: string,
    @Query('surveyId') surveyId?: string,
    @Query('limit') limit?: string,
  ) {
    const vendor = await this.authenticate(req);
    const sinceDate = since ? new Date(since) : undefined;
    if (sinceDate && Number.isNaN(sinceDate.getTime())) throw new BadRequestException('since must be an ISO 8601 date-time');
    if (surveyId && !ID.test(surveyId)) throw new BadRequestException('Invalid surveyId');
    const take = Math.min(500, Math.max(1, Number(limit) || 100));
    const rows = await this.repo.outcomesForVendor(vendor.id, { since: sinceDate, surveyId, take });
    const items = VendorApiController.present(rows);
    return { items, next: items.length === take ? items[items.length - 1]!.completedAt : null };
  }

  /** Outcomes for one respondent id (one per survey). */
  @Get('outcomes/:uid')
  async outcome(@Req() req: Request, @Param('uid') uid: string, @Query('surveyId') surveyId?: string) {
    const vendor = await this.authenticate(req);
    if (uid.length > 200) throw new BadRequestException('Invalid uid');
    if (surveyId && !ID.test(surveyId)) throw new BadRequestException('Invalid surveyId');
    return { items: VendorApiController.present(await this.repo.outcomesForVendor(vendor.id, { uid, surveyId, take: 100 })) };
  }
}
