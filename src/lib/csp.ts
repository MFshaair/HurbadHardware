/** Per-request CSP. Development-only allowances never reach production builds. */
export function buildCsp(nonce: string, development = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://js.stripe.com https://challenges.vercel.com${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com",
    "font-src 'self'",
    "object-src 'none'",
    `connect-src 'self' https://*.sentry.io https://*.supabase.co https://challenges.vercel.com https://vitals.vercel-insights.com${development ? ' ws: wss:' : ''}`,
    'frame-src https://challenges.vercel.com https://checkout.stripe.com https://js.stripe.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://*.ethiotelecom.et",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
