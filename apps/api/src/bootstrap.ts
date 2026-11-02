import { type INestApplication, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Shared app setup used by main.ts and the integration tests. */
export function configureApp(app: INestApplication) {
  app.use(cookieParser());
  // SCIM clients send application/scim+json (Milestone 8). Registering a JSON parser replaces Nest's
  // default one, so this parser reads both types (with the default 100 kB limit).
  (app as NestExpressApplication).useBodyParser('json', { type: ['application/json', 'application/scim+json'] });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // The studio and runtime reach the API through same-origin proxies; no CORS is enabled.
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  http.set('trust proxy', 1);
  http.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  return app;
}

export const logger = new Logger('ZAPX');
