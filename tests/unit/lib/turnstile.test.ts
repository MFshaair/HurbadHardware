import { describe, expect, it } from 'vitest';
import { verifyHuman } from '@/lib/turnstile';

describe('verifyHuman (fake mode)', () => {
  it("accepts only the token 'ok'", async () => {
    await expect(verifyHuman('ok', '1.1.1.1')).resolves.toBeUndefined();
    await expect(verifyHuman('nope', '1.1.1.1')).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
    await expect(verifyHuman('', '1.1.1.1')).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
  });
});
