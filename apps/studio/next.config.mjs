const api = process.env.ZAPX_API_URL ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The studio talks to the API through this same-origin proxy, so the session cookie stays first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          // Milestone 20. Next.js needs inline scripts, so the policy limits what matters most without
          // breaking the app: no framing (clickjacking), no plugins, no <base> rewriting, and forms
          // and connections only to this site.
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; connect-src 'self'; worker-src 'self' blob:",
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), payment=(), usb=(), camera=(self), microphone=(self)' },
          // Browsers honour this only over https, so it is harmless in local development.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
