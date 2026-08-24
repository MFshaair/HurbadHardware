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
