#!/usr/bin/env bash
# THE PRODUCTION-READINESS GATE — mechanical, run only by
# production-readiness-gate. This is the ONLY thing allowed to mark a
# ledger item `verified`. No agent, including this one, self-certifies by
# opinion — every check below is a real command and a real exit code.
#
# Usage: scripts/agents/gate-check.sh <ledger-item-id>
#
# GREEN (exit 0) requires ALL of:
#   1. build exits 0
#   2. lint exits 0
#   3. full test suite exits 0 AND coverage >= threshold (via `npm run
#      test:coverage`, which must be configured to fail below threshold —
#      see FEATURES.md M0 item "coverage threshold configured")
#   4. the dogfood entrypoint exits 0 (scripts/agents/dogfood.mjs)
#   5. a security sign-off file exists for this item with STATUS: CLEAR
#      (docs/agents/security-signoff/<item-id>.md), written only by
#      security-reviewer — this agent does not review security itself.
#
# Any failure prints which check failed and stops. RED on the same root
# cause twice in a row is a HALT-AND-ESCALATE condition per the loop
# contract in docs/agents/README.md — this script only reports; the
# orchestrator owns the escalate decision.

set -uo pipefail
cd "$(dirname "$0")/../.."

ITEM_ID="${1:-}"
if [ -z "$ITEM_ID" ]; then
  echo "[gate] usage: gate-check.sh <ledger-item-id>"
  exit 2
fi

FAILED=0

check() {
  local label="$1"; shift
  echo "[gate] ${label}..."
  if "$@"; then
    echo "[gate] GREEN: ${label}"
  else
    echo "[gate] RED: ${label}"
    FAILED=1
  fi
}

check "build" npm run build
check "lint" npm run lint

if npm run | grep -q "test:coverage"; then
  check "test + coverage threshold" npm run test:coverage
else
  echo "[gate] RED: test:coverage — script not defined in package.json yet (M0 item: configure coverage threshold)"
  FAILED=1
fi

check "dogfood entrypoint (real user flow)" node scripts/agents/dogfood.mjs

SIGNOFF="docs/agents/security-signoff/${ITEM_ID}.md"
if [ -f "$SIGNOFF" ] && grep -q "^STATUS: CLEAR$" "$SIGNOFF"; then
  echo "[gate] GREEN: security sign-off (${SIGNOFF})"
else
  echo "[gate] RED: security sign-off missing or not CLEAR (${SIGNOFF})"
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "[gate] === ALL GREEN — ${ITEM_ID} may be marked verified ==="
  exit 0
else
  echo "[gate] === RED — ${ITEM_ID} stays not-verified. Do not self-certify. ==="
  exit 1
fi
