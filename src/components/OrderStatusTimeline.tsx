import type { TimelineStep } from "@/lib/orderTimeline";

// Shared status-timeline component (M5-1b). Plain presentational
// component, same shape as CartSummary.tsx — no hooks, no "use client",
// renders exactly what `computeTimelineSteps` (src/lib/orderTimeline.ts)
// computed. It never fabricates a SHIPPED/DELIVERED timestamp: a step
// with `reached === false` always renders "Not yet reached", never a
// guessed date, and never a different visual treatment implying
// "in progress" unless a real event says so.
export default function OrderStatusTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol
      aria-label="Order status"
      className="flex flex-col gap-4 sm:flex-row sm:gap-6"
      data-testid="order-timeline"
    >
      {steps.map((step) => (
        <li
          key={step.key}
          data-testid={`timeline-step-${step.key}`}
          data-reached={step.reached ? "true" : "false"}
          className="flex min-h-[44px] flex-1 flex-col justify-center gap-1"
        >
          <span
            className={`text-sm font-semibold ${step.reached ? "text-green-700" : "text-gray-400"}`}
          >
            {step.label}
          </span>
          {step.reached && step.reachedAt ? (
            <span className="text-xs text-gray-500" data-testid={`timeline-step-${step.key}-time`}>
              {step.reachedAt.toISOString()}
            </span>
          ) : (
            <span className="text-xs text-gray-400">Not yet reached</span>
          )}
        </li>
      ))}
    </ol>
  );
}
