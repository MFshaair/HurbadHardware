# Learnings — product-planner

Durable, reusable lessons only. Read this in full before starting any
task; append after finishing. Format each entry as:

```
## <short title>
**Symptom:** ...
**Cause:** ...
**Rule going forward:** ...
```

Merge into existing entries rather than duplicating. Only durable,
reusable lessons — not task-specific trivia. Never record secrets or
customer data.

## Split acceptance criteria along the same seam as owner/agent split
**Symptom:** Drafting M1-1 (API/middleware layer, storefront-admin-engineer)
against the PRD's U3 test scenarios verbatim would have duplicated
"wrong credentials → generic error" and "reset invalidates old session"
into both M1-1 and M1-2, even though both ledger items share an owner and
a source PRD unit (U3). Duplicated criteria across items create ambiguity
about which agent/gate run actually proves them, and risk one item being
marked done on the strength of a check that actually lives in the other.
**Cause:** The PRD frames test scenarios per unit (U3), not per ledger item;
this repo's ledger sometimes splits one PRD unit across several M-items
(e.g. U3 -> M1-1 routes/middleware + M1-2 UI + M1-3 profile). Copying PRD
test scenarios 1:1 without re-partitioning them across the ledger's actual
item boundaries reintroduces overlap the ledger split was meant to avoid.
**Rule going forward:** When a PRD unit maps to multiple ledger items,
partition its test scenarios by which item's surface actually produces the
observable behavior (API/DB-level checks -> the backend item; UI-driven
checks -> the UI item), and note the split explicitly in the item whose
criteria look thinner than the PRD's, so a builder doesn't think a
scenario was dropped.

(No further entries yet.)
