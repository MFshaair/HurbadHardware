import type { NextConfig } from "next";

// Hurbad Electronics E-commerce — Next.js configuration
//
// Notes on Cloudflare compatibility:
// - Product images are served through Cloudflare Images / Cloudflare CDN
//   (see docs/DEPLOYMENT.md), so remote image patterns are pre-registered
//   below for the domains we expect to use in each region.
// - `images.unoptimized` stays false because Vercel's built-in image
//   optimizer is used at the origin; Cloudflare sits in front as CDN/WAF,
//   it does not replace next/image's optimizer.
// - Standalone output keeps the deployed bundle small and predictable,
//   which plays well with Vercel's per-region deployments.
const nextConfig: NextConfig = {
  output: "standalone",

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "imagedelivery.net", // Cloudflare Images delivery domain
      },
      {
        protocol: "https",
        hostname: "*.hurbadhardware.com",
      },
    ],
  },

  // Environment variables that are safe to expose to the browser bundle.
  // Secrets (DATABASE_URL, STRIPE_SECRET_KEY, MPESA_*, SENDGRID_API_KEY)
  // must never be listed here — they stay server-only via process.env.
  env: {
    NEXT_PUBLIC_REGION: process.env.NEXT_PUBLIC_REGION,
  },

  eslint: {
    // Linting is run explicitly in CI (npm run lint); don't block builds on it.
    ignoreDuringBuilds: false,
  },

  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
