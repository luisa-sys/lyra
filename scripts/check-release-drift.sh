#!/usr/bin/env bash
# scripts/check-release-drift.sh
#
# KAN-173: compute develop→main drift and produce a one-line status
# (🟢/🟡/🔴) plus a structured key=value output that the weekly report's
# Section 15 can ingest without re-doing the math.
#
# Output format (stdout):
#   commits_ahead=<N>
#   days_since_last_commit=<D>
#   status=<green|yellow|red>
#   summary=<one-line human-readable summary>
#
# Exit codes:
#   0  green or yellow
#   1  red (drift exceeded threshold)
#   2  unable to compute (e.g. main not fetched)
#
# The KAN-167 lesson applies: this script must distinguish "could not
# compute" (exit 2, status=unknown) from "0 commits ahead" (exit 0,
# status=green) — never silently report a clean zero.

set -euo pipefail

DEVELOP_REF="${DEVELOP_REF:-origin/develop}"
MAIN_REF="${MAIN_REF:-origin/main}"

# Verify both refs exist before computing anything.
if ! git rev-parse --verify "$DEVELOP_REF" >/dev/null 2>&1; then
  echo "commits_ahead=DATA_UNAVAILABLE"
  echo "days_since_last_commit=DATA_UNAVAILABLE"
  echo "status=unknown"
  echo "summary=$DEVELOP_REF not found — fetch develop before running"
  exit 2
fi
if ! git rev-parse --verify "$MAIN_REF" >/dev/null 2>&1; then
  echo "commits_ahead=DATA_UNAVAILABLE"
  echo "days_since_last_commit=DATA_UNAVAILABLE"
  echo "status=unknown"
  echo "summary=$MAIN_REF not found — fetch main before running"
  exit 2
fi

COMMITS_AHEAD=$(git rev-list --count "$MAIN_REF..$DEVELOP_REF")
LAST_COMMIT_TS=$(git log -1 --format=%ct "$DEVELOP_REF")
NOW_TS=$(date +%s)
DAYS_SINCE=$(( (NOW_TS - LAST_COMMIT_TS) / 86400 ))

# Threshold logic from KAN-173 description:
#   green  : < 5 commits ahead AND < 3 days since last commit
#   yellow : < 15 commits ahead AND < 7 days since last commit
#   red    : ≥ 15 commits ahead OR ≥ 7 days since last commit
if [ "$COMMITS_AHEAD" -ge 15 ] || [ "$DAYS_SINCE" -ge 7 ]; then
  STATUS="red"
  EXIT=1
elif [ "$COMMITS_AHEAD" -ge 5 ] || [ "$DAYS_SINCE" -ge 3 ]; then
  STATUS="yellow"
  EXIT=0
else
  STATUS="green"
  EXIT=0
fi

SUMMARY="develop is $COMMITS_AHEAD commits / $DAYS_SINCE days ahead of main ($STATUS)"

echo "commits_ahead=$COMMITS_AHEAD"
echo "days_since_last_commit=$DAYS_SINCE"
echo "status=$STATUS"
echo "summary=$SUMMARY"

exit $EXIT
