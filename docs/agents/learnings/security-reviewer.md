# Learnings — security-reviewer

Durable, reusable lessons only. Read this in full before starting any
task; append after finishing. Format each entry as:

```
## <short title>
**Symptom:** ...
**Cause:** ...
**Rule going forward:** ...
```

Merge into existing entries rather than duplicating. Only durable,
reusable lessons — not task-specific trivia, and never the actual
leaked/vulnerable value itself. Describe the class of issue, not the
secret or PII you found.

## Dev-only stubs are production log-leak surfaces
**Symptom:** A placeholder callback standing in for a not-yet-built external
integration (email delivery, SMS) logs a live single-use token and user PII
with no environment guard.
**Cause:** The stub is written to make a flow exercisable in dev and is
never re-read with "what if this ships as-is" in mind.
**Rule going forward:** Any stub that handles a credential, token or PII
must fail closed in production, and the sensitive field should be removed
from the callback's destructured signature entirely — a NODE_ENV guard alone
still leaves the value in scope for the next editor to log.

## Presence-check middleware needs a forged-cookie test, not just a no-cookie test
**Symptom:** An auth suite has "unauthenticated redirects" and "authenticated
passes" cases and looks complete, but deleting the page-level session check
would keep it green.
**Cause:** The no-cookie case is stopped by cookie-presence middleware and
never reaches the real page-level validation, so only the middleware is
actually under test.
**Rule going forward:** Where middleware checks presence and the page checks
validity, require a case sending a garbage value under the real cookie name.
Insist the name be derived at runtime from a live Set-Cookie header, not
hardcoded — a hardcoded name that drifts makes the test silently degrade
into the no-cookie path and still pass.

## Enumeration hardening is only as strong as the weakest form in the flow
**Symptom:** Login and forgot-password are carefully hardened to return
byte-identical responses, and the acceptance criteria only name those two —
while the registration form in the same milestone returns a distinguishable
"already exists" error, restoring the enumeration oracle.
**Cause:** Criteria are partitioned per-page, so the reviewer checks the two
pages named and the third page's equivalent weakness never gets asked about.
**Rule going forward:** Treat user-enumeration as a property of the whole
auth surface, not a per-page criterion. Whenever a diff hardens one form
against enumeration, enumerate every other form in the same flow that takes
an email and check what each returns for a known vs. unknown address.

## Prefer "cannot leak" over "does not leak" in client error rendering
**Symptom:** Two pages both pass an enumeration check, but one renders the
API's message verbatim while the other renders a hardcoded local constant
and never reads the response body.
**Cause:** Verbatim rendering is correct only for as long as the upstream
library keeps its messages uniform — it's a passing test resting on an
external invariant the repo doesn't control.
**Rule going forward:** Where a response must be identical across cases,
prefer a client that ignores the body entirely and renders a local constant.
When reviewing a verbatim-render page, always confirm the invariant in the
dependency's source and note that the guarantee is external, not local.

## Coverage-exclude lists grow by false analogy
**Symptom:** A new pure, in-process-testable module gets appended to a
coverage exclude list whose existing entries were excluded for a real,
narrow reason (code only reachable inside a spawned subprocess) — often
the one module holding the item's input-validation logic.
**Cause:** The list already exists with a paragraph of justification, so
adding a line looks like following precedent rather than making a new
claim; nobody re-tests whether the stated reason applies to the new file.
**Rule going forward:** For every file added to a coverage exclude in a
diff, check its imports yourself. If it has no framework/runtime
dependency, the "can't be instrumented" justification is false and the
exclusion is dodging coverage on business logic — treat it as a finding
even when the module is integration-tested.

## Ownership checks split from the mutation statement
**Symptom:** A resource route does findUnique → compare userId → mutate by
id. Correct today, and cross-tenant tests pass.
**Cause:** Safety rests on an unstated global invariant (nothing anywhere
reassigns the row's owner), not on the statement itself.
**Rule going forward:** Prefer single-statement enforcement
(updateMany/deleteMany with both id and userId in `where`). When
reviewing the split form, verify no code path reassigns the owning
foreign key and that the body allowlist cannot set it — then record it as
advisory, since the guarantee is global, not local.

## "Inside a transaction" is not "serialized"
**Symptom:** An acceptance criterion asks for read-modify-write inside a
single prisma.$transaction to prevent a race; the code complies and the
test passes sequentially.
**Rule going forward:** A transaction at the default Read Committed level
does not prevent two concurrent unset-then-set flows from both
committing. Confirm the criterion's intent separately from its letter,
and note that uniqueness invariants need a DB constraint (e.g. a partial
unique index) to actually hold.

## A code comment restating an ADR rule can be false against its own file
**Symptom (M3-3a):** `checkoutDraft.ts`'s comment asserted "no region is
ever stored here," eleven lines above the type definition that stores
`region` in the payload — because the ADR itself contradicts its own
spec (Decision 4 says no region; Decision 3's payload shape includes it).
**Rule going forward:** When a comment asserts a negative invariant
("X is never stored/sent/logged here"), check it against the actual
type/code in that same file, not just against the ADR's prose summary —
and check the ADR's own rules section against its own payload/shape
section, since the two can silently disagree with each other.

## Untrusted client-storage values interpolated into relative URL paths
**Symptom (M3-3a):** A module correctly declared its contents
attacker-writable (sessionStorage, devtools-editable) and still handed
one value straight into a template-literal fetch path
(`` `/api/addresses/${savedAddressId}` ``) with no encoding. A
`../`-bearing value normalizes to a different same-origin endpoint.
**Rule going forward:** Grep every consumer of a declared-untrusted
client-side store for template-literal URL construction and require
`encodeURIComponent` around the untrusted segment, even when actual
exploitation would presuppose a separate XSS to write the malicious
value in the first place — defense in depth, not "unreachable so skip
it."

## A fix scoped to "the files I touched" leaves siblings holding the old value
**Symptom (M3-2):** A builder correctly diagnosed that raw-SQL `now()`
implicitly cast to a `timestamp without time zone` column adopts the DB
session's timezone, and fixed every site in the new file they were
writing (`reservationService.ts`) — while the same predicate survived
untouched in the older file the new mechanism depends on
(`cartService.ts:267`) and in `schema.prisma`'s own `dbgenerated()`
default.
**Symptom (M4-2, same class, config edition):** An item whose acceptance
criteria included "resolve the `MPESA_CALLBACK_URL` path mismatch" fixed
`.env.example` and `.env.development` and checked the box — while
`.env.production.kenya` and `docs/DEPLOYMENT.md`'s operator runbook still
carried the old, now-nonexistent callback path. The code's fail-closed
guard only validated "set and https://", so a well-formed URL pointing at
a route that will never exist passes validation and every payment callback
would be silently lost in production.
**Cause:** The fix is scoped to "files I touched," but the invariant is
global to the schema's column types / to every environment file and doc
that names the value.
**Rule going forward:** When a diff fixes a SQL-semantics bug class or an
env-var/URL/path value, grep the *whole repo* for the old pattern —
including `schema.prisma`'s `dbgenerated()` defaults, every `.env.*`
variant (especially the per-region production ones nobody opens), and
`docs/DEPLOYMENT.md`-style runbooks. Check the sign of the skew: an offset
that shortens a TTL in dev may lengthen it in production. And when a
ledger checkbox claims a mismatch is "resolved", verify the claim against
every file carrying the value, not just the two the diff touched.
**Corollary when re-verifying a FIX (M4-2b):** run the same sweep on the
fix itself, not just on the original finding. A coercion/validation fix
gets applied at the one line the finding cited; grep every other call site
of the same primitive (`Number(`/`parseInt`) and read each one's sentinel
before calling the class closed. Confirming the *unchanged* sibling env
files stayed unchanged is part of the re-verification too — "production
didn't need touching" is a claim to check by reading, not to accept.

## Ownership checks land on the parameter that was asked about, not the one that wasn't
**Symptom (M3-2):** A money-path function ownership-checked
`shippingAddressId` flawlessly (because the ADR named it explicitly) while
consuming a `cartId` three lines earlier with no ownership check at all,
despite already having the owning `userId`/`sessionId` in hand from the
locked row.
**Cause:** The ADR enumerated the check for one id; a reviewer verifies
the enumerated ones and the unenumerated sibling parameter is never asked
about.
**Rule going forward:** For every id-shaped parameter on a money or
inventory function, ask independently of the ADR: who can supply this,
and what does the function itself verify about it? Treat "the route layer
will pass a trusted value" as an unenforced contract, not a control —
record it as binding on whichever item builds that route.

## A row created before the transaction is a PII leak on every failure path
**Symptom (M3-3):** A checkout route created an `Address` row holding
customer PII immediately before calling the atomic order transaction, so
every stock/address/conflict error — and every idempotent double-submit
replay, which returns the *first* order — left a permanent, ownerless row
no user-facing API can ever list or delete.
**Cause:** Review attention goes to "does the transaction roll back
correctly," and it does; the un-transacted write sitting one line above it
is not part of the atom being reviewed.
**Rule going forward:** On any money path, list every write that happens
*before* the transaction opens and ask what deletes it when the
transaction throws. Check the idempotent-replay branch too, not just the
error branches — a success response can still orphan a row. Where the row
is created from unauthenticated input, also check the column types for
unbounded `String`/`text` and the validator for missing max lengths.

## A shared validator's extra optional field is silent mass assignment
**Symptom (M3-3):** A route documented its accepted body fields, then
handed the raw object to a shared `validateAddressBody` that also accepts
and returns an `isDefault` flag, spreading `...data` into `create` — so a
field the route never intended to expose became client-settable, bypassing
the unset-previous-default transaction that both sibling routes wrap
around exactly that field, and turning a DB partial-unique violation into
an uncaught 500 on the money path.
**Rule going forward:** When a diff reuses an existing validator on a new
route, diff the validator's returned fields against the route's own
documented body shape. Any field the validator returns that the route's
comment does not list is mass assignment — and check whether the other
callers of that validator wrap the field in extra logic (a transaction, an
index-violation catch) that the new caller skipped.

## A row-selection predicate scoped by parent id but not by provider/type
**Symptom (M4-1):** A payment module's crash-recovery branch selected
`findMany({ where: { orderId } })` and adopted any INITIATED row's id and
idempotency key — correct while only one provider exists, silently
cross-provider-hijacking the moment a second one lands.
**Cause:** The ADR enumerated the scoping key the reviewer would ask about
(orderId) and never mentioned `provider`; a single-provider test suite
cannot distinguish the two.
**Rule going forward:** For any "find the existing attempt row" query on a
money path, check it is scoped by every discriminator the table carries
(provider/type/kind), not just the parent id — and check the branch that
*writes back* (does it stamp a provider-specific id into a row whose
provider column says something else?). **Correct shape, confirmed in
M4-2:** the *blocking* question ("is anyone paying right now") must stay
GLOBAL/unscoped, while *row selection and mutation* must be
provider-scoped. When reviewing a fix for this class, verify both halves
independently and in both directions — a fix that scopes the blocking
query too is a regression that reintroduces double-charging.

## Allowlists that pre-open explicitly out-of-scope regions
**Symptom (M4-1):** A currency allowlist included the two regions the run
state declares out of scope and whose data-residency legal opinion is an
open escalation, justified as "wiring the mechanism testably."
**Rule going forward:** An allowlist entry is itself the control. Treat any
entry for a region/currency the ledger says is out of scope as a finding
(fail-safe default = ship the in-scope value only), even when no code path
can reach it yet — reachability changes silently, allowlists don't get
re-reviewed. The good counter-example is M4-2's M-Pesa route, which
hard-gates on `region === "KE" && currency === "KES"` *before* any network
call — prefer that shape when asking a builder to fix an over-broad list.

## A misconfiguration error wrapped into a security-typed error becomes the wrong HTTP status
**Symptom (M4-1b):** An ADR bound "missing secret -> 500, never 400". The
builder implemented that check for the env var the ADR named, above the
`try` block, and tested it — while a *sibling* env var read by a helper
called *inside* the same `try` threw a plain `Error` that the `catch`
re-wrapped as the security-typed error, producing the 400 the rule
forbade.
**Cause:** Reviews check the named env var; a broad `catch` that
normalizes everything into one error type silently reclassifies unrelated
failure modes, and the passing test for the named var reads as coverage
for the rule.
**Rule going forward:** For any `catch` that re-wraps into a
security-meaningful error type, enumerate every call inside the `try`
that can throw for a NON-security reason (client construction, env
reads, JSON parsing) and confirm each still maps to its intended status.
Hoist config/constructor calls above the `try` rather than trusting the
wrapper.

## A provider-scoped staleness sweep opens a cross-provider double-confirm window
**Symptom (M4-2):** A provider's PENDING attempt row is aged out by a
provider-specific staleness ceiling so the *global* in-flight predicate
stops blocking, letting a second provider's attempt proceed — but the
sibling provider's module correctly refuses to mutate the foreign row, so
it stays PENDING forever. A late callback for the first provider can then
confirm alongside the second provider's confirmation.
**Cause:** "Don't mutate another provider's row" and "age out stale rows so
retries aren't blocked forever" are both individually correct, and the gap
only exists in the intersection — which no single module owns.
**Rule going forward:** Whenever a staleness ceiling lets a payment attempt
bypass an in-flight guard, ask who terminally resolves the bypassed row and
what happens if its outcome arrives late. Make it a binding requirement on
whichever item builds the callback/webhook handler that it re-checks, under
the parent row lock, for an already-CONFIRMED transaction of *any* provider
before confirming.

## A constant duplicated "for test visibility" is a test that agrees with itself
**Symptom (M4-2):** A threshold used by a shared predicate was redeclared
verbatim in the consuming module and exported through a `__TEST_ONLY__`
object so tests could assert against it — but the predicate reads the
original, not the copy. Editing the copy changes what the tests assert
without changing any behaviour.
**Rule going forward:** When a diff exports constants for test convenience,
check the exported symbol is the same binding the production code path
reads, not a same-valued redeclaration. Flag every duplicated
security-relevant threshold (grace windows, staleness ceilings, limits) and
require a re-export/import rather than a second literal.

## Client-settable headers as a rate-limit key defeat the limit for the caller it targets
**Symptom (M4-2):** A route added a rate limit as the named defense against
abusing an optional destination-override field (sending payment prompts to
an arbitrary phone). The key was `userId ?? clientIp`, and the IP came from
the first value of a client-supplied `x-forwarded-for` — so for exactly the
unauthenticated/guest caller the control targets, the bucket key is
attacker-chosen and rotatable.
**Rule going forward:** Read the key-derivation function, not just the
`checkRateLimit` call site. If the fallback branch derives its key from a
request header the client can set, the limit is decorative for that branch.
Require a platform-set header (e.g. `x-vercel-forwarded-for`) or a
server-issued session/cart id instead — and note in the finding that an
in-memory per-instance bucket is additionally weak on serverless.

## A "repo-wide grep found nothing" claim can be blind to gitignored env files
**Symptom (M4-2):** Re-verifying a builder's claim that a stale config
value (`MPESA_CALLBACK_URL`'s old path) no longer appears anywhere in the
repo, a default `grep -rn` came back clean — but `.env.local` and the
`.env.production.*` files most likely to actually hold a live wrong value
are exactly the files `.gitignore` excludes, and ripgrep honors
`.gitignore` by default.
**Rule going forward:** When re-verifying a "grep found nothing" claim
about an env var or secret-adjacent value, grep each gitignored env file
by its explicit path (`.env.local`, `.env*.local`, any `.env.production*`)
in addition to the repo-wide sweep — a clean default grep is not evidence
those files are clean, only that they weren't checked.

## A double-payment detector attached to one status arm misses the arm the other provider actually leaves behind
**Symptom (M4-2b):** A callback handler implements a correct, provider-agnostic
"is another CONFIRMED transaction on this order?" lookup — but only inside the
FAILED/CANCELLED branch, because the ADR specified it there. The cross-provider
double charge actually arrives on a still-PENDING row (the sibling provider's
flow is correctly provider-scoped and never sweeps the foreign row), lands on
the happy path, and is reported with the same benign outcome string as a
webhook redelivery. Both provider variants of the double-payment test pass,
because both seed the row in the one status that is covered.
**Cause:** The staleness ceiling that unblocks the second provider does not
change the first provider's row status. "Which statuses can this row be in when
the late success arrives?" is a different question from "which status does the
ADR's hardest-case section discuss?"
**Rule going forward:** For any late-outcome handler, enumerate every row status
reachable at that moment and confirm the double-payment/other-CONFIRMED lookup
runs on ALL of them, not just the one the ADR narrates. Then check the test's
fixture setup: if every variant of the double-payment test seeds the same
starting status, the uncovered arm is where the bug is. Also treat a shared
outcome string between "benign redelivery" and "two real debits" as a finding in
itself — the ops queue keys on the event, and no event was written.
**When re-verifying the fix (M4-2b, second pass):** a hoisted shared detector
still only runs where it is *called*. Re-walk the switch and list the arms that
return BEFORE reaching it — the two residuals here were (a) an early
"order already CONFIRMED -> duplicate" return sitting above the detector in the
CONFIRMED arm, which loses the signal if a crash lands between the CAS and the
non-atomic event write, and (b) a pre-switch amount-reconciliation branch that
terminates on its own and never consults the detector at all. Also check the
event's idempotency guard uses the SAME payload key the writer emits — a guard
querying the default key against a payload that names it differently never
matches and silently duplicates the event on every redelivery.

## "Safe to commit, it's dev-only" is false whenever the file also documents a public tunnel
**Symptom (M4-2b):** A new authentication secret was committed as a real working
value to a tracked `.env.development`, against the ADR's explicit REPLACE_ME
instruction, with an in-file paragraph arguing it authenticates nothing outside
the dev DB — eleven lines below a comment in the same file explaining that real
callback delivery requires a public ngrok/cloudflared tunnel.
**Cause:** The justification is written about the DB the secret guards, not about
the network path the secret is presented on. The second premise ("tests can't run
with a placeholder") is also usually false — the test file almost always already
assigns process.env directly.
**Rule going forward:** When a diff commits a real value with a justification
comment, check the justification against the rest of that same file (does it
document a tunnel/public endpoint?) and against the test file (does it already
set the env var itself?). Both counter-evidence sources are usually in the diff.
Also confirm the production posture separately: whether the framework loads
`.env.development` in a prod build, and whether the fail-closed guard holds when
the var is unset — the fix is still required, but it changes severity.
**Accepting the fix (M4-2b):** the good shape is a placeholder in the tracked
file plus a per-run generated value in the test setup. Verify three things
before calling it closed: the setup file has no fs *write* (read-only imports
only), the generated value is not logged, and the generation trigger
(`unset || placeholder || too short`) makes the value STRONGER rather than
lowering the production guard's own threshold. Check ordering too — generation
must run after the dotenv load so a developer's real `.env.local` still wins.

## Coercion guards that reject NaN still let falsy values become the success code
**Symptom (M4-2b):** An envelope parser coerced a provider result code with
`Number(...)` and rejected `undefined`/`null`/`NaN` — exactly as its ADR worded
it — while `""`, `" "`, `false` and `[]` all coerce to `0`, which was the
*success* code driving the confirm path on the money path.
**Rule going forward:** Wherever `Number()`/`parseInt` output is compared against
a meaningful sentinel (especially `0` = success), check the falsy-coercion set
explicitly, not just NaN. Require a typeof/trim guard before coercion. An ADR
that says "NaN -> malformed" is not a specification of the empty-string case.
When verifying the fix, walk the whole falsy set against the new predicate by
hand and also check `Infinity` (typeof "number", not NaN, so it passes any
typeof+isNaN guard) — accept it only where the sentinel it produces routes to
the SAFE branch.

## An integrity cross-check is not an authentication control — don't overrate skipping it
**Symptom (M4-2b):** A fix made a callback handler skip a
`merchantRequestId` equality assertion when the provider omits that optional
field (the previous behaviour was a permanent 500/redelivery loop that stranded
a real payment). The obvious reviewer reflex is "an attacker will omit the field
to dodge the check."
**Cause:** Conflating a correlation/consistency assertion with an authorization
factor. The value is not secret, is already known to anyone holding the
envelope, and the caller must already possess the URL secret and a valid
provider transaction id to reach the assertion at all — so omitting it grants
nothing that sending the correct value wouldn't.
**Rule going forward:** Before flagging a skipped check as a bypass, ask what
capability the check actually gates and what an attacker must already hold to
reach it. If the skipped value is non-secret and derivable by anyone who can
reach the code, the skip is not a privilege gain — and a fail-closed loop that
permanently strands real money is the worse failure mode. Confirm separately
that the skip is narrow: the provider/type assertion and the exact-id row
resolution around it must still run unconditionally.

## A falsy-coercion fix must be swept across sibling protocol parsers in the same module
**Symptom (M4-2c):** A new `stkQuery` in the same file as an
already-fixed `parseStkCallback` reproduced the pre-fix `Number()` guard
(typeof + isNaN, no trim), so `""`/`" "` coerced to the success sentinel `0`.
**Cause:** The prior fix was applied at the cited line; the new sibling
function was written from the ADR's mapping table, which said "missing/NaN".
**Rule going forward:** When a module gains a SECOND parser for the same
provider's codes, diff its guard against the already-hardened one in the same
file, line by line. Treat the hardened sibling as the spec, not the ADR prose.
Escalate severity when a companion flag (e.g. an amount-skip) removes the
secondary gate that caught the class last time.

## Per-row try/catch is a per-PASS claim, not a per-file one
**Symptom (M4-2c):** A two-pass batch job wrapped every row body in pass A and
none in pass B; a throw there aborted the run AND skipped the aggregate
ops-money alert, and with `ORDER BY createdAt ASC` one poison row starves the
refund queue forever.
**Rule going forward:** For any multi-pass batch job, check the try/catch
placement in EACH loop separately, and ask what the stable ordering means for
a permanently-failing row. Also check whether the end-of-run aggregate alert
is inside the throw path — losing the alert is worse than losing the row.
When re-verifying such a fix, confirm the aggregate alert is computed from a
fresh global query rather than the in-memory run report — only a fresh query
survives a row that threw mid-run. Also check whether the fixed pass and a
sibling pass that already "happens to pass" enforce resilience at the same
structural level (loop-level catch vs. per-call catches inside the row
function) — the latter holds only by construction and silently regresses on
the next edit; flag it as a non-blocking advisory rather than leaving it
unrecorded.

## A pre-check guard separated from its guarded action by a DB round trip
**Symptom (M5-1a):** A "if zero attempts fit the budget, do not write the
claim" rule was implemented as a `Date.now()` guard immediately above the
claim transaction — but the claim itself is a DB round trip, so the retry
loop's own re-check can fail right after the claim commits, producing exactly
the claim-with-zero-attempts state the rule forbids.
**Cause:** The ADR words the rule as a single decision point; the code has two,
separated by latency the guard doesn't account for.
**Rule going forward:** Whenever a budget/TTL/deadline guard protects an action
that is not the very next statement, measure what sits between them. If it is
I/O, require either a re-check that can undo the intermediate write, or that
the guard subtract the intermediate step's worst-case cost.

## Retry-classification labels drift from the retryable flag they were derived from
**Symptom (M5-1a):** `classifyError` returned `permanent_${status}` for every
HTTP-status-bearing error including retryable 429/5xx, because the permanent
case was the one the ADR's table named. A transient 500 is then durably
recorded as "permanent" in the ops failure row — and the failure-event dedup
guard was keyed on that same reason string.
**Rule going forward:** Where an error carries both a `retryable` boolean and a
human-readable `reason`, check the reason is derived FROM the boolean, not
from a sibling field. Then check what else keys on the reason string (dedup
guards, ops queries) — a mislabel there silently changes grouping too.

## A read page's ownership check can be correct and still load the other tenant's PII
**Symptom (M5-1b):** An order-detail Server Component did findUnique by id
selecting the full shipping address and line items, then compared userId and
called notFound(). Correct — nothing reaches the response — but every
non-owner request materializes another customer's name/phone/street in
server memory, and the two 404 paths (missing id vs. not-yours) pay
different join costs.
**Rule going forward:** Apply the existing "single-statement enforcement"
rule to READS, not just mutations: prefer findFirst({ where: { id, userId } })
over findUnique-then-compare. Record the split form as advisory and check
specifically whether anything between the fetch and the check could log or
serialize the row.

## Prisma's where-undefined footgun turns a scoped list query into a full-table read
**Symptom (M5-1b):** `findMany({ where: { userId: session.user.id } })` is the
correct cross-tenant scoping, but Prisma treats an `undefined` value in a
where clause as "filter absent" — so a session whose user.id was ever
undefined would render every row in the table. TypeScript's non-nullable
typing means the compiler cannot catch a regression here either.
**Rule going forward:** For any tenant-scoping where clause, check the scoping
value cannot be undefined at that line, and prefer an explicit
`if (!session?.user?.id) redirect(...)` guard over relying on the auth
library's typing. "Does not leak" resting on an external library invariant is
weaker than "cannot leak".

## A runtime-derived cookie name can still degrade positionally
**Symptom (M5-1b):** A forged-cookie test correctly avoided hardcoding the
cookie name — but derived it as `split("=")[0]` over a join of ALL Set-Cookie
pairs, i.e. whichever cookie the auth library emits first. If a non-session
cookie ever comes first, middleware's presence check rejects the forged
header and the test silently becomes the no-cookie case, still passing —
because its assertion is byte-identical to the no-cookie test's.
**Rule going forward:** "Derived at runtime, not hardcoded" is necessary but
not sufficient. Also check the derivation SELECTS the session cookie by name
match (contains `session_token`), not by position — and treat a
forged-cookie test whose assertion is identical to the no-cookie test's as
requiring that stronger derivation, since it has no other way to distinguish
the two paths.

## A lossy display formatter extracted into a shared module entrenches the loss
**Symptom (M5-1b):** A new shared `formatMoney` used
`Intl.NumberFormat("en-US")` with no options (minimumFractionDigits defaults
to 0), silently dropping cents from correct Decimal(12,2) snapshot strings,
with a unit test codifying the lossy output. Copied verbatim from four
pre-existing call sites, so it read as following convention — but this was
the first surface showing what the customer was actually CHARGED, and the
sibling email template formats the same order without the loss.
**Rule going forward:** When a diff extracts a duplicated formatter into a
shared module, review the extracted logic on its own merits rather than
accepting "same as the existing call sites" — extraction is the moment the
class gets entrenched and also the cheapest moment to fix it. For money
specifically, check min/maxFractionDigits explicitly and compare the output
against every other surface rendering the same amount (email, receipt, admin).

## A "required tx parameter" does not structurally forbid the top-level client
**Symptom (M5-2a):** An audit-log helper typed its first parameter
`Prisma.TransactionClient` and both the ADR and the ledger claimed a caller
"physically cannot" write outside a transaction. `TransactionClient` is
`Omit<PrismaClient, ITXClientDenyList>`, and a full PrismaClient is
structurally assignable to it — `helper(db, entry)` compiles and runs.
**Cause:** `Omit<>` narrows the callable surface, not the accepted argument;
excess-property checking only applies to object literals. The accompanying
test asserted `fn.length === 2`, which proves arity, not transactionality.
**Rule going forward:** When a diff claims a type signature makes an unsafe
call impossible, read the generated type definition and mentally attempt the
unsafe call. For Prisma specifically, require a runtime discriminator
(`"$transaction" in tx` → throw) plus a test that passes the top-level client
and asserts rejection. Treat `fn.length` assertions as arity guards only.

## A runtime type-discriminator fix must be checked in the failing direction too
**Symptom (M5-2a, re-verify):** A `if ("$transaction" in tx) throw` guard fixes a
real gap, but its correctness rests on a library internal — if Prisma's itx proxy
had omitted the `has` trap, `in` would be true for a GENUINE tx and the guard
would reject every legitimate caller.
**Cause:** Reviewing only "does it catch the bad input" and not "can it reject the
good input", because the finding was framed as a bypass.
**Rule going forward:** For any `in`/`typeof`/`instanceof` discriminator over a
proxied library object, read the library's proxy traps (`has`, not just `get`) and
confirm BOTH directions. Then check which existing tests would catch a future
regression of the false-positive direction — if none exercise the good input, that
is itself a finding.
