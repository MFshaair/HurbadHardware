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

## An "obviously UI-only" item can hide a one-line library-config gap
**Symptom:** Drafting M1-2's "reset link invalidates the old session" criterion
by paraphrase alone would have made it look like pure frontend work (a
form + redirect), routed to storefront-admin-engineer with no flag that
anything else was needed.
**Cause:** better-auth does NOT revoke existing sessions on password reset
by default — it only does so if `emailAndPassword.revokeSessionsOnPasswordReset:
true` is set in `auth.ts` (confirmed by reading
`node_modules/better-auth/dist/api/routes/password.mjs`'s `resetPassword`
handler directly). An acceptance criterion phrased only in terms of
observable UI behavior ("old session stops working") doesn't reveal that
the underlying library defaults the opposite way; without reading the
library source, the gap would surface late, mid-implementation or at
security-review, instead of at planning time.
**Rule going forward:** Before finalizing acceptance criteria that assume
a library "just does" something security-relevant (session revocation,
enumeration-safety, rate-limiting, etc.), grep the actual dependency
source (`node_modules/<lib>/...`) for the relevant handler and confirm the
default, not just the happy-path docs. If a criterion turns out to need a
specific config flag, name the flag and the file directly in the
criterion so the builder isn't left to rediscover it, and use that finding
to decide whether the item is genuinely "pure UI" (no architect needed) or
has a real remaining design gap.

## Verify dispatch-supplied "there is no X" claims before designing a new X
**Symptom:** M2-1's dispatch prompt asserted "no region-selection
mechanism anywhere in the app (no `NEXT_PUBLIC_REGION` reading in any
page)" and asked me to decide whether to hardcode a region. Taking that
at face value would have led to inventing a fresh ad-hoc region constant
for the criteria, duplicating/conflicting with a mechanism that already
existed.
**Cause:** A grep of the actual repo (`next.config.ts:34`,
`.env.development`, `.env.example`, `.env.production.{kenya,ethiopia,
somalia}`) showed `NEXT_PUBLIC_REGION` was already defined per-deployment
by M0's env-file strategy — the dispatch's claim was only true in the
narrow sense that no *page component* reads it yet, not that no mechanism
exists at all.
**Rule going forward:** Treat any dispatch-prompt claim of the form "there
is no X in the codebase" as a hypothesis to verify with a grep/read before
building acceptance criteria around it, especially for cross-cutting
things (env vars, config, feature flags) that earlier milestones may have
already established. Ground the criteria in what actually exists, and
prefer wiring an existing mechanism over inventing a parallel one, even if
the dispatch prompt's suggested fallback (hardcode) would also have
"worked."

## Don't assume a JSON attribute field has uniform keys across categories
**Symptom:** Drafting M2-2's variant-attribute filter criterion around
"color" and "storage" as if every product had that pair would have baked
a false assumption into an acceptance criterion that a builder could
implement literally (a fixed two-key filter) and still fail most of the
catalog.
**Cause:** `ProductVariant.attributes` is a free-form `Json` field; the
PRD's own examples ("color, storage") only describe the smartphone
category. Reading `src/lib/seed.ts` directly showed every category uses
different keys (`Color`/`Storage` for phones, `RAM`/`Storage` for
laptops, `Capacity` for storage devices, `Resolution`/`Power` for
cameras, etc.) — there is no cross-category common key set. A criterion
paraphrased from the PRD's illustrative example, without checking the
actual seeded data, would have silently narrowed scope or required
rework mid-build.
**Rule going forward:** For any acceptance criterion involving a
free-form `Json`/`Jsonb` field, grep the actual seed/fixture data (not
just the PRD's illustrative examples) for the real key set before naming
specific keys in the criterion. Prefer phrasing the criterion as a
generic mechanism (works for any key/value pair) with one or two
concrete keys named only as the proof-test case, not as the full scope.

## Ledger items with a UI dependent on backend query work need a co-owner, spelled out at planning time
**Symptom:** M2-2 arrived in `FEATURES.md` with a single owner
(catalog-inventory-engineer) and three criteria that were all
backend/query-layer (GIN search, filters, latency) — no search bar or
filter panel anywhere in the criteria, and no other ledger item claimed
that UI either. Dispatching as-is would have produced a working query
layer with no way for a user to actually reach it.
**Cause:** The PRD's U4 unit bundles data-layer and UI work together
(`FilterPanel.tsx`, search bar, live results), but the ledger's condensed
three-bullet paraphrase kept only the backend "Approach" bullets and
dropped the UI ones during summarization — the same failure mode as the
"split along owner seam" lesson above, but in the other direction (UI
silently dropped instead of duplicated).
**Rule going forward:** When refining/confirming criteria for an item
whose PRD unit clearly names UI components/pages, explicitly check
whether the ledger item's current owner list and criteria account for
who builds the UI half, not just who builds the query/data half. If
missing, add the second owner and UI-facing criteria in the same edit
(mirroring a sibling item's existing owner split, e.g. M2-1's
"(data/query layer) + (pages/UI)" pattern) rather than assuming a later
item will pick it up — no later item was reserving that work here.

## A required+unique column with no auth backing it is a design decision, even when the schema needs no migration
**Symptom:** M3-1 (shopping cart) looked like pure CRUD on an
already-committed, already-migrated schema (`ShoppingCart`/`CartItem`
exist in full from M0's v3 schema, confirmed by reading
`prisma/schema.prisma:155-190` directly) — easy to wave through as
"no architect needed, nothing to design, the table's already there."
**Cause:** Reading the column list, not just the table's existence,
showed `ShoppingCart.sessionId` is `String @unique` (non-nullable) even
though `userId` is optional — every cart row, guest or registered, needs
a populated, globally-unique session identifier, and it is the *sole*
lookup key for a guest's cart with no authentication behind it. Grepping
`src/lib/auth.ts` and `src/lib` for any existing cookie/anonymous-session
mechanism found none — this identifier has to be invented from scratch
(name, entropy/generation method, cookie flags, lifetime). A criterion
phrased only as "guest (sessionId, 7-day expiry) ... carts work" reads as
a done-schema detail, not as "design a new security-relevant identity
mechanism," and would have let a builder improvise a weak/predictable
cookie with no review.
**Rule going forward:** Before treating a ledger item as "pure CRUD, no
architect needed" because its schema already exists, read the actual
column definitions (nullable? unique? no FK/no auth relation?) of every
model it touches, not just confirm the table is present. A
required+globally-unique column with no relation to an authenticated
entity is itself a signal that something (usually an identity/token
mechanism) still needs a scoped design decision, even though zero
migration work follows from it — flag that narrowly to platform-architect
(schema unchanged, mechanism undecided) rather than either skipping
review entirely or over-escalating the whole item as needing a redesign.

## Dispatch prompts can claim tool access ("you likely have Linear MCP
tools") that isn't actually granted in the session
**Symptom:** Dispatched to look up HRH-43 in Linear "using Linear MCP
tools," but the actual tool list available in-session was only
Read/Edit/Grep/Glob — no Linear tool present at all, despite the prompt's
confident phrasing.
**Cause:** The dispatching orchestrator's prompt text describes an
expected capability set, not a verified one; MCP tool grants are decided
by the harness/permission layer, not by what a prompt asserts.
**Rule going forward:** Never assume a tool exists because a dispatch
prompt says so — check the actual tool list first. If a claimed tool
(Linear, or any external system) is absent, don't fabricate its output or
silently skip the check: ground the task in whatever primary sources ARE
available (repo files, PRD, git history) and explicitly flag in the
handoff that the claimed tool was unavailable, so a human/orchestrator
knows the finding wasn't verified against the live source of truth it was
meant to be checked against.

## Before flagging "needs architect" for a new page, check whether existing verified components are already fully reusable
**Symptom:** M2-4 ("homepage category cards & search entry point") arrived
with a hedge ("only loop in platform-architect if a real gap turns up").
Left unresolved, that hedge would have forced the orchestrator to guess
whether to dispatch platform-architect, or a builder to discover mid-task
that nothing was actually missing.
**Cause:** The item touches two prior verified items' surface
(`getProductFacets` from M2-2, `SearchBar` from M2-2) — reading those
directly (not just their FEATURES.md summary) showed `SearchBar` already
hardcodes its own submit target (`/products?q=`) independent of which
page renders it, and `getProductFacets` already returns the exact
category list a "category cards" UI needs, with no per-category
icon/image field anywhere in the schema. A component built for one page
can be a drop-in on a second page with zero modification if it was
already written page-target-agnostic — worth checking explicitly instead
of assuming a new page always needs new plumbing.
**Rule going forward:** When a new ledger item's UI overlaps functionally
with an already-verified item's components/queries, read those
components' actual source (not just the prose description in FEATURES.md)
to check whether they're reusable as-is (self-contained navigation
target, generic props) before defaulting to "needs architect" or drafting
new component names. If fully reusable, say so explicitly and name the
exact reuse (component + prop shape) in the acceptance criteria, and give
an unhedged yes/no on architect review rather than leaving it as a
builder's runtime discovery.

## A bundled ledger item can hide a sub-slice that isn't actually blocked
**Symptom:** M3-3 ("Checkout flow & authoritative pricing") was one
`planned` item with three bullets, all implicitly gated on M3-2 (atomic
inventory reservation, still `planned`) just because the item as a whole
was declared blocked on it. HRH-44's Linear scope (address + payment-
method selection UI) mapped onto only the item's first bullet.
**Cause:** The first bullet ("Address/payment-method UI; tax computed
server-side by region") is pure selection-state UI over already-`verified`
surfaces (M1-3's `Address` CRUD, M3-1's cart/tax) and creates no DB row;
the other two bullets ("price always read from `RegionalPrice` server-
side," "checkout reads primary DB not replica") are properties of the real
order-creation transaction, which genuinely cannot exist before M3-2 per
AHD4 (reserve before commit). Treating the whole item as one blocked unit
would have left real, independently-buildable-and-testable work sitting
idle for no grounded reason.
**Rule going forward:** When a ledger item is marked blocked on a future
milestone item, check each of its bullets individually against what that
future item actually supplies (a schema row? a transaction? a library
call?) rather than trusting the item-level block label. If a bullet's
acceptance can be phrased as "selection/validation state exists" with an
explicitly inert terminal action (no row created) that doesn't depend on
the blocking item, split it into its own ledger sub-item (e.g. `M3-3a`)
with its own dependency list, and leave only the bullets that truly need
the blocker under the original item — cite the specific schema/transaction
dependency for each remaining bullet so a future reader doesn't have to
re-derive why they're still blocked.

## An ADR's "cannot ship without X" can bundle a safely-scopeable detection half with a genuinely-blocked decision half
**Symptom:** Two ADRs (M4-1, M3-2) both said HRH-48 "cannot ship without an
answer" to the money-taken-but-stock-gone question (auto-refund vs. ops
escalation) — read at face value, that phrasing looks like a hard blocker
requiring human escalation before any acceptance criteria could be written
at all, the same as the Somalia/Phase-2 iron-rule holds.
**Cause:** "Cannot ship without an answer" was true of the *remediation
action* (what a human should decide: refund automatically, or route to ops)
but not of *detecting and durably recording* the conflict — reading the
actual code (`reservationService.ts::confirmReservationsForOrder`) showed
the current behavior on this path is silent (rolls back with zero record),
which is strictly worse than a scoped item that honestly records the fact
(payment confirmed, order not advanced to CONFIRMED, a distinctly-named
`OrderEvent`) without deciding what to do about it. The blocking language
in the ADR was about the *action*, not the *visibility*.
**Rule going forward:** When an ADR/prior item's "Known limits" flags a
question as blocking a future item, check whether the blocked thing is
genuinely one indivisible decision, or whether it splits into (a) an
engineering-safe "detect + record honestly, take no remediation action" half
and (b) a real human/business "what action follows" half — the same
"sub-slice isn't actually blocked" pattern as the bundled-ledger-item lesson
below, but applied within one item's *own* Known-limits blocker rather than
across a ledger split. If (a) is buildable without inventing the business
answer (no silent success, no silently-dropped money, no auto-remediation
implied), scope the item to (a) only, name (b) explicitly as still deferred
to a human, and do not let an agent building (a) quietly also build (b).

## A prior item's security sign-off can hand the next item binding fixes that live in a third agent's files
**Symptom:** M3-2's security sign-off named two findings (F1, F2) as
"binding prerequisites on M3-3," but both fixes are in `cartService.ts`/
`reservationService.ts` — files that belong to `catalog-inventory-engineer`
(M3-1/M3-2's owner), not M3-3's stated owners
(commerce-payments-engineer + storefront-admin-engineer). Framing these
purely as M3-3 acceptance criteria without flagging the file mismatch risks
either the dispatched agents skipping them as "not my file" or silently
expanding their own scope into another agent's surface unnoticed.
**Cause:** A security sign-off routes findings by "which future item makes
this exploitable," not by "which agent owns the file." Those two routings
frequently diverge once a finding sits in a shared library one item wrote
and a later item's route handler calls.
**Rule going forward:** When carrying a binding co-requisite forward from
a prior item's security sign-off, check which file(s) the fix actually
touches and compare against the current item's stated owner(s). If they
diverge, say so explicitly in the ledger entry (owner line + each affected
criterion) as "coordination required with <agent>" rather than either
silently assigning it to the current owners or leaving the mismatch
implicit — this is not a decision to make unilaterally (don't quietly
reassign ownership), just a fact to surface so the orchestrator dispatches
the right agent(s) for that criterion.

## A validated-but-discarded field is a silent gap only direct code reading catches
**Symptom:** The dispatch prompt for M3-3 described "payment provider is
selected in M3-3a and recorded on the Order by M3-3" as if recording it
were already a solved detail. Reading `reservationService.ts` directly
showed `paymentProvider` is validated against an allowlist and then never
written anywhere — no `Order` column, no existing `OrderEvent.payload`
key — a real, silent gap the prose description glossed over.
**Cause:** A function that validates an input but doesn't persist it looks
identical from the outside (same successful response) to one that does —
the gap is invisible without reading the actual write statements, not just
the input type or the acceptance-criteria prose.
**Rule going forward:** When a criterion says a value is "recorded on"
some entity, verify by reading the actual create/update statements for
that entity (not just its schema fields) that the value is written
somewhere durable. If it isn't, name the exact zero-migration destination
(e.g. an existing free-form `Json` field already used for sibling data)
rather than leaving "recorded" as an assumption for the builder to satisfy
however they see fit.

## An existing library wrapper's presence doesn't mean its API shape matches a new item's needs
**Symptom:** M4-1 (Stripe Embedded Checkout session creation) could have
been treated as "the Stripe wrapper already exists (`src/lib/stripe.ts`),
just call it" — the file's presence alone looks like reusable prior work,
the same shape as the "check before assuming a new page needs new
plumbing" lesson below.
**Cause:** Reading `src/lib/stripe.ts` in full showed it wraps Stripe's
*classic hosted* Checkout (`mode: "payment"`, `success_url`/`cancel_url`)
for a one-off M0/U1 infrastructure smoke test — not Embedded Checkout
(`ui_mode: "embedded"`, `client_secret`, `return_url`), which is what U7/
HRH-47 actually needs. Same SDK, same file, genuinely different API call
shape; the wrapper needs extending, not just reuse, and that's a real
(if narrow) design question, not a copy-paste.
**Rule going forward:** "A wrapper for this SDK/library already exists" is
not the same claim as "this wrapper already does what the new item needs."
Read the actual call inside the existing wrapper (not just its exported
function names) and compare its exact mode/parameters against what the
new item's PRD/Linear description asks for before declaring it reusable
as-is. If the shape differs, name the specific mismatch (mode, params,
return shape) in the acceptance criteria and flag it as a reason
platform-architect review may still be warranted, rather than assuming
reuse makes the item automatically UI-wiring-shaped.

## A Linear item can name a component that never made it into the actual build — verify the file exists before treating its absence as a gap
**Symptom:** HRH-42's Linear description named `CartContext.tsx` alongside
`useCart.ts` as the artifacts for "cart persistence." M3-1 (already
verified) delivered `useCart.ts` but no `CartContext.tsx` anywhere in the
repo, which could read as a dropped requirement needing a new ledger entry.
**Cause:** `CartContext.tsx` was an early architecture-sketch name for a
shared client-side store; the actual implementation deliberately chose a
different, documented pattern instead — `useCart.ts`'s own file comment
states the server is the sole source of truth and every mutation
round-trips to the API and replaces local state wholesale, no
localStorage/global-store layer. A cross-component live-updating consumer
(e.g. a header cart-count badge) is the only thing that would actually
need a Context/shared-store, and grepping `src/app` showed no
Header/NavBar/site-chrome component exists yet anywhere in the codebase
(`layout.tsx` is still the unmodified Next.js scaffold) and no ledger item
in M0-M4 scopes one — so there is no current consumer for the named
component, and nothing to test an acceptance criterion against.
**Rule going forward:** When a Linear/PRD item names a specific
file/component that a completed sibling item didn't produce, don't assume
that's an automatic gap. Check (a) whether the sibling item's delivered
code achieves the same *outcome* through a different, deliberately-chosen
mechanism (read the file's own comments/tests for evidence of intent, not
just its filename), and (b) whether any currently-scoped ledger item would
actually consume the named component. If neither shows a real, testable
need today, recommend closing the Linear item as satisfied-by/duplicate of
the sibling rather than inventing a ledger entry for speculative
infrastructure with no consumer — that violates "no ledger entry, no
work" in reverse (manufacturing work instead of framing it). Revisit only
when a future item actually scopes the consumer (e.g. a global nav/header
with a live cart badge).
