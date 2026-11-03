import { describe, expect, it, vi } from 'vitest';
import { createLogger, maskEmail, maskPhone, redact } from '@/lib/logger';

describe('masking', () => {
  it('maskPhone keeps country code + first digit and last 3', () => {
    expect(maskPhone('+252612345678')).toBe('+2526****678');
    expect(maskPhone('+254712345678')).toBe('+2547****678');
    expect(maskPhone(null)).toBe(null);
  });
  it('maskEmail keeps first char and domain', () => {
    expect(maskEmail('abdi@example.com')).toBe('a***@example.com');
    expect(maskEmail('bad')).toBe('***');
  });
  it('redact scrubs sensitive keys recursively', () => {
    expect(
      redact({ phone: '+252612345678', nested: { code: '123456', ok: 1 }, authorization: 'Bearer x' }),
    ).toEqual({
      phone: '+2526****678',
      nested: { code: '[redacted]', ok: 1 },
      authorization: '[redacted]',
    });
  });
});

describe('logger', () => {
  it('emits one JSON line with level, msg, time and masked fields', () => {
    const write = vi.fn();
    const log = createLogger({ write, base: { requestId: 'r1' } });
    log.info('otp requested', { phone: '+252612345678', channel: 'SMS' });
    expect(write).toHaveBeenCalledTimes(1);
    const line = JSON.parse(write.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'info',
      msg: 'otp requested',
      requestId: 'r1',
      phone: '+2526****678',
      channel: 'SMS',
    });
    expect(typeof line.time).toBe('string');
  });
});
