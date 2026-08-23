// Cart data/query layer (M3-1, catalog-inventory-engineer's half — see
// FEATURES.md M3-1). Pure functions over the shared Prisma `db` singleton;
// no framework/route dependency (same "keep data-layer query functions
// free of any framework import" rule as productService.ts/region.ts —
// see docs/agents/learnings/catalog-inventory-engineer.md), so directly
// unit-testable in-process against a real local Postgres. Route wiring and
// the cart session cookie live in src/app/api/cart/*/route.ts and
// src/lib/cartCookie.ts.
//
// Binding design: docs/agents/arch-decisions/M3-1-guest-session-cookie.md
// ("the ADR" below). Every decision number referenced in comments here is
// that document's decision, not invented locally.
//
// IRON RULE (see this agent's CLAUDE.md and the ADR's Decision 10): a cart
// is NOT a reservation. Nothing in this file creates, updates, or reads
// `InventoryReservation`, and nothing here decrements `RegionalInventory`.
// `availableForSale = onHand - reserved - safetyBuffer` is read-only here,
// purely to reject an add/update that would exceed real-time stock.
import { Prisma, Region } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { regionCurrency } from "./region";

// 7 days — kept in lockstep with the cart cookie's `maxAge`
// (src/lib/cartCookie.ts's `CART_COOKIE_MAX_AGE`) and with
// `ShoppingCart.expiresAt`'s own `dbgenerated` INSERT-time default in
// prisma/schema.prisma. ADR Decision 7: both must slide together on every
// mutation, or neither does.
const CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Upper bound on any single line-item quantity. `CartItem.quantity` is a
// Postgres `Int` (32-bit); more importantly, no real hardware order is
// anywhere near this size — bounding it defends against the same class of
// bug as the `?page=`/`?minPrice=` unbounded-numeric-input findings in
// productService.ts (see learnings file): a client-supplied quantity must
// never reach a DB write unvalidated.
export const MAX_CART_QUANTITY = 999;

// ---------------------------------------------------------------------------
// Errors — typed so route handlers can map each to the right HTTP status
// without string-matching. See `cartErrorResponse` below for the mapping
// used by all three route handlers.

export class CartNotFoundError extends Error {
  constructor(cartId: string) {
    super(`Cart not found or expired: ${cartId}`);
    this.name = "CartNotFoundError";
  }
}

export class VariantNotFoundError extends Error {
  constructor(variantId: string) {
    super(`Variant not found or inactive: ${variantId}`);
    this.name = "VariantNotFoundError";
  }
}

export class CartItemNotFoundError extends Error {
  constructor(variantId: string) {
    super(`Variant ${variantId} is not in this cart`);
    this.name = "CartItemNotFoundError";
  }
}

export class InsufficientStockError extends Error {
  constructor(public readonly availableForSale: number) {
    super(`Requested quantity exceeds available stock (${availableForSale} available)`);
    this.name = "InsufficientStockError";
  }
}

export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQuantityError";
  }
}

/**
 * Maps a typed cart error to the HTTP status/body a route handler should
 * return; `null` for anything unrecognized, which callers must re-throw
 * (never swallow a failure on the cart mutation path).
 *
 * Security-reviewer M3-1 F6: `CartNotFoundError`/`VariantNotFoundError`/
 * `CartItemNotFoundError`'s own `.message` embeds the internal cart id (not
 * caller-controlled) or the caller-supplied `variantId` (attacker-
 * controlled, reflected back). Neither belongs in a client-facing response
 * body — log the full message server-side (still available for on-call
 * debugging) and return a static, generic message to the caller instead.
 * `InsufficientStockError`/`InvalidQuantityError`'s messages carry no id at
 * all (just numbers/static text), so those are unchanged.
 */
export function cartErrorResponse(
  err: unknown,
): { status: number; body: { error: string; availableForSale?: number } } | null {
  if (err instanceof CartNotFoundError) {
    console.error(`[cart] ${err.message}`);
    return { status: 404, body: { error: "Cart not found" } };
  }
  if (err instanceof VariantNotFoundError) {
    console.error(`[cart] ${err.message}`);
    return { status: 404, body: { error: "Item not found or unavailable" } };
  }
  if (err instanceof CartItemNotFoundError) {
    console.error(`[cart] ${err.message}`);
    return { status: 404, body: { error: "Item is not in your cart" } };
  }
  if (err instanceof InsufficientStockError) {
    return {
      status: 409,
      body: { error: err.message, availableForSale: err.availableForSale },
    };
  }
  if (err instanceof InvalidQuantityError) {
    return { status: 400, body: { error: err.message } };
  }
  return null;
}

function newExpiresAt(): Date {
  return new Date(Date.now() + CART_TTL_MS);
}

function assertValidAddQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) {
    throw new InvalidQuantityError(
      `quantity must be an integer between 1 and ${MAX_CART_QUANTITY}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Read model

export interface CartItemDetail {
  id: string;
  variantId: string;
  quantity: number;
  variantName: string;
  productSlug: string;
  productName: string;
  attributes: Prisma.JsonValue;
  images: string[];
  price: string | null; // Decimal serialized as a fixed-2dp string, e.g. "45000.00"
  currency: string | null;
  availableForSale: number | null; // onHand - reserved - safetyBuffer; null if no RegionalInventory row exists
  lineTotal: string | null; // price * quantity, fixed-2dp string; null if no RegionalPrice row exists
}

export interface CartDetail {
  id: string;
  userId: string | null;
  sessionId: string;
  region: Region;
  currency: string;
  expiresAt: Date;
  items: CartItemDetail[];
}

type QueryClient = typeof db | Prisma.TransactionClient;

/**
 * Loads the full cart + items + region-scoped price/stock, or `null` if the
 * cart doesn't exist or has expired. ADR Decision 5: "every read must
 * filter `expiresAt > now()` rather than trusting a background sweeper" —
 * enforced here, the single place all read paths funnel through.
 */
async function loadCartDetail(client: QueryClient, cartId: string): Promise<CartDetail | null> {
  const cart = await client.shoppingCart.findFirst({
    where: { id: cartId, expiresAt: { gt: new Date() } },
    include: {
      items: {
        orderBy: { addedAt: "asc" },
        include: {
          variant: {
            include: {
              product: { select: { slug: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!cart) return null;

  // Region isn't known until the cart row itself is read, so the
  // region-scoped price/inventory rows can't be pushed into the include
  // above — fetched here as two batched queries (not N+1 per item).
  const variantIds = cart.items.map((i) => i.variantId);
  const [prices, inventories] = await Promise.all([
    variantIds.length
      ? client.regionalPrice.findMany({
          where: { variantId: { in: variantIds }, region: cart.region },
        })
      : Promise.resolve([]),
    variantIds.length
      ? client.regionalInventory.findMany({
          where: { variantId: { in: variantIds }, region: cart.region },
        })
      : Promise.resolve([]),
  ]);
  const priceByVariant = new Map(prices.map((p) => [p.variantId, p]));
  const inventoryByVariant = new Map(inventories.map((i) => [i.variantId, i]));

  const items: CartItemDetail[] = cart.items.map((item) => {
    const price = priceByVariant.get(item.variantId) ?? null;
    const inventory = inventoryByVariant.get(item.variantId) ?? null;
    const availableForSale = inventory
      ? inventory.onHand - inventory.reserved - inventory.safetyBuffer
      : null;

    return {
      id: item.id,
      variantId: item.variantId,
      quantity: item.quantity,
      variantName: item.variant.name,
      productSlug: item.variant.product.slug,
      productName: item.variant.product.name,
      attributes: item.variant.attributes,
      images: item.variant.images,
      price: price ? price.price.toFixed(2) : null,
      currency: price ? price.currency : null,
      availableForSale,
      lineTotal: price ? price.price.mul(item.quantity).toFixed(2) : null,
    };
  });

  return {
    id: cart.id,
    userId: cart.userId,
    sessionId: cart.sessionId,
    region: cart.region,
    currency: cart.currency,
    expiresAt: cart.expiresAt,
    items,
  };
}

interface LockedCart {
  id: string;
  region: Region;
  sessionId: string;
  userId: string | null;
}

/**
 * Locks the `ShoppingCart` row FOR UPDATE (only if active — an expired row
 * is never locked or returned) so every mutation in this file serializes
 * against concurrent mutations of the SAME cart. This is the entity-level
 * lock scope: a single shopper's cart is low-contention, and locking at
 * this granularity (rather than per-CartItem) means addToCart/
 * updateCartItemQuantity/removeFromCart never race each other on the same
 * cart, closing the same class of lost-update bug the reservation path
 * guards against with `SELECT FOR UPDATE` on inventory rows — applied here
 * to cart-quantity consistency, not stock (a cart is not a reservation).
 */
async function lockCart(tx: Prisma.TransactionClient, cartId: string): Promise<LockedCart | null> {
  const rows = await tx.$queryRaw<LockedCart[]>`
    SELECT id, region, "sessionId", "userId"
    FROM "ShoppingCart"
    WHERE id = ${cartId} AND "expiresAt" > now()
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Identity resolution (ADR Decision 5 / Decision 6)

export interface FindActiveCartInput {
  sessionId?: string;
  userId?: string;
}

/**
 * Read-only lookup — never creates a row (ADR Decision 6: minting only
 * happens on a write). Resolution order per Decision 5: if `userId` is
 * present, look up by `userId` only (most-recently-updated cart, since
 * `userId` isn't unique — see ADR "Known limits"); otherwise by
 * `sessionId`. An expired row is never returned.
 */
export async function findActiveCart(input: FindActiveCartInput): Promise<CartDetail | null> {
  const { sessionId, userId } = input;
  const now = new Date();

  if (userId) {
    const cart = await db.shoppingCart.findFirst({
      where: { userId, expiresAt: { gt: now } },
      orderBy: { updatedAt: "desc" },
    });
    return cart ? loadCartDetail(db, cart.id) : null;
  }

  if (sessionId) {
    const cart = await db.shoppingCart.findFirst({
      where: { sessionId, expiresAt: { gt: now } },
    });
    return cart ? loadCartDetail(db, cart.id) : null;
  }

  return null;
}

export interface GetOrCreateCartInput {
  sessionId?: string;
  userId?: string;
  region: Region;
}

export interface GetOrCreateCartResult {
  cart: CartDetail;
  sessionId: string;
  isNewCart: boolean;
}

/**
 * Resolves or creates a `ShoppingCart`, minting a `sessionId` if needed.
 * Deliberately takes a single options object rather than the three
 * positional params sketched in the task dispatch — TypeScript forbids a
 * required parameter (`region`) following optional ones
 * (`sessionId?`/`userId?`), so a literal `(sessionId?, userId?, region)`
 * signature doesn't compile. Same information, safer shape.
 *
 * TTL: a `ShoppingCart` row whose `expiresAt` has passed is never reused —
 * `findActiveCart` (used internally) already filters it out, so this
 * function's "not found" path transparently creates a fresh cart. If the
 * caller carries a guest `sessionId` cookie whose row happens to be
 * expired, that stale row is deleted first so the fresh cart can reuse the
 * same `sessionId` value without tripping the `@unique` constraint.
 */
export async function getOrCreateCart(input: GetOrCreateCartInput): Promise<GetOrCreateCartResult> {
  const { userId, region } = input;
  let sessionId = input.sessionId;

  const existing = await findActiveCart({ sessionId, userId });
  if (existing) {
    return { cart: existing, sessionId: existing.sessionId, isNewCart: false };
  }

  if (sessionId) {
    await db.shoppingCart.deleteMany({
      where: { sessionId, expiresAt: { lte: new Date() } },
    });
  } else {
    // ADR Decision 3: crypto.randomUUID() only — 122 bits of CSPRNG
    // randomness. Never substitute cuid()/Math.random()/a hash of user
    // data; this value is the sole lookup key for a guest cart.
    sessionId = randomUUID();
  }

  const currency = regionCurrency(region);

  try {
    const created = await db.shoppingCart.create({
      data: { sessionId, userId, region, currency },
    });
    const cart = await loadCartDetail(db, created.id);
    return { cart: cart!, sessionId, isNewCart: true };
  } catch (err) {
    // ADR Decision 8: two concurrent first-writes for the same identity
    // both find no cart and both try to create one. `sessionId @unique` is
    // the guard — treat a P2002 unique violation as "someone else won",
    // re-read and use the winner's row rather than surfacing an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await db.shoppingCart.findFirst({
        where: { sessionId, expiresAt: { gt: new Date() } },
      });
      if (winner) {
        // Security-reviewer M3-1 F2: the row that won this sessionId race
        // may belong to a DIFFERENT real user than the requester — e.g. an
        // attacker who plants a stolen/leaked `sessionId` cookie, then
        // authenticates as themselves with no cart of their own. NEVER
        // claim or return another user's cart in that case; mint a fresh
        // cart for the requester instead (falls through to `findActiveCart`
        // by `userId` first, so if the requester already has their own
        // active cart elsewhere, that one is returned rather than creating
        // a duplicate).
        if (winner.userId !== null && winner.userId !== userId) {
          return getOrCreateCart({ userId, region });
        }
        // Defensive edge case beyond the canonical guest/guest race above:
        // an authenticated request lost the race against its OWN leftover
        // guest cart under the same cookie (the "official" merge path is
        // mergeGuestCartOnLogin, called once at actual login — this covers
        // the rare case where a write reaches here before that ran). Claim
        // the row for this user ONLY if it is currently unowned
        // (`winner.userId === null`) — the branch above already ruled out
        // "owned by someone else".
        const claimed =
          userId && winner.userId === null
            ? await db.shoppingCart.update({ where: { id: winner.id }, data: { userId } })
            : winner;
        const cart = await loadCartDetail(db, claimed.id);
        return { cart: cart!, sessionId: claimed.sessionId, isNewCart: false };
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Mutations

/**
 * Adds `quantity` of `variantId` to the cart, incrementing an existing
 * line's quantity rather than duplicating a row (guarded by
 * `CartItem.@@unique([cartId, variantId])`). Rejects (throws
 * `InsufficientStockError`, no row created or incremented) when the
 * resulting total would exceed real-time `availableForSale` for the cart's
 * own region, computed with the exact same formula
 * `onHand - reserved - safetyBuffer` productService.ts's `getProductDetail`
 * uses. Never touches `InventoryReservation` or `RegionalInventory` — a
 * cart is not a reservation (ADR Decision 10 / M3-2's job at checkout).
 */
export async function addToCart(
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<CartDetail> {
  assertValidAddQuantity(quantity);

  return db.$transaction(async (tx) => {
    const cart = await lockCart(tx, cartId);
    if (!cart) throw new CartNotFoundError(cartId);

    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, isActive: true, deletedAt: null },
      include: { regionalInventory: { where: { region: cart.region } } },
    });
    if (!variant) throw new VariantNotFoundError(variantId);

    const inventory = variant.regionalInventory[0];
    const availableForSale = inventory
      ? inventory.onHand - inventory.reserved - inventory.safetyBuffer
      : 0;

    const existingItem = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });
    const newQuantity = (existingItem?.quantity ?? 0) + quantity;

    // Security-reviewer M3-1 F5: the per-request delta is already bounded
    // by `assertValidAddQuantity` above, but the CUMULATIVE total (existing
    // line + this delta) was only ever checked against `availableForSale`,
    // never against `MAX_CART_QUANTITY` itself — a variant with enough
    // stock could be repeatedly added past the bound `updateCartItemQuantity`
    // already enforces. Same cap, both mutation paths.
    if (newQuantity > MAX_CART_QUANTITY) {
      throw new InvalidQuantityError(`quantity must not exceed ${MAX_CART_QUANTITY}`);
    }

    if (newQuantity > availableForSale) {
      throw new InsufficientStockError(Math.max(availableForSale, 0));
    }

    await tx.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      create: { cartId, variantId, quantity: newQuantity },
      update: { quantity: newQuantity },
    });

    // ADR Decision 7: slide the TTL on every mutation, in lockstep with the
    // cookie's re-issued maxAge (route handler's job).
    await tx.shoppingCart.update({ where: { id: cartId }, data: { expiresAt: newExpiresAt() } });

    return (await loadCartDetail(tx, cartId))!;
  });
}

/**
 * Updates a line item's quantity, or deletes it if `newQuantity <= 0`.
 * Throws `CartItemNotFoundError` if the variant isn't already in the cart
 * (this is "update", not "add" — creating a new line is `addToCart`'s job).
 * Re-validates `newQuantity` against real-time `availableForSale` the same
 * way `addToCart` does.
 */
export async function updateCartItemQuantity(
  cartId: string,
  variantId: string,
  newQuantity: number,
): Promise<CartDetail> {
  if (!Number.isInteger(newQuantity)) {
    throw new InvalidQuantityError("quantity must be an integer");
  }

  if (newQuantity <= 0) {
    return removeFromCart(cartId, variantId);
  }

  if (newQuantity > MAX_CART_QUANTITY) {
    throw new InvalidQuantityError(`quantity must not exceed ${MAX_CART_QUANTITY}`);
  }

  return db.$transaction(async (tx) => {
    const cart = await lockCart(tx, cartId);
    if (!cart) throw new CartNotFoundError(cartId);

    const existingItem = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });
    if (!existingItem) throw new CartItemNotFoundError(variantId);

    const inventory = await tx.regionalInventory.findFirst({
      where: { variantId, region: cart.region },
    });
    const availableForSale = inventory
      ? inventory.onHand - inventory.reserved - inventory.safetyBuffer
      : 0;

    if (newQuantity > availableForSale) {
      throw new InsufficientStockError(Math.max(availableForSale, 0));
    }

    await tx.cartItem.update({
      where: { cartId_variantId: { cartId, variantId } },
      data: { quantity: newQuantity },
    });
    await tx.shoppingCart.update({ where: { id: cartId }, data: { expiresAt: newExpiresAt() } });

    return (await loadCartDetail(tx, cartId))!;
  });
}

/**
 * Removes a line item. Idempotent: removing a variant that isn't in the
 * cart is a no-op, not an error (mirrors DELETE semantics). Never touches
 * `RegionalInventory.reserved` — correct, since add-to-cart never reserved
 * anything in the first place.
 */
export async function removeFromCart(cartId: string, variantId: string): Promise<CartDetail> {
  return db.$transaction(async (tx) => {
    const cart = await lockCart(tx, cartId);
    if (!cart) throw new CartNotFoundError(cartId);

    await tx.cartItem.deleteMany({ where: { cartId, variantId } });
    await tx.shoppingCart.update({ where: { id: cartId }, data: { expiresAt: newExpiresAt() } });

    return (await loadCartDetail(tx, cartId))!;
  });
}

/**
 * Returns the full cart (items + region-scoped price/stock) by id, or
 * `null` if it doesn't exist or has expired. Region is read from the cart
 * row itself — a cart is scoped to a single region for its whole lifetime
 * (ADR Decision 10), so no separate region param is needed here.
 */
export async function getCart(cartId: string): Promise<CartDetail | null> {
  return loadCartDetail(db, cartId);
}

/**
 * Merges a guest cart into the authenticated user's cart on login, then
 * deletes the guest row. For a variant in both carts, takes
 * `MAX(guestQty, userQty)`, never the sum (ADR Decision 9 — summing would
 * double-count a shopper who added the same item on a different device).
 * If the user has no existing active cart, the guest cart is promoted in
 * place (its `userId` is set) rather than copied, so its `CartItem` rows
 * transfer for free. Returns `null` only if there is nothing to merge and
 * the user has no cart either. No `region` param: a promoted guest cart
 * keeps its own region (single-region-per-deployment, ADR Decision 10), and
 * merging into an existing user cart uses that cart's already-fixed region.
 */
export async function mergeGuestCartOnLogin(
  guestSessionId: string,
  userId: string,
): Promise<CartDetail | null> {
  return db.$transaction(async (tx) => {
    const now = new Date();

    const guestRow = await tx.shoppingCart.findFirst({
      where: { sessionId: guestSessionId, expiresAt: { gt: now } },
    });

    if (!guestRow) {
      const userCart = await tx.shoppingCart.findFirst({
        where: { userId, expiresAt: { gt: now } },
        orderBy: { updatedAt: "desc" },
      });
      return userCart ? loadCartDetail(tx, userCart.id) : null;
    }

    // A guest cart is, by construction, never already claimed by a user —
    // but guard anyway rather than merging a stranger's cart into this
    // user's if `guestSessionId` was somehow already promoted.
    if (guestRow.userId && guestRow.userId !== userId) {
      const userCart = await tx.shoppingCart.findFirst({
        where: { userId, expiresAt: { gt: now } },
        orderBy: { updatedAt: "desc" },
      });
      return userCart ? loadCartDetail(tx, userCart.id) : null;
    }

    const userRow = await tx.shoppingCart.findFirst({
      where: { userId, expiresAt: { gt: now } },
      orderBy: { updatedAt: "desc" },
    });

    if (!userRow || userRow.id === guestRow.id) {
      const promoted = await tx.shoppingCart.update({
        where: { id: guestRow.id },
        data: { userId, expiresAt: newExpiresAt() },
      });
      return loadCartDetail(tx, promoted.id);
    }

    const [guestItems, userItems] = await Promise.all([
      tx.cartItem.findMany({ where: { cartId: guestRow.id } }),
      tx.cartItem.findMany({ where: { cartId: userRow.id } }),
    ]);
    const userItemByVariant = new Map(userItems.map((i) => [i.variantId, i]));

    for (const guestItem of guestItems) {
      const userItem = userItemByVariant.get(guestItem.variantId);
      if (userItem) {
        const maxQuantity = Math.max(userItem.quantity, guestItem.quantity);
        if (maxQuantity !== userItem.quantity) {
          await tx.cartItem.update({ where: { id: userItem.id }, data: { quantity: maxQuantity } });
        }
      } else {
        await tx.cartItem.create({
          data: { cartId: userRow.id, variantId: guestItem.variantId, quantity: guestItem.quantity },
        });
      }
    }

    await tx.shoppingCart.update({ where: { id: userRow.id }, data: { expiresAt: newExpiresAt() } });
    await tx.shoppingCart.delete({ where: { id: guestRow.id } }); // cascades guest CartItems

    return loadCartDetail(tx, userRow.id);
  });
}

/**
 * Deletes the user's cart row(s) on logout (ADR Decision 9: the cookie is
 * also rotated to a fresh `randomUUID()` at the route layer — session-
 * fixation defence). A new session gets a fresh, empty cart transparently
 * on its next add-to-cart, same as any other never-seen guest.
 */
export async function clearCartOnLogout(userId: string): Promise<void> {
  await db.shoppingCart.deleteMany({ where: { userId } });
}
