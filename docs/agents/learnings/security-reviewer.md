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
