/**
 * K1: merges a guest cart (identified by the `hh_cart` cookie token) into the signed-in
 * user's cart, summing quantities and capping at available stock.
 * Phase 0 ships a no-op so `events.signIn` can call it; Phase 2 Task 8 implements the body.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function -- Phase 2 Task 8 implements the body against Cart/CartItem; intentional no-op until then
export async function mergeGuestCartIntoUser(_guestToken: string, _userId: string): Promise<void> {}
