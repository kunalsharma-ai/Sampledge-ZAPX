/**
 * Redirect & Vendor Integration module. Owns: redirect resolution and its audit log, the
 * callback outbox and worker, partner adapters (DIRECT, PROJEXA) and the vendor API.
 * Public surface for the rest of ZAPX: RedirectService only. Pure logic: @zapx/redirect-core.
 */
import { Module } from '@nestjs/common';
import { LocalSecretBox, SecretBox } from '../platform/secret-box';
import { CallbackWorker } from './callback.worker';
import { HttpDelivery } from './http-delivery';
import { IntegrationsController } from './integrations.controller';
import { LocalRedirectService, RedirectService } from './redirect.service';
import { RedirectRepository } from './redirect.repository';
import { VendorApiController } from './vendor-api.controller';

@Module({
  controllers: [IntegrationsController, VendorApiController],
  providers: [
    RedirectRepository,
    HttpDelivery,
    CallbackWorker,
    { provide: SecretBox, useClass: LocalSecretBox },
    { provide: RedirectService, useClass: LocalRedirectService },
  ],
  exports: [RedirectService, SecretBox, CallbackWorker],
})
export class IntegrationsModule {}
