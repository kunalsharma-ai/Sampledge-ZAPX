import { type INestApplication, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { config } from './config';

type EdgeRequest = { headers: Record<string, string | string[] | undefined>; ip?: string };

/** "198.51.100.7:443" or "2001:db8::1:443" (CloudFront-Viewer-Address) to the address alone. */
export function addressOnly(v: string): string | null {
  const a = v.trim().replace(/^\[(.*)\](:\d+)?$/, '$1');
  if (isIP(a)) return a;
  const cut = a.lastIndexOf(':');
  const b = cut > 0 ? a.slice(0, cut) : a;
  return isIP(b) ? b : null;
}

/**
 * Edge trust (Milestone 13). Requests from the CDN carry the shared secret; for them the viewer's
 * address and country come from the CDN's headers. On any other request those headers are dropped,
 * so a respondent who reaches the API directly cannot choose their own address or country.
 */
export function edgeTrust(req: EdgeRequest) {
  const c = config();
  if (!c.EDGE_SHARED_SECRET) return;
  const sent = req.headers['x-zapx-edge'];
  delete req.headers['x-zapx-edge'];
  const a = Buffer.from(typeof sent === 'string' ? sent : '');
  const b = Buffer.from(c.EDGE_SHARED_SECRET);
  const fromEdge = a.length === b.length && timingSafeEqual(a, b);
  const addressHeader = c.EDGE_CLIENT_ADDRESS_HEADER;
  if (!fromEdge) {
    if (addressHeader) delete req.headers[addressHeader];
    if (c.GEO_COUNTRY_HEADER) delete req.headers[c.GEO_COUNTRY_HEADER];
    return;
  }
  const viewer = addressHeader ? req.headers[addressHeader] : undefined;
  const ip = typeof viewer === 'string' ? addressOnly(viewer) : null;
  if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
}

/**
 * Headers on every API response (Milestone 20). The API answers JSON, files and a few XML documents,
 * never pages, so the content security policy allows nothing: if a response is ever opened as a page
 * (for example an uploaded file), no script runs and it cannot be framed. Routes that serve media
 * to other origins override Cross-Origin-Resource-Policy themselves.
 */
export function securityHeaders(https: boolean): Array<[string, string]> {
  const h: Array<[string, string]> = [
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'no-referrer'],
    ['Cache-Control', 'no-store'],
    ['Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],
    ['X-Frame-Options', 'DENY'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
    ['X-Permitted-Cross-Domain-Policies', 'none'],
  ];
  if (https) h.push(['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']);
  return h;
}

/** Shared app setup used by main.ts and the integration tests. */
export function configureApp(app: INestApplication) {
  app.use(cookieParser());
  // SCIM clients send application/scim+json (Milestone 8). Registering a JSON parser replaces Nest's
  // default one, so this parser reads both types (with the default 100 kB limit).
  // The Stripe webhook (Milestone 13) and SAMPLEON events are verified over the exact bytes received, so they are kept for those paths.
  (app as NestExpressApplication).useBodyParser('json', {
    type: ['application/json', 'application/scim+json'],
    verify: (req: { url?: string; rawBody?: Buffer }, _res: unknown, buf: Buffer) => {
      // SAMPLEON events are signed over the exact bytes too (Sampledge service signature).
      if (req.url?.startsWith('/api/billing/webhook') || req.url?.startsWith('/api/v1/sampleon/')) req.rawBody = buf;
    },
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // The studio and runtime reach the API through same-origin proxies; no CORS is enabled.
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  http.set('trust proxy', config().TRUST_PROXY_HOPS);
  http.use((req: EdgeRequest, _res: unknown, next: () => void) => {
    edgeTrust(req);
    next();
  });
  const secure = config().COOKIE_SECURE;
  http.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    for (const [k, v] of securityHeaders(secure)) res.setHeader(k, v);
    next();
  });
  return app;
}

export const logger = new Logger('ZAPX');
