import { withSentryConfig } from '@sentry/nextjs';
import { withBotId } from 'botid/next/config';
import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');
const mediaHost = process.env.NEXT_PUBLIC_MEDIA_HOST;
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: mediaHost
      ? [{ protocol: 'https', hostname: mediaHost, pathname: '/storage/v1/object/public/media/**' }]
      : [],
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
  ],
};
export default withSentryConfig(withBotId(withNextIntl(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  telemetry: false,
  disableLogger: true,
  widenClientFileUpload: true,
});
