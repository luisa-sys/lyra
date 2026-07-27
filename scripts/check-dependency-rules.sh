#!/usr/bin/env bash
# scripts/check-dependency-rules.sh
#
# KAN-425 (Modular Architecture, Phase 0 / F3): run the three structural
# dependency rules defined in .dependency-cruiser.cjs as a CI gate.
#
#   no-module-to-app        nothing under src/lib/** may import src/app/**
#   no-cross-segment-app/*  one src/app segment may not import another
#   no-circular             no import cycles
#
# ROLL-OUT: the gate ships at severity `warn` — violations are printed and
# annotated, the build stays green — and flips to `error` (blocking) once the
# outstanding findings are cleared and develop has been clean for a week. Set
# DEPCRUISE_SEVERITY=error to flip it (that is the ONLY intended change; never
# weaken a rule's definition to make the gate pass).
#
# FAIL-CLOSED (Workflow & Backup Integrity Policy). A gate that cannot run must
# fail the build, never pass quietly. dependency-cruiser exits non-zero both
# when it finds error-severity violations AND when it cannot start (bad config,
# missing binary, parse error), so this script distinguishes the two by checking
# for the run-summary line that only a completed cruise emits. This script uses
# no error-swallowing fallback and no missing-secret conditional, so there is no
# path on which it can skip silently and still report success.
#
# Usage:
#   bash scripts/check-dependency-rules.sh              # warn mode (default)
#   DEPCRUISE_SEVERITY=error bash scripts/check-dependency-rules.sh
#   DEPCRUISE_TARGET=src bash scripts/check-dependency-rules.sh

set -euo pipefail

SEVERITY="${DEPCRUISE_SEVERITY:-warn}"
TARGET="${DEPCRUISE_TARGET:-src}"
CONFIG="${DEPCRUISE_CONFIG:-.dependency-cruiser.cjs}"

if [ "$SEVERITY" != "warn" ] && [ "$SEVERITY" != "error" ]; then
  echo "::error::DEPCRUISE_SEVERITY must be 'warn' or 'error' (got '$SEVERITY')."
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "::error::Dependency-rule config '$CONFIG' not found. The gate cannot run — failing closed (KAN-425)."
  exit 1
fi

# Resolve the dependency-cruiser binary. `npx --no-install` alone resolves only
# against the CURRENT directory's node_modules, which breaks when the tree being
# cruised is not the package root (the guard's own fixture tests do exactly
# that). Prefer an explicit override, then one already on PATH, then npx. If
# none resolves, the command below fails and we fail closed — never skip.
DEPCRUISE_BIN="${DEPCRUISE_BIN:-}"
if [ -z "$DEPCRUISE_BIN" ]; then
  if command -v depcruise >/dev/null 2>&1; then
    DEPCRUISE_BIN="depcruise"
  else
    DEPCRUISE_BIN="npx --no-install depcruise"
  fi
fi

echo "Dependency-rule gate (KAN-425) — severity=$SEVERITY, target=$TARGET"

# Capture output and exit code without letting `set -e` abort us first; we need
# to inspect both to tell "found violations" apart from "could not run".
set +e
output="$(DEPCRUISE_SEVERITY="$SEVERITY" $DEPCRUISE_BIN "$TARGET" \
  --config "$CONFIG" --output-type err 2>&1)"
depcruise_status=$?
set -e

printf '%s\n' "$output"

# A completed cruise always prints a summary line, e.g.
#   "x 5 dependency violations (0 errors, 5 warnings). 276 modules, 547 dependencies cruised."
#   "✔ no dependency violations found (276 modules, 547 dependencies cruised)"
# If that marker is absent, dependency-cruiser did not complete — fail closed
# regardless of severity.
if ! printf '%s' "$output" | grep -qE 'dependencies cruised'; then
  echo ""
  echo "::error::dependency-cruiser did not complete (exit $depcruise_status) — no cruise summary in its output."
  echo "::error::Failing closed: the dependency-rule gate must never pass silently when it cannot run. See KAN-425."
  exit 1
fi

if [ "$depcruise_status" -ne 0 ]; then
  echo ""
  echo "::error::Dependency-rule violations at severity 'error' — see the list above (KAN-425)."
  echo "::error::Fix the offending import, or move the shared code to src/lib/. Do NOT relax the rule."
  exit "$depcruise_status"
fi

# Exit 0 path. In warn mode there may still be violations printed above; surface
# them as GitHub warnings so they are visible in the run summary rather than
# buried in the log, but do not block.
if printf '%s' "$output" | grep -qE '^\s*warn '; then
  # Safe under `set -e`: we are inside the branch where grep -q already matched,
  # so grep -c has at least one hit and cannot exit non-zero — hence no
  # error-swallowing fallback is needed here, and none is used.
  count="$(printf '%s\n' "$output" | grep -cE '^\s*warn ')"
  echo ""
  echo "::warning::$count dependency-rule violation(s) reported at severity 'warn' (non-blocking, KAN-425)."
  echo "::warning::These are findings, not noise. They must be cleared before the gate flips to 'error'."
else
  echo ""
  echo "No dependency-rule violations. ✓"
fi

exit 0
