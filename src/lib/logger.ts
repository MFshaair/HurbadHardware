type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const SENSITIVE_KEYS = new Set([
  'code',
  'otp',
  'authorization',
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'cookie',
]);
const PHONE_KEYS = new Set(['phone', 'payerphone', 'contactphone', 'to', 'recipient']);
const EMAIL_KEYS = new Set(['email', 'contactemail']);

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 5)}****${digits.slice(-3)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email?.includes('@')) return '***';
  const [local, domain] = email.split('@') as [string, string];
  return `${local.charAt(0)}***@${domain}`;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields)) {
      const lk = k.toLowerCase();
      if (SENSITIVE_KEYS.has(lk)) out[k] = '[redacted]';
      else if (PHONE_KEYS.has(lk) && typeof v === 'string') out[k] = maskPhone(v);
      else if (EMAIL_KEYS.has(lk) && typeof v === 'string') out[k] = maskEmail(v);
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(base: Fields): Logger;
}

export function createLogger(opts: { write?: (line: string) => void; base?: Fields } = {}): Logger {
  const write = opts.write ?? ((line: string) => process.stdout.write(line + '\n'));
  const base = opts.base ?? {};
  const emit = (level: Level, msg: string, fields?: Fields) => {
    const errorFields =
      fields?.err instanceof Error
        ? { err: { name: fields.err.name, message: fields.err.message, stack: fields.err.stack } }
        : {};
    const line = {
      level,
      time: new Date().toISOString(),
      msg,
      ...base,
      ...(redact({ ...fields, ...errorFields }) as Fields),
    };
    write(JSON.stringify(line));
  };
  return {
    debug: (m, f) => {
      if (process.env.APP_ENV === 'development') emit('debug', m, f);
    },
    info: (m, f) => {
      emit('info', m, f);
    },
    warn: (m, f) => {
      emit('warn', m, f);
    },
    error: (m, f) => {
      emit('error', m, f);
    },
    child: (b) => createLogger({ write, base: { ...base, ...b } }),
  };
}

export const logger: Logger = createLogger();
