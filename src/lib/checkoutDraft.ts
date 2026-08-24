// Checkout draft persistence (M3-3a). Implements ADR
// docs/agents/arch-decisions/M3-3a-checkout-draft-state.md exactly — do
// not improvise a different mechanism (no cookie, no URL params, no new
// table/schema change).
//
// This is the ONLY module in the app allowed to read/write
// `sessionStorage` for the checkout draft — same discipline as
// `src/lib/cartCookie.ts` being the sole accessor for the cart cookie.
// `src/app/checkout/CheckoutDraftContext.tsx` is the only caller during
// normal navigation; `src/app/auth/login/page.tsx` also calls
// `clearCheckoutDraft()` directly (ADR Decision 7 — clear on login), since
// that page renders outside the checkout subtree and the Context is not
// mounted there.
//
// Everything in the draft is untrusted client input (ADR Decision 4):
// - `savedAddressId` must be re-checked for ownership server-side at the
//   moment it is consumed (done in ReviewStep via GET /api/addresses/[id],
//   which independently re-verifies session ownership).
// - No price, tax, quantity, currency, or region is ever stored here.
import type { Region } from "@prisma/client";

export const CHECKOUT_DRAFT_KEY = "hurbad_checkout_draft_v1";

const DRAFT_VERSION = 1;
const TTL_MS = 60 * 60 * 1000; // 60 minutes (ADR Decision 7) — do not raise to match the cart's 7-day TTL, this holds PII.

export interface NewAddressDraft {
  fullName: string;
  phone: string;
  region: Region;
  city: string;
  postalCode: string;
  street: string;
}

export type PaymentProvider = "stripe" | "mpesa";

export interface CheckoutDraft {
  version: 1;
  addressMode: "saved" | "new" | null;
  savedAddressId?: string;
  newAddress?: NewAddressDraft;
  saveNewAddress: boolean;
  paymentProvider: PaymentProvider | null;
  updatedAt: number;
}

export function emptyDraft(): CheckoutDraft {
  return {
    version: DRAFT_VERSION,
    addressMode: null,
    saveNewAddress: false,
    paymentProvider: null,
    updatedAt: Date.now(),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidNewAddress(value: unknown): value is NewAddressDraft {
  if (!isPlainObject(value)) return false;
  const { fullName, phone, region, city, postalCode, street } = value;
  return (
    typeof fullName === "string" &&
    typeof phone === "string" &&
    typeof region === "string" &&
    typeof city === "string" &&
    typeof postalCode === "string" &&
    typeof street === "string"
  );
}

/**
 * Validates an arbitrary parsed JSON blob against the exact v1 draft
 * shape. Anything that doesn't match — wrong version, malformed shape,
 * stray extra authoritative-looking fields aside — is rejected wholesale;
 * a reader never partially trusts a blob (ADR Decision 3).
 */
function isValidDraft(value: unknown): value is CheckoutDraft {
  if (!isPlainObject(value)) return false;
  if (value.version !== DRAFT_VERSION) return false;
  if (value.addressMode !== "saved" && value.addressMode !== "new" && value.addressMode !== null) return false;
  if (value.savedAddressId !== undefined && typeof value.savedAddressId !== "string") return false;
  if (value.newAddress !== undefined && !isValidNewAddress(value.newAddress)) return false;
  if (typeof value.saveNewAddress !== "boolean") return false;
  if (
    value.paymentProvider !== "stripe" &&
    value.paymentProvider !== "mpesa" &&
    value.paymentProvider !== null
  ) {
    return false;
  }
  if (typeof value.updatedAt !== "number") return false;
  return true;
}

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

/**
 * Reads and validates the draft from `sessionStorage`. Returns a fresh
 * empty draft (never throws, never partially trusts) on: no storage
 * available, no stored value, JSON parse failure, shape validation
 * failure, or staleness past the 60-minute TTL.
 */
export function readCheckoutDraft(): CheckoutDraft {
  if (!storageAvailable()) return emptyDraft();

  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_DRAFT_KEY);
    if (!raw) return emptyDraft();

    const parsed: unknown = JSON.parse(raw);
    if (!isValidDraft(parsed)) return emptyDraft();

    if (Date.now() - parsed.updatedAt > TTL_MS) return emptyDraft();

    return parsed;
  } catch {
    return emptyDraft();
  }
}

/**
 * Persists the draft. Wrapped in try/catch per ADR Decision 5: if
 * `sessionStorage` throws (Safari private mode, quota), this is a no-op —
 * the provider falls back to in-memory Context for the tab and navigation
 * still works; only a refresh loses the draft.
 */
export function writeCheckoutDraft(draft: CheckoutDraft): void {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    // Degrade, never crash checkout (ADR Decision 5).
  }
}

/**
 * Clears the draft. Called by the provider on successful order placement
 * (M3-3's job, not yet wired) and by `/checkout/payment`+`/checkout/review`
 * guards indirectly via the provider; also called directly (not through
 * the provider, which isn't mounted outside `/checkout`) from
 * `src/app/auth/login/page.tsx` on successful login (ADR Decision 7).
 *
 * KNOWN LIMIT: ADR Decision 7 also calls for clearing on logout, but this
 * app has no sign-out UI/call site anywhere yet (confirmed by repo-wide
 * grep — only `src/lib/auth.ts`'s `hooks.after` references `/sign-out`,
 * no page calls it). Wiring this in without a real logout flow to attach
 * it to would be inventing out-of-scope UI. The next agent that builds a
 * sign-out control MUST call `clearCheckoutDraft()` from it — flagged in
 * FEATURES.md's M3-3a entry.
 */
export function clearCheckoutDraft(): void {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.removeItem(CHECKOUT_DRAFT_KEY);
  } catch {
    // Best-effort clear only.
  }
}
