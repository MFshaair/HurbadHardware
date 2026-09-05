// Order status timeline logic (M5-1b, HRH-53).
//
// Only two of the four PLACED/CONFIRMED/SHIPPED/DELIVERED states are
// reachable by ANY code path in this repo today — confirmed by grepping
// every `eventType:` write across src/lib: only `"CREATED"`
// (reservationService.ts, maps to PLACED) and `"PAYMENT_CONFIRMED"`
// (reservationService.ts, written from both the Stripe webhook and the
// M-Pesa callback path, maps to CONFIRMED) are ever written. No code path
// writes `"SHIPPED"` or `"DELIVERED"` — that gap belongs to a future
// ledger item (flagged in FEATURES.md M5-1b), not this one.
//
// This module is written to be correct for the two states that exist
// today AND to require zero changes once a future item starts writing
// SHIPPED/DELIVERED OrderEvents: it renders exactly whichever states have
// a real, matching OrderEvent as "reached" (with that event's own
// createdAt), and the rest as "not yet reached" — it never fabricates a
// timestamp for a step with no matching event, and never treats "no
// event yet" as "in progress".
export type TimelineStepKey = "PLACED" | "CONFIRMED" | "SHIPPED" | "DELIVERED";

export interface TimelineStep {
  key: TimelineStepKey;
  label: string;
  /** True only if a real matching OrderEvent row exists for this step. */
  reached: boolean;
  /** The matching OrderEvent's own createdAt — never fabricated/derived. */
  reachedAt: Date | null;
}

export interface OrderEventLike {
  eventType: string;
  createdAt: Date;
}

// The only mapping this repo's code actually writes today for the first
// two entries; SHIPPED/DELIVERED are named here so the component "just
// works" the moment some future OrderEvent writer starts emitting them —
// no change needed in this file.
const STEP_EVENT_TYPE: Record<TimelineStepKey, string> = {
  PLACED: "CREATED",
  CONFIRMED: "PAYMENT_CONFIRMED",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
};

const STEP_LABEL: Record<TimelineStepKey, string> = {
  PLACED: "Placed",
  CONFIRMED: "Confirmed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
};

const STEP_ORDER: TimelineStepKey[] = ["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED"];

/**
 * Builds the four-step timeline from whatever OrderEvent rows actually
 * exist for an order. Defensive by construction: works identically for an
 * order with only a CREATED event (freshly placed, payment not yet
 * confirmed), one with CREATED + PAYMENT_CONFIRMED, and (once some future
 * writer exists) one with all four — never throws on a partial event
 * list, never guesses a timestamp for a step that has no matching event.
 */
export function computeTimelineSteps(events: OrderEventLike[]): TimelineStep[] {
  return STEP_ORDER.map((key) => {
    const wantedEventType = STEP_EVENT_TYPE[key];
    // Earliest matching event wins if duplicates ever exist — first
    // real occurrence of the state, not the last.
    const match = events
      .filter((event) => event.eventType === wantedEventType)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    return {
      key,
      label: STEP_LABEL[key],
      reached: Boolean(match),
      reachedAt: match ? match.createdAt : null,
    };
  });
}

/**
 * The order's current status label — the label of the last step (in
 * PLACED→CONFIRMED→SHIPPED→DELIVERED order) that has actually been
 * reached. Returns null only if somehow not even PLACED has been
 * reached (should not happen for a real order, since CREATED is written
 * at order-creation time, but this must not throw if it ever does).
 */
export function currentStatusLabel(steps: TimelineStep[]): string | null {
  const reached = steps.filter((step) => step.reached);
  if (reached.length === 0) return null;
  return reached[reached.length - 1].label;
}
