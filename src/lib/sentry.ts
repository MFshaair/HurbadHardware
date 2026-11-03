import { redact } from '@/lib/logger';

export interface ScrubbableEvent {
  request?: {
    headers?: Record<string, string>;
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
  };
  extra?: Record<string, unknown>;
  user?: {
    id?: unknown;
    email?: unknown;
    phone?: unknown;
    ip_address?: unknown;
    username?: unknown;
    name?: unknown;
  };
}
/** Apply the same recursive masking to errors and transactions before transport. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const clean = redact(event) as T;
  if (clean.request) {
    // Bodies, cookies and URL queries can contain auth codes or contact details under arbitrary keys.
    if (clean.request.data !== undefined) clean.request.data = '[redacted]';
    if (clean.request.cookies !== undefined) clean.request.cookies = '[redacted]';
    if (clean.request.query_string !== undefined) clean.request.query_string = '[redacted]';
    if (clean.request.url) clean.request.url = clean.request.url.split(/[?#]/)[0];
  }
  if (clean.user) {
    delete clean.user.ip_address;
    delete clean.user.username;
    delete clean.user.name;
  }
  return clean;
}
export const sentryBaseOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
  environment: process.env.APP_ENV,
  sendDefaultPii: false,
  beforeSend: <T extends ScrubbableEvent>(event: T) => scrubEvent(event),
  beforeSendTransaction: <T extends ScrubbableEvent>(event: T) => scrubEvent(event),
};
