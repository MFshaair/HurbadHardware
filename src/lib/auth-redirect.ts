/** Only local, unambiguous paths may become an authentication redirect. */
export function safeAuthRedirect(value: unknown, locale: string): string {
  const fallback = `/${locale === 'so' ? 'so' : 'en'}/account`;
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    // eslint-disable-next-line no-control-regex -- reject redirect control characters
    const unsafe = /[\\\x00-\x1f\x7f]/.test(decoded);
    if (decoded.startsWith('//') || unsafe) return fallback;
    const url = new URL(value, 'https://hurbad.invalid');
    return url.origin === 'https://hurbad.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/** Keep Auth.js server actions and callbacks on the configured public origin. */
export function authCallbackRedirect(url: string, baseUrl: string, configuredUrl?: string): string {
  const origin = new URL(configuredUrl ?? baseUrl).origin;
  if (url.startsWith('/') && !url.startsWith('//'))
    return new URL(safeAuthRedirect(url, 'en'), origin).toString();
  try {
    const target = new URL(url);
    if (target.origin === origin)
      return new URL(
        safeAuthRedirect(`${target.pathname}${target.search}${target.hash}`, 'en'),
        origin,
      ).toString();
  } catch {
    /* Invalid redirects use the account landing page. */
  }
  return `${origin}/en/account`;
}
