import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config';
import { CommonModule } from './common/common.module';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { UsersController } from './users/users.controller';
import { CatiController } from './cati/cati.controller';
import { CatiService } from './cati/cati.service';
import { SsoController } from './auth/sso.controller';
import { SsoService } from './auth/sso.service';
import { ScimController } from './scim/scim.controller';
import { ScimAdminController } from './scim/scim-admin.controller';
import { ScimGuard } from './scim/scim.guard';
import { ProjectsController } from './projects/projects.controller';
import { SurveysController } from './surveys/surveys.controller';
import { SurveysService } from './surveys/surveys.service';
import { ExportService } from './exports/export.service';
import { VendorsController } from './vendors/vendors.controller';
import { IntegrationsModule } from './integrations/integrations.module';
import { InterviewController } from './interview/interview.controller';
import { InterviewService } from './interview/interview.service';
import { HealthController } from './health.controller';
import { QaController } from './qa/qa.controller';
import { TranslateController } from './surveys/translate.controller';
import { ChangeSetsController } from './changesets/changesets.controller';
import { ChangeSetsService } from './changesets/changesets.service';
import { ArchitectService } from './ai/architect.service';
import { AiProvider } from './ai/ai-provider';
import { ClaudeAiProvider, UnconfiguredAiProvider } from './ai/claude.provider';
import { AiGateway } from './ai/ai-gateway';
import { AiUsageRepository } from './ai/ai-usage.repository';
import { AiSettingsController } from './ai/ai-settings.controller';
import { QualityController } from './quality/quality.controller';
import { QualityService } from './quality/quality.service';
import { CapiAppController, CapiAssignmentsController } from './capi/capi.controller';
import { CapiService } from './capi/capi.service';
import { ProjectMembersController } from './projects/members.controller';
import { ApiKeysController } from './enterprise/api-keys.controller';
import { AuditLogController } from './enterprise/audit-log.controller';
import { QaService } from './qa/qa.service';
import { ExportRunner } from './exports/export-runner.service';
import { ProposeService } from './ai/propose.service';
import { JobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { JobWorker } from './jobs/job.worker';
import { FilesService } from './jobs/files.service';
import { FileStore, LocalFileStore } from './jobs/file-store';

/**
 * Modular monolith: modules share one process and database but keep their own controllers and
 * services, so any of them can be split out later when scale or isolation requires it.
 */
@Module({
  imports: [
    CommonModule,
    IntegrationsModule,
    JwtModule.register({ global: true, secret: config().JWT_SECRET }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    CatiController,
    SsoController,
    ScimController,
    ScimAdminController,
    ProjectsController,
    SurveysController,
    VendorsController,
    InterviewController,
    QaController,
    ChangeSetsController,
    TranslateController,
    AiSettingsController,
    QualityController,
    CapiAssignmentsController,
    CapiAppController,
    ProjectMembersController,
    ApiKeysController,
    AuditLogController,
    JobsController,
  ],
  providers: [
    CatiService,
    SsoService,
    ScimGuard,
    SurveysService,
    ExportService,
    InterviewService,
    ChangeSetsService,
    ArchitectService,
    AiGateway,
    AiUsageRepository,
    QualityService,
    CapiService,
    QaService,
    ExportRunner,
    ProposeService,
    JobsService,
    JobWorker,
    FilesService,
    { provide: FileStore, useClass: LocalFileStore },
    {
      // Provider registry: AI_PROVIDER picks the implementation. Adding OpenAI or Gemini means
      // one more AiProvider subclass and one more case here (docs/modules/ai-gateway.md).
      provide: AiProvider,
      useFactory: (): AiProvider => {
        const cfg = config();
        switch (cfg.AI_PROVIDER) {
          case 'anthropic':
            if (!cfg.ANTHROPIC_API_KEY) return new UnconfiguredAiProvider('An administrator needs to set ANTHROPIC_API_KEY.');
            if (!cfg.AI_MODEL) return new UnconfiguredAiProvider('An administrator needs to set AI_MODEL.');
            return new ClaudeAiProvider(cfg.ANTHROPIC_API_KEY, cfg.AI_MODEL, {
              maxRetries: cfg.AI_MAX_RETRIES,
              timeoutMs: cfg.AI_TIMEOUT_MS,
            });
        }
      },
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
