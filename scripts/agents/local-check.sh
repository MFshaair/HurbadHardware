#!/usr/bin/env bash
# PRE-HANDOFF HOOK — mechanical, not a charter suggestion.
#
# The orchestrator runs this BEFORE accepting any builder agent's work for
# handoff to Security/QA/Gate. Non-zero exit = handoff REJECTED, work is
# bounced back to the agent that produced it. This is what makes "agents
# must self-check before handoff" an enforced gate instead of a hope.
#
# Usage:
#   scripts/agents/local-check.sh                # build + lint + full test
#   scripts/agents/local-check.sh "<vitest -t pattern>"   # build + lint + narrow unit test
#
# Exit code is the single source of truth. No output parsing, no opinions.

set -euo pipefail
cd "$(dirname "$0")/../.."

PATTERN="${1:-}"

echo "[local-check] build..."
npm run build

echo "[local-check] lint..."
npm run lint

if [ -n "$PATTERN" ]; then
  echo "[local-check] narrow unit test: $PATTERN"
  npx vitest run -t "$PATTERN"
else
  echo "[local-check] full test suite (npm test)..."
  npm test
fi

echo "[local-check] PASS"
