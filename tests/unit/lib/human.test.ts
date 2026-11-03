import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ mode: 'fake', fakeBot: false, check: vi.fn() }));
vi.mock('@/lib/env', () => ({
  env: {
    get PROVIDER_MODE() {
      return state.mode;
    },
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.fakeBot ? { 'x-fake-bot': '1' } : {}),
}));
vi.mock('botid/server', () => ({ checkBotId: state.check }));
import { verifyHuman } from '@/lib/human';
beforeEach(() => {
  state.mode = 'fake';
  state.fakeBot = false;
  state.check.mockReset();
});
describe('BotID', () => {
  it('uses fake verification without contacting a provider', async () => {
    await expect(verifyHuman()).resolves.toBeUndefined();
    expect(state.check).not.toHaveBeenCalled();
  });
  it('rejects a fake bot', async () => {
    state.fakeBot = true;
    await expect(verifyHuman()).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
  });
  it('checks live requests and rejects bots', async () => {
    state.mode = 'live';
    state.check.mockResolvedValue({ isBot: true });
    await expect(verifyHuman()).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
  });
  it('fails closed on provider failure', async () => {
    state.mode = 'live';
    state.check.mockRejectedValue(new Error('offline'));
    await expect(verifyHuman()).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
  });
  it('accepts a verified live human', async () => {
    state.mode = 'live';
    state.check.mockResolvedValue({ isBot: false });
    await expect(verifyHuman()).resolves.toBeUndefined();
  });
});
