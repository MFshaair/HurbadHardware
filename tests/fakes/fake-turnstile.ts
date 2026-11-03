/** 12-testing.md §3: passes only when token === 'ok'. */
export function fakeVerifyBotID(token: string): boolean {
  return token === 'ok';
}
