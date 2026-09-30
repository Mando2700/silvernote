import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files and `pg` opens raw sockets: load both from node_modules at runtime.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  // Migrations are read from disk at runtime; make sure they travel with a deployed server bundle.
  outputFileTracingIncludes: {
    '/**': ['./supabase/migrations/**/*.sql'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  poweredByHeader: false,
};

export default nextConfig;
