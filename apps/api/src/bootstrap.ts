import { type INestApplication, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/** Shared app setup used by main.ts and the integration tests. */
export function configureApp(app: INestApplication) {
  app.use(cookieParser());
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
