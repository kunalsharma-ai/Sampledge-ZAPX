/**
 * Background worker process (Milestone 7): runs jobs, vendor callbacks and webhooks, without the
 * HTTP server. Run the API with JOB_WORKER=off and CALLBACK_WORKER=off when this process runs.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { logger } from './bootstrap';
import { config } from './config';
import { JobWorker } from './jobs/job.worker';
import { CallbackWorker } from './integrations/callback.worker';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  // This process always works the queues, whatever JOB_WORKER and CALLBACK_WORKER say for the API.
  app.get(JobWorker).start();
  app.get(CallbackWorker).start();
  logger.log(`Worker running (jobs every ${config().JOB_POLL_MS} ms)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
