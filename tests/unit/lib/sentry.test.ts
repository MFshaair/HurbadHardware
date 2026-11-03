import { describe, expect, it } from 'vitest';
import { scrubEvent } from '@/lib/sentry';

describe('sentry beforeSend (11 §8)', () => {
  it('scrubs phone, email, payerPhone, code, otp and authorization', () => {
    const event = scrubEvent({
      request: { headers: { authorization: 'Bearer x', 'user-agent': 'ua' } },
      extra: { phone: '+252612345678', payerPhone: '+252612345678', code: '123456', otp: '123456', sku: 'X' },
      user: { email: 'abdi@example.com', id: 'u1' },
    });
    expect(event.request.headers.authorization).toBe('[redacted]');
    expect(event.extra.code).toBe('[redacted]');
    expect(event.extra.otp).toBe('[redacted]');
    expect(event.extra.phone).toBe('+2526****678');
    expect(event.extra.payerPhone).toBe('+2526****678');
    expect(event.extra.sku).toBe('X');
    expect(event.user.email).toBe('a***@example.com');
    expect(event.user.id).toBe('u1');
  });
});
it('scrubs nested values, bodies and URL queries without mutating the source', () => {
  const source = {
    request: {
      headers: { Authorization: 'Bearer token', Cookie: 'session=secret' },
      data: 'phone=private',
      url: 'https://shop.test/api/auth?code=123456',
      cookies: { session: 'secret' },
      query_string: 'token=secret',
    },
    extra: { nested: { email: 'abdi@example.com', otp: '123456' } },
    user: { id: 123, ip_address: '127.0.0.1', name: 'Private' },
  };
  const event = scrubEvent(source);
  expect(event.request.headers.Authorization).toBe('[redacted]');
  expect(event.request.headers.Cookie).toBe('[redacted]');
  expect(event.request.data).toBe('[redacted]');
  expect(event.request.url).toBe('https://shop.test/api/auth');
  expect(event.request.query_string).toBe('[redacted]');
  expect(event.user).toEqual({ id: 123 });
  expect(event.extra.nested.otp).toBe('[redacted]');
  expect(source.extra.nested.otp).toBe('123456');
});
