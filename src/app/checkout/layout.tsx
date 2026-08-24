import { CheckoutDraftProvider } from "./CheckoutDraftContext";

// Mounts CheckoutDraftProvider once for all three checkout routes
// (`/checkout/address`, `/checkout/payment`, `/checkout/review`) — ADR
// docs/agents/arch-decisions/M3-3a-checkout-draft-state.md Decision 1.
// The App Router keeps this layout mounted across client-side navigation
// between its child segments, so the Context (and its in-memory draft
// state) survives address -> payment -> review without a round trip; the
// provider also persists to `sessionStorage` so a full page refresh
// survives too.
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <CheckoutDraftProvider>{children}</CheckoutDraftProvider>;
}
