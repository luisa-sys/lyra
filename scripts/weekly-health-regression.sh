#!/usr/bin/env bash
#
# weekly-health-regression.sh — run Lyra's regression / E2E / build suite and
# emit a single honest PASS / FAIL / UNVERIFIED summary.
#
# READ-ONLY w.r.t. infra: it runs tests and the build only. It NEVER deploys,
# pushes, promotes, or merges — those are the wrapping routine's job, and the
# production promote stays a MANUAL gate (CLAUDE.md: "production … always manual
# — never automated"). See docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md.
#
# A phase whose tooling/deps are missing is UNVERIFIED (loud), never a silent
# green pass (Workflow & Backup Integrity Policy). A failing phase is FAIL — and
# the fix is NEVER to weaken/skip a test (Test Integrity Policy).
#
# Usage: bash scripts/weekly-health-regression.sh
# Env:
#   RUN_E2E=1   also run integration + Playwright E2E (need deps + browsers; E2E
#               needs a reachable target).
#   PHASES="…"  override the phase list (default: lint type-check unit scripts build).
#
# Exit: 2 if any phase FAILs; 1 if any UNVERIFIED and no FAIL; 0 if all PASS.
#
# NB: `set -e` is off — we run EVERY phase and aggregate; nothing is swallowed.
set -uo pipefail

PASS=0; FAIL=0; UNV=0
PHASES="${PHASES:-lint type-check unit scripts build}"
[ "${RUN_E2E:-0}" = "1" ] && PHASES="$PHASES integration e2e"

record() { # $1=STATUS $2=label $3=detail
  printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}"
  case "$1" in PASS) PASS=$((PASS+1)) ;; FAIL) FAIL=$((FAIL+1)) ;; UNVERIFIED) UNV=$((UNV+1)) ;; esac
}

cmd_for() { case "$1" in
  lint)        echo "npm run lint" ;;
  type-check)  echo "npm run type-check" ;;
  unit)        echo "npm run test:unit" ;;
  scripts)     echo "npm run test:scripts" ;;
  integration) echo "npm run test:integration" ;;
  e2e)         echo "npm run test:e2e" ;;
  build)       echo "npm run build" ;;
  *)           echo "" ;;
esac; }

echo "# weekly-health-regression $(date -u +%Y-%m-%dT%H:%M:%SZ)  phases: $PHASES"

[ -f package.json ] || record UNVERIFIED repo "no package.json in $(pwd) — wrong dir/branch? (did you checkout develop?)"
[ -d node_modules ] || record UNVERIFIED deps "node_modules missing — run 'npm ci' (and 'npx playwright install' for E2E) in the setup script first"

run_phase() { # $1 label
  local label="$1" c rc log; c="$(cmd_for "$label")"
  [ -z "$c" ] && { record UNVERIFIED "$label" "no command mapped"; return; }
  [ -d node_modules ] || { record UNVERIFIED "$label" "skipped — deps not installed"; return; }
  log="$(mktemp)"
  if $c >"$log" 2>&1; then
    record PASS "$label" "ok"
  else
    rc=$?
    record FAIL "$label" "exit $rc — $(tail -n 3 "$log" | tr '\n' ' ' | cut -c1-300)"
  fi
  rm -f "$log"
}

for p in $PHASES; do run_phase "$p"; done

echo "# ---"
echo "# summary	PASS=$PASS	FAIL=$FAIL	UNVERIFIED=$UNV"
if [ "$FAIL" -gt 0 ]; then
  echo "# RESULT: FAIL — fix the failing phase(s) at the SOURCE; never weaken/skip a test to go green (Test Integrity Policy)"
  exit 2
fi
if [ "$UNV" -gt 0 ]; then
  echo "# RESULT: UNVERIFIED — install deps / set a target and re-run; do not treat as a pass"
  exit 1
fi
echo "# RESULT: PASS"
exit 0
