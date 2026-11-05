import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content security policy with a per-request nonce (security review S6). Only scripts that carry the
 * nonce run: Next.js adds it to its own scripts (it reads the policy from the request headers), and
 * app/layout.tsx adds it to the theme boot script. 'strict-dynamic' lets those scripts load the app's
 * chunks. An injected <script> or inline event handler has no nonce, so the browser refuses it.
 *
 * The rest of the policy (framing, plugins, <base>, connections, workers) is the one from
 * Milestone 20; next.config.mjs sends the same directives without script-src on other responses.
 */
const BASE_POLICY = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; connect-src 'self'; worker-src 'self' blob:";

function policy(nonce: string, dev = process.env.NODE_ENV === 'development') {
  // The development server's fast refresh needs eval; production builds never do.
  return `${BASE_POLICY}; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`;
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = policy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Pages only: not the API proxy, built assets or prefetches (they carry no inline script).
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
