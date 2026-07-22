#!/usr/bin/env bash
# scripts/check-fix-only-promote.sh
#
# SEC-77 (finding: auto-promote doc/code drift → machine-checked fix-only gate).
#
# Converts the previously PROCEDURAL "fix-only" gate on the production
# auto-promote path into a MACHINE-ENFORCED one.
#
# Background: promote-to-production.yml (beta -> main) is dispatched two ways
# that share the same workflow:
#   * MANUAL feature releases — Luisa dispatches with a typed "PRODUCTION"
#     confirm. Her sign-off IS the authorisation; features are expected.
#   * AUTO fix-only releases — the SEC-22 weekly health/regression routine MAY
#     auto-promote, but ONLY when every change pending on beta ahead of main is
#     a bug-FIX, never a feature (owner-authorised 2026-06-21; see CLAUDE.md ->
#     Deployment Pipeline and docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md).
#
# Until now the "every pending change is a fix" condition was enforced only by
# the routine-agent's judgement. This script makes the workflow itself verify
# the claim: in auto-fix-only mode it inspects every commit in the promote
# range and HARD-FAILS if any is a feature (or anything that is not an
# unambiguous non-feature change). A hard fail here means "stop the auto-promote
# and require manual sign-off" — exactly the policy's prescribed fallback, so a
# false positive is SAFE (it only forces a human) while a false negative (a
# feature slips through to a minors' platform unattended) is the dangerous case
# we bias hard against.
#
# Usage:
#   check-fix-only-promote.sh <mode>
#     <mode>  promote mode. Anything other than "auto-fix-only" is treated as a
#             manual promote and the gate is a no-op (exit 0) — manual releases
#             are gated by Luisa's typed-confirm sign-off, not by this script.
#
# Range: BASE..HEAD, defaulting to origin/main..origin/beta. Overridable via the
# BASE / HEAD env vars purely so the unit tests can drive crafted histories.
#
# Classification (conventional-commit type of each NON-merge commit subject):
#   * merge commits (>=2 parents) are structural and skipped — their semantic
#     content is represented by the non-merge commits they introduce.
#   * type in the NON-FEATURE allow-list below -> OK.
#   * type "feat", any breaking change ("<type>!:"), OR any subject without a
#     recognised non-feature conventional prefix -> VIOLATION (stop).
#
# The allow-list is deliberately the single policy knob. It errs toward
# STRICT: perf/refactor are treated as feature-class (they can change runtime
# behaviour) so they force manual sign-off. Widen or narrow it only as a
# reviewed policy decision.
set -euo pipefail

MODE="${1:-manual}"

if [ "$MODE" != "auto-fix-only" ]; then
  echo "Promote mode '${MODE}': fix-only auto-promote guard not applicable."
  echo "Manual production promotes are gated by the typed-confirm sign-off (Type \"PRODUCTION\"), not by this guard."
  exit 0
fi

BASE="${BASE:-origin/main}"
HEAD="${HEAD:-origin/beta}"

# Non-feature conventional-commit types permitted in an auto-fix-only promote.
# Everything else (notably "feat", any breaking "!", and unrecognised subjects)
# is a violation. See header note on the strict bias.
ALLOWED_TYPES="fix revert docs chore ci build test style"

if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo "::error::check-fix-only-promote: base ref '$BASE' not found — cannot verify the promote range. Refusing (fail-closed)."
  exit 1
fi
if ! git rev-parse --verify --quiet "$HEAD" >/dev/null; then
  echo "::error::check-fix-only-promote: head ref '$HEAD' not found — cannot verify the promote range. Refusing (fail-closed)."
  exit 1
fi

# Non-merge commits in BASE..HEAD, hashes only (subjects fetched per-hash so a
# subject containing '|' or newlines can't desync the parse).
mapfile -t COMMITS < <(git rev-list --no-merges "${BASE}..${HEAD}")

if [ "${#COMMITS[@]}" -eq 0 ]; then
  echo "::error::check-fix-only-promote: no non-merge commits in ${BASE}..${HEAD} — nothing to auto-promote. Refusing an empty auto-promote (fail-closed)."
  exit 1
fi

VIOLATIONS=0
echo "Auto-fix-only promote gate: inspecting ${#COMMITS[@]} non-merge commit(s) in ${BASE}..${HEAD}"
echo ""

for sha in "${COMMITS[@]}"; do
  subject="$(git show -s --format=%s "$sha")"
  short="${sha:0:8}"

  # Parse a conventional-commit type: leading word, optional (scope), optional
  # '!' (breaking), then ':'. Case-insensitive on the type word.
  if [[ "$subject" =~ ^([a-zA-Z]+)(\([^\)]*\))?(!)?: ]]; then
    type="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
    breaking="${BASH_REMATCH[3]}"
  else
    type=""
    breaking=""
  fi

  if [ -z "$type" ]; then
    echo "::error::  ✗ ${short}: no conventional-commit type — ambiguous, cannot confirm it is a fix: ${subject}"
    VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi

  if [ -n "$breaking" ]; then
    echo "::error::  ✗ ${short}: breaking change (${type}!:) is not a plain fix: ${subject}"
    VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi

  if [ "$type" = "feat" ]; then
    echo "::error::  ✗ ${short}: feature (feat) — features must not auto-promote to production: ${subject}"
    VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi

  allowed=0
  for a in $ALLOWED_TYPES; do
    [ "$type" = "$a" ] && allowed=1 && break
  done

  if [ "$allowed" -eq 1 ]; then
    echo "  ✓ ${short}: ${type} — ${subject}"
  else
    echo "::error::  ✗ ${short}: type '${type}' is not in the fix-only allow-list (${ALLOWED_TYPES}) — treat as non-fix, require manual sign-off: ${subject}"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

echo ""
if [ "$VIOLATIONS" -eq 0 ]; then
  echo "✓ All ${#COMMITS[@]} pending commit(s) are fix-only — auto-promote may proceed."
  exit 0
fi

echo "::error::check-fix-only-promote: ${VIOLATIONS} non-fix change(s) in ${BASE}..${HEAD}. Auto-promote to production is BLOCKED — this release requires manual sign-off (dispatch promote-to-production.yml without promote_mode=auto-fix-only)."
exit 1
