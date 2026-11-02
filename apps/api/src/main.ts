import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, logger } from './bootstrap';
import { config } from './config';

async function main() {
  const cfg = config();
  const app = configureApp(await NestFactory.create(AppModule, { bodyParser: true }));
  await app.listen(cfg.API_PORT);
  logger.log(`API listening on http://localhost:${cfg.API_PORT}/api`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
