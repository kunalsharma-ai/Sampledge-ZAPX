/**
 * Redirect & Vendor Integration module. Owns: redirect resolution and its audit log, the
 * callback outbox and worker, partner adapters (DIRECT, PROJEXA), the vendor API and outbound
 * webhooks. Public surface for the rest of ZAPX: RedirectService and WebhookService. Pure logic: @zapx/redirect-core.
 */
import { Module } from '@nestjs/common';
import { LocalSecretBox, SecretBox } from '../platform/secret-box';
import { CallbackWorker } from './callback.worker';
import { HttpDelivery } from './http-delivery';
import { IntegrationsController } from './integrations.controller';
import { LocalRedirectService, RedirectService } from './redirect.service';
import { RedirectRepository } from './redirect.repository';
import { VendorApiController } from './vendor-api.controller';
import { WebhookService } from './webhook.service';
import { WebhooksController } from './webhooks.controller';
import { AutomationQueue } from '../automation/automation.queue';

@Module({
  controllers: [IntegrationsController, VendorApiController, WebhooksController],
  providers: [
    RedirectRepository,
    HttpDelivery,
    CallbackWorker,
    WebhookService,
    AutomationQueue,
    { provide: SecretBox, useClass: LocalSecretBox },
    { provide: RedirectService, useClass: LocalRedirectService },
  ],
  exports: [RedirectService, SecretBox, CallbackWorker, WebhookService, AutomationQueue],
})
export class IntegrationsModule {}
