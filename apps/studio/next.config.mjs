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
        ],
      },
    ];
  },
};

export default nextConfig;
