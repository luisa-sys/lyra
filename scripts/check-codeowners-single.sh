#!/usr/bin/env bash
# scripts/check-codeowners-single.sh
#
# SEC-3 (GOV-01): guard the CODEOWNERS single-source-of-truth invariant.
#
# GitHub looks for a CODEOWNERS file in three locations, in this order:
#   1. .github/CODEOWNERS
#   2. CODEOWNERS   (repository root)
#   3. docs/CODEOWNERS
# It uses ONLY the FIRST file it finds and SILENTLY IGNORES the others. So if
# two CODEOWNERS files exist, the lower-precedence one is dead: its ownership
# rules never take effect, yet it reads as authoritative. That is exactly what
# happened before 2026-07-13 — a detailed per-path root /CODEOWNERS was being
# ignored because .github/CODEOWNERS held only `* @luisa-sys`, so the audit's
# "second pair of eyes" per-path scrutiny never actually applied.
#
# This check fails the PR if:
#   * more than one CODEOWNERS file exists (shadowing / dead rules), or
#   * no CODEOWNERS file exists, or
#   * the effective (winning) CODEOWNERS lacks a default-owner `* @owner` line.
#
# Usage: check-codeowners-single.sh [REPO_ROOT]
#   REPO_ROOT defaults to the repository root inferred from this script's path.

set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# Candidate locations in GitHub's precedence order (first found wins).
CANDIDATES=".github/CODEOWNERS CODEOWNERS docs/CODEOWNERS"

FOUND=""
COUNT=0
for c in $CANDIDATES; do
  if [ -f "$ROOT/$c" ]; then
    FOUND="$FOUND $c"
    COUNT=$((COUNT + 1))
  fi
done

if [ "$COUNT" -eq 0 ]; then
  echo "::error::No CODEOWNERS file found (looked in .github/, root, docs/). SEC-3 requires one."
  exit 1
fi

if [ "$COUNT" -gt 1 ]; then
  echo "::error::Multiple CODEOWNERS files found:${FOUND}."
  echo "::error::GitHub uses only the first (.github/ > root > docs/) and SILENTLY IGNORES the rest,"
  echo "::error::so the lower-precedence file's rules are dead. Keep exactly ONE CODEOWNERS."
  echo "::error::Consolidate into .github/CODEOWNERS and delete the others. See SEC-3 / GOV-01."
  exit 1
fi

# The single winning file.
WINNER="$(echo "$FOUND" | tr -s ' ' | sed 's/^ //')"
WINNER_PATH="$ROOT/$WINNER"

# It must declare a default owner (a `*` pattern with at least one @owner),
# otherwise most of the tree has no code owner at all.
if ! grep -qE '^[[:space:]]*\*[[:space:]]+@[A-Za-z0-9]' "$WINNER_PATH"; then
  echo "::error::$WINNER has no default-owner line (expected: '* @owner'). SEC-3 requires a catch-all owner."
  exit 1
fi

echo "CODEOWNERS single-source-of-truth OK — exactly one file ($WINNER) with a default owner. ✓"
