#!/usr/bin/env bash
#
# doc-sync-healthcheck.sh — health-check for the KAN-249 Confluence doc-sync job
# (the weekday automation that keeps the 7-page TWC doc tree in step with the two
# repos' main branches). See docs/DOC_SYNC_HEALTHCHECK_ROUTINE.md for the full
# routine; this script is the DETERMINISTIC comparison + day-of-week half.
#
# The agent reads the Doc Sync Log (Confluence page 19922947) for the RECORDED
# SHAs and gets the REAL main SHAs via the GitHub connector, then passes all four
# here. If the real SHAs are omitted, the script fetches them from the public
# GitHub API (the repos are public) and reports UNVERIFIED if it can't.
#
# Usage:
#   bash scripts/doc-sync-healthcheck.sh <rec_lyra> <rec_mcp> [<real_lyra> <real_mcp>]
#   (SHAs may be short or full; comparison is case-insensitive on the first 8.)
#
# Output: PASS / OK / FAIL / UNVERIFIED lines + a structured summary.
# Exit: 2 if any FAIL; 1 if any UNVERIFIED; 0 on PASS/OK.
#
# NB: `set -e` is off — we run every check and aggregate; nothing is swallowed.
set -uo pipefail

REC_LYRA="${1:-}"; REC_MCP="${2:-}"
REAL_LYRA_ARG="${3:-}"; REAL_MCP_ARG="${4:-}"
DOW="$(date -u +%A)"; TODAY="$(date -u +%Y-%m-%d)"
LYRA_REPO="luisa-sys/lyra"; MCP_REPO="luisa-sys/lyra-mcp-server"

is_weekend() { case "$DOW" in Saturday|Sunday) return 0 ;; *) return 1 ;; esac; }
norm() { printf '%s' "${1:-}" | tr 'A-Z' 'a-z' | cut -c1-8; }

# Fetch the real main short-SHA via the public GitHub API (no token; repos are
# public). Prints an 8-char sha, or "UNVERIFIED" if unreachable / non-200.
real_sha() { # $1 = owner/repo
  local body code
  body="$(curl -sS -w '\n%{http_code}' --max-time 20 \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$1/commits/main" 2>/dev/null)" || { printf 'UNVERIFIED'; return; }
  code="$(printf '%s' "$body" | tail -n1)"
  if [ "$code" != "200" ]; then printf 'UNVERIFIED'; return; fi
  printf '%s' "$body" | sed '$d' \
    | grep -oE '"sha"[[:space:]]*:[[:space:]]*"[0-9a-f]{40}"' | head -1 \
    | grep -oE '[0-9a-f]{40}' | cut -c1-8
}

FAIL=0; UNV=0
echo "# doc-sync-healthcheck $TODAY ($DOW)"

if [ -z "$REC_LYRA" ] || [ -z "$REC_MCP" ]; then
  echo "UNVERIFIED	args	recorded SHAs not supplied — agent must pass them from Confluence page 19922947"
  UNV=$((UNV+1))
fi

check_repo() { # $1 label $2 repo $3 recorded $4 real-or-empty
  local label="$1" repo="$2" rec real
  rec="$(norm "$3")"
  if [ -n "$4" ]; then real="$(norm "$4")"; else real="$(real_sha "$repo")"; fi
  if [ "$real" = "unverifi" ] || [ "$real" = "UNVERIFIED" ]; then
    echo "UNVERIFIED	$label	could not determine real main SHA for $repo (pass it from the GitHub connector, or allowlist api.github.com)"
    UNV=$((UNV+1)); return
  fi
  if [ -z "$rec" ]; then
    echo "UNVERIFIED	$label	real main=$real but no recorded SHA to compare"
    UNV=$((UNV+1)); return
  fi
  if [ "$real" = "$rec" ]; then
    echo "PASS	$label	in sync (recorded=$rec == real main=$real)"
  elif is_weekend; then
    echo "OK	$label	real main=$real AHEAD of recorded=$rec, but today is $DOW — job runs weekdays, so this is expected until the next weekday run (verify it documents the new commit)"
  else
    echo "FAIL	$label	real main=$real AHEAD of recorded=$rec on a weekday — doc-sync missed/stalled on a commit, or has not run for the most recent expected day"
    FAIL=$((FAIL+1))
  fi
}

check_repo lyra "$LYRA_REPO" "$REC_LYRA" "$REAL_LYRA_ARG"
check_repo mcp  "$MCP_REPO"  "$REC_MCP"  "$REAL_MCP_ARG"

echo "# NOTE: the agent must separately confirm (Atlassian connector) that page"
echo "#       19955714 still lists lyra_update_school AND lyra_update_manual_of_me,"
echo "#       and that the most recent EXPECTED weekday run added a fresh log row."

echo "# ---"
echo "# summary	FAIL=$FAIL	UNVERIFIED=$UNV	day=$DOW"
if [ "$FAIL" -gt 0 ]; then echo "# RESULT: FAIL"; exit 2; fi
if [ "$UNV" -gt 0 ]; then echo "# RESULT: UNVERIFIED"; exit 1; fi
if is_weekend; then echo "# RESULT: OK (weekend — job idle)"; else echo "# RESULT: PASS"; fi
exit 0
