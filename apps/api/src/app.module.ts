import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config';
import { CommonModule } from './common/common.module';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { UsersController } from './users/users.controller';
import { PreferencesController } from './users/preferences.controller';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { AnalysisController } from './analysis/analysis.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { AnalysisService } from './analysis/analysis.service';
import { CatiController } from './cati/cati.controller';
import { CatiService } from './cati/cati.service';
import { TelephonyController } from './cati/telephony.controller';
import { TelephonyService } from './cati/telephony.service';
import { SsoController } from './auth/sso.controller';
import { SsoService } from './auth/sso.service';
import { SamlService } from './auth/saml.service';
import { ScimController } from './scim/scim.controller';
import { ScimAdminController } from './scim/scim-admin.controller';
import { BillingController } from './plans/billing.controller';
import { BillingService } from './plans/billing.service';
import { ScimGuard } from './scim/scim.guard';
import { ProjectsController } from './projects/projects.controller';
import { SurveysController } from './surveys/surveys.controller';
import { SurveysService } from './surveys/surveys.service';
import { ExportService } from './exports/export.service';
import { VendorsController } from './vendors/vendors.controller';
import { LibraryController } from './library/library.controller';
import { IntegrationsModule } from './integrations/integrations.module';
import { CapiAppealsController, FieldworkController } from './fieldwork/fieldwork.controller';
import { FieldworkService } from './fieldwork/fieldwork.service';
import { DistributionController, UnsubscribeController } from './distribution/distribution.controller';
import { DistributionService } from './distribution/distribution.service';
import { InterviewController } from './interview/interview.controller';
import { InterviewService } from './interview/interview.service';
import { HealthController } from './health.controller';
import { QaController } from './qa/qa.controller';
import { TestCasesController } from './qa/test-cases.controller';
import { TranslateController } from './surveys/translate.controller';
import { TranslationToolsController } from './surveys/translation-tools.controller';
import { ChangeSetsController } from './changesets/changesets.controller';
import { ChangeSetsService } from './changesets/changesets.service';
import { ArchitectService } from './ai/architect.service';
import { AiProvider } from './ai/ai-provider';
import { ClaudeAiProvider, UnconfiguredAiProvider } from './ai/claude.provider';
import { AiGateway } from './ai/ai-gateway';
import { ResearchAssistantService } from './analysis/research.service';
import { AiUsageRepository } from './ai/ai-usage.repository';
import { AiSettingsController } from './ai/ai-settings.controller';
import { FraudBlocksController, QualityController } from './quality/quality.controller';
import { CaptureController } from './captures/capture.controller';
import { CaptureService } from './captures/capture.service';
import { QualityService } from './quality/quality.service';
import { NetworkReputationService } from './quality/network-reputation.service';
import { TranscriptionService } from './captures/transcription.service';
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
import { FileStore, fileStoreFromConfig } from './jobs/file-store';
import { AutomationController, NotificationsController } from './automation/automation.controller';
import { AutomationService } from './automation/automation.service';
import { GovernanceController } from './governance/governance.controller';
import { GovernanceService } from './governance/governance.service';

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
    DashboardController,
    TelephonyController,
    AuthController,
    UsersController,
    PreferencesController,
    CatiController,
    AnalysisController,
    MediaController,
    SsoController,
    ScimController,
    ScimAdminController,
    BillingController,
    ProjectsController,
    SurveysController,
    VendorsController,
    LibraryController,
    InterviewController,
    QaController,
    TestCasesController,
    ChangeSetsController,
    TranslateController,
    TranslationToolsController,
    AiSettingsController,
    QualityController,
    FraudBlocksController,
    CaptureController,
    CapiAssignmentsController,
    CapiAppController,
    FieldworkController,
    DistributionController,
    UnsubscribeController,
    CapiAppealsController,
    ProjectMembersController,
    ApiKeysController,
    AuditLogController,
    JobsController,
    AutomationController,
    NotificationsController,
    GovernanceController,
  ],
  providers: [
    CatiService,
    TelephonyService,
    AnalysisService,
    ResearchAssistantService,
    MediaService,
    SsoService,
    SamlService,
    BillingService,
    ScimGuard,
    SurveysService,
    ExportService,
    InterviewService,
    ChangeSetsService,
    ArchitectService,
    AiGateway,
    AiUsageRepository,
    QualityService,
    NetworkReputationService,
    TranscriptionService,
    CaptureService,
    CapiService,
    FieldworkService,
    DistributionService,
    QaService,
    ExportRunner,
    ProposeService,
    JobsService,
    JobWorker,
    FilesService,
    AutomationService,
    GovernanceService,
    { provide: FileStore, useFactory: fileStoreFromConfig },
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
