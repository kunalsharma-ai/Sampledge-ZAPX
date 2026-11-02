import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config';
import { CommonModule } from './common/common.module';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { UsersController } from './users/users.controller';
import { ProjectsController } from './projects/projects.controller';
import { SurveysController } from './surveys/surveys.controller';
import { SurveysService } from './surveys/surveys.service';
import { ExportService } from './exports/export.service';
import { VendorsController } from './vendors/vendors.controller';
import { LocalRedirectService, RedirectService } from './vendors/redirect.service';
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

/**
 * Modular monolith: modules share one process and database but keep their own controllers and
 * services, so any of them can be split out later when scale or isolation requires it.
 */
@Module({
  imports: [
    CommonModule,
    JwtModule.register({ global: true, secret: config().JWT_SECRET }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    ProjectsController,
    SurveysController,
    VendorsController,
    InterviewController,
    QaController,
    ChangeSetsController,
    TranslateController,
  ],
  providers: [
    SurveysService,
    ExportService,
    InterviewService,
    ChangeSetsService,
    ArchitectService,
    {
      provide: AiProvider,
      useFactory: (): AiProvider => {
        const { ANTHROPIC_API_KEY, AI_MODEL } = config();
        return ANTHROPIC_API_KEY ? new ClaudeAiProvider(ANTHROPIC_API_KEY, AI_MODEL) : new UnconfiguredAiProvider(AI_MODEL);
      },
    },
    { provide: RedirectService, useClass: LocalRedirectService },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
