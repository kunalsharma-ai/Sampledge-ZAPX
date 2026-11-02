/**
 * The interview flow depends only on the abstract RedirectService. LocalRedirectService
 * implements it in-process on top of @zapx/redirect-core and RedirectRepository; an
 * HTTP client for a separate redirect service could replace it without other changes.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Response, Vendor } from '@zapx/db';
import { planCallback, resolveRedirect, type RedirectStatus, type ResolvedRedirect, type RespondentContext } from '@zapx/redirect-core';
import { SecretBox } from '../platform/secret-box';
import { WebhookService } from './webhook.service';
import { toIntegrationConfig } from './integration-config';
import { RedirectRepository } from './redirect.repository';

export interface RespondentRedirectContext {
  /** "none" when the respondent was rejected before a response was recorded. */
  responseId: string;
  uid: string;
  country: string | null;
  returnUrl: string | null;
  entryParams: Record<string, string>;
}

export interface RedirectMeta {
  tenantId: string;
  surveyId: string;
  isTest: boolean;
  reason?: string | null;
}

export abstract class RedirectService {
  /** Resolve where the respondent goes for this outcome, and record it in the redirect log. */
  abstract resolve(
    vendor: Vendor,
    respondent: RespondentRedirectContext,
    status: RedirectStatus,
    meta: RedirectMeta,
  ): Promise<ResolvedRedirect>;
  /** An outcome was recorded on a response: queue the vendor callback, if any, and webhook events. Never throws. */
  abstract outcomeRecorded(
    response: Pick<Response, 'id' | 'tenantId' | 'vendorId' | 'uid' | 'country' | 'returnUrl' | 'entryParams' | 'isTest'>,
    status: RedirectStatus,
  ): Promise<void>;
  /** Preview without recording (studio redirect QA). */
  abstract preview(vendor: Vendor, respondent: RespondentRedirectContext, status: RedirectStatus): Promise<ResolvedRedirect>;
}

const toCore = (vendor: Vendor, r: RespondentRedirectContext): RespondentContext => ({ ...r, vendorCode: vendor.code });

@Injectable()
export class LocalRedirectService extends RedirectService {
  private readonly log = new Logger('Redirects');

  constructor(
    private readonly repo: RedirectRepository,
    private readonly box: SecretBox,
    private readonly webhooks: WebhookService,
  ) {
    super();
  }

  private async configFor(vendor: Vendor) {
    const ctx = await this.repo.vendorContext(vendor.id);
    return toIntegrationConfig(ctx?.vendor ?? vendor, ctx?.project ?? null, ctx?.tenant ?? null, this.box);
  }

  async preview(vendor: Vendor, respondent: RespondentRedirectContext, status: RedirectStatus) {
    return resolveRedirect(await this.configFor(vendor), toCore(vendor, respondent), status);
  }

  async resolve(vendor: Vendor, respondent: RespondentRedirectContext, status: RedirectStatus, meta: RedirectMeta) {
    const resolved = await this.preview(vendor, respondent, status);
    try {
      await this.repo.recordRedirect({
        tenantId: meta.tenantId,
        surveyId: meta.surveyId,
        responseId: respondent.responseId === 'none' ? null : respondent.responseId,
        vendorId: vendor.id,
        uid: respondent.uid.slice(0, 200),
        status,
        statusWord: resolved.statusWord,
        source: resolved.source,
        level: resolved.level,
        url: meta.isTest ? null : resolved.url,
        reason: meta.reason?.slice(0, 200) ?? null,
        isTest: meta.isTest,
      });
    } catch (e) {
      // The audit log must never stop a respondent from leaving the survey.
      this.log.error(`Could not record redirect for ${respondent.responseId}: ${(e as Error).message}`);
    }
    return resolved;
  }

  async outcomeRecorded(response: Parameters<RedirectService['outcomeRecorded']>[0], status: RedirectStatus) {
    if (response.isTest) return;
    await this.webhooks.responseFinished(response.id, status);
    if (!response.vendorId) return;
    try {
      const ctx = await this.repo.vendorContext(response.vendorId);
      if (!ctx) return;
      const config = toIntegrationConfig(ctx.vendor, ctx.project, ctx.tenant, this.box);
      const planned = planCallback(
        config,
        {
          responseId: response.id,
          uid: response.uid,
          vendorCode: ctx.vendor.code,
          country: response.country,
          returnUrl: response.returnUrl,
          entryParams: (response.entryParams ?? {}) as Record<string, string>,
        },
        status,
      );
      if (!planned) return;
      await this.repo.enqueueCallback({
        tenantId: response.tenantId,
        vendorId: ctx.vendor.id,
        responseId: response.id,
        status,
        idempotencyKey: `${response.id}:${status}`,
        integration: ctx.vendor.integration,
        method: planned.method,
        url: planned.url,
        payload: planned.payload,
        maxAttempts: ctx.vendor.callbackMaxAttempts,
      });
    } catch (e) {
      this.log.error(`Could not queue callback for ${response.id}: ${(e as Error).message}`);
    }
  }
}
