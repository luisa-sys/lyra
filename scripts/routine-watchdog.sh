#!/usr/bin/env bash
#
# routine-watchdog.sh — deterministic, READ-ONLY missed/failed-run detector for
# the Lyra ops routines (KAN-362, part of the KAN-350 routines refactor).
#
# It answers ONE question per routine: "has this routine produced a fresh,
# successful heartbeat within its own cadence + grace?" It does NOT run any
# routine, does NOT write anything, and does NOT reach the network itself —
# the agent (the Daily Security routine) feeds it the last-heartbeat timestamp
# it read from the Ops Routines Control Room Heartbeat table on Confluence,
# plus the last GitHub Actions run conclusions from `gh run list`.
#
# Input model — one CHECK per routine, passed as a positional argument of the
# form (fields are PIPE-delimited so ISO-8601 timestamps keep their colons):
#   <name>|<max_age_minutes>|<last_iso8601_or_->|<last_outcome>[|<weekday_only>]
#
#   name           routine label (no pipes), e.g. daily-security
#   max_age_minutes cadence + grace in minutes; a heartbeat older than this is
#                   OVERDUE. e.g. a daily routine with 6h grace = 1800.
#   last_iso8601    the last heartbeat/run timestamp in UTC ISO-8601
#                   (e.g. 2026-07-04T07:12:00Z). Use "-" if UNKNOWN — the
#                   watchdog then reports UNVERIFIED (never a silent PASS).
#   last_outcome    PASS | FAIL | UNVERIFIED | UNKNOWN (case-insensitive).
#                   FAIL forces a FAIL row regardless of freshness. UNKNOWN/-
#                   (or unparseable) is UNVERIFIED.
#   weekday_only    optional; "weekday" or "1" means the routine only runs
#                   Mon–Fri, so an overdue heartbeat on Sat/Sun is OK (grace),
#                   mirroring doc-sync-healthcheck.sh's weekend-grace idea.
#
#   Example: 'daily-security|1800|2026-07-04T07:00:00Z|PASS'
#
# Output: one tab-separated line per routine — "<STATUS>\t<name>\t<detail>" —
# STATUS ∈ PASS | FAIL | UNVERIFIED. Then a machine-readable summary line.
#
# Exit: 2 if ANY routine is FAIL or critically OVERDUE; 1 if any UNVERIFIED and
# no FAIL; 0 if every routine is fresh + PASS. This matches the exit-code
# discipline of daily-security-check.sh / doc-sync-healthcheck.sh.
#
# NB: `set -e` is intentionally OFF — we evaluate EVERY routine and aggregate.
# Nothing is silently skipped or swallowed (Workflow & Backup Integrity Policy):
# a routine we cannot evaluate (missing/garbled timestamp) is UNVERIFIED, never
# a green PASS and never a false FAIL. There are no `|| true` guards.
set -uo pipefail

NOW_ISO="${WATCHDOG_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

# Day-of-week is derived from NOW_ISO so it stays consistent with the clock we
# are actually reasoning about (and so WATCHDOG_NOW makes the whole run
# deterministic for tests). Fall back to the live day only if NOW_ISO can't be
# parsed for a weekday — never silently default to a wrong day.
dow_of() { # $1 = iso8601 ; prints %A or empty
  local iso="$1" d=""
  d="$(date -u -d "$iso" +%A 2>/dev/null)" && { printf '%s' "$d"; return 0; }
  d="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%A 2>/dev/null)" && { printf '%s' "$d"; return 0; }
  d="$(date -u -j -f '%Y-%m-%dT%H:%MZ' "$iso" +%A 2>/dev/null)" && { printf '%s' "$d"; return 0; }
  printf ''
}
DOW="$(dow_of "$NOW_ISO")"
[ -n "$DOW" ] || DOW="$(date -u +%A)"

# Parse an ISO-8601 UTC timestamp to epoch seconds. Prints the epoch on stdout,
# or nothing (empty) if it can't be parsed. Tries GNU date, then BSD date.
# No `|| true` — the empty result is the explicit "unparseable" signal the
# caller checks for.
to_epoch() { # $1 = iso8601
  local iso="$1" e=""
  e="$(date -u -d "$iso" +%s 2>/dev/null)" && { printf '%s' "$e"; return 0; }
  e="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null)" && { printf '%s' "$e"; return 0; }
  # Some inputs omit seconds (…T07:12Z); try that BSD form too.
  e="$(date -u -j -f '%Y-%m-%dT%H:%MZ' "$iso" +%s 2>/dev/null)" && { printf '%s' "$e"; return 0; }
  printf ''
}

is_weekend() { case "$DOW" in Saturday|Sunday) return 0 ;; *) return 1 ;; esac; }

lower() { printf '%s' "${1:-}" | tr 'A-Z' 'a-z'; }

FAIL=0; UNV=0; PASS=0
echo "# routine-watchdog $NOW_ISO ($DOW)"

if [ "$#" -eq 0 ]; then
  echo "UNVERIFIED	args	no routine checks supplied — pass '<name>|<max_age_min>|<last_iso|->|<outcome>[|weekday]' per routine"
  echo "# ---"
  echo "# summary	PASS=0	FAIL=0	UNVERIFIED=1	day=$DOW"
  echo "# RESULT: UNVERIFIED"
  exit 1
fi

NOW_EPOCH="$(to_epoch "$NOW_ISO")"
if [ -z "$NOW_EPOCH" ]; then
  # We cannot compute ages at all — refuse to emit any PASS. Everything is
  # UNVERIFIED. This is a hard, honest degradation, not a crash.
  echo "UNVERIFIED	clock	could not parse current time '$NOW_ISO' — cannot compute ages"
  echo "# ---"
  echo "# summary	PASS=0	FAIL=0	UNVERIFIED=1	day=$DOW"
  echo "# RESULT: UNVERIFIED"
  exit 1
fi

check_one() { # $1 = the raw <name>|<max>|<last>|<outcome>[|weekday] token
  local raw="$1"
  local name max last outcome weekday
  IFS='|' read -r name max last outcome weekday <<EOF
$raw
EOF
  name="${name:-<unnamed>}"

  # Guard the numeric cadence — a non-integer is a config error, UNVERIFIED.
  if ! printf '%s' "${max:-}" | grep -qE '^[0-9]+$'; then
    echo "UNVERIFIED	$name	bad max_age_minutes '${max:-}' — expected an integer (config error in the registry token)"
    UNV=$((UNV+1)); return
  fi

  local oc; oc="$(lower "${outcome:-}")"

  # An explicit FAIL outcome is a FAIL no matter how fresh — the routine ran
  # and reported failure; that is the loudest signal.
  if [ "$oc" = "fail" ]; then
    echo "FAIL	$name	last recorded outcome was FAIL (last heartbeat=${last:-unknown}) — routine ran but failed; investigate + re-run"
    FAIL=$((FAIL+1)); return
  fi

  # No usable timestamp → cannot judge freshness → UNVERIFIED (never PASS).
  if [ -z "${last:-}" ] || [ "$last" = "-" ]; then
    echo "UNVERIFIED	$name	no last-heartbeat timestamp supplied — cannot tell if a run was missed (feed it from the Control Room Heartbeat table)"
    UNV=$((UNV+1)); return
  fi

  local last_epoch; last_epoch="$(to_epoch "$last")"
  if [ -z "$last_epoch" ]; then
    echo "UNVERIFIED	$name	could not parse last-heartbeat timestamp '$last' — expected UTC ISO-8601 like 2026-07-04T07:00:00Z"
    UNV=$((UNV+1)); return
  fi

  local age_s=$((NOW_EPOCH - last_epoch))
  local max_s=$((max * 60))
  local age_min=$((age_s / 60))

  # A heartbeat in the future (clock skew / bad row) is suspicious — UNVERIFIED.
  if [ "$age_s" -lt 0 ]; then
    echo "UNVERIFIED	$name	last heartbeat '$last' is in the FUTURE relative to now '$NOW_ISO' — clock skew or a bad row; not trusting it as fresh"
    UNV=$((UNV+1)); return
  fi

  local wd; wd="$(lower "${weekday:-}")"
  local weekday_only=0
  case "$wd" in weekday|1|true|yes) weekday_only=1 ;; esac

  if [ "$age_s" -le "$max_s" ]; then
    echo "PASS	$name	fresh — last heartbeat ${age_min}m ago (<= ${max}m budget), last outcome=${oc:-unknown}"
    PASS=$((PASS+1)); return
  fi

  # OVERDUE. If the routine is weekday-only and today is the weekend, grace it.
  if [ "$weekday_only" -eq 1 ] && is_weekend; then
    echo "UNVERIFIED	$name	OVERDUE by $((age_min - max))m (last ${age_min}m ago > ${max}m) BUT it is $DOW and this routine runs weekdays only — expected idle; re-check on the next weekday"
    UNV=$((UNV+1)); return
  fi

  echo "FAIL	$name	OVERDUE — last heartbeat ${age_min}m ago exceeds the ${max}m budget by $((age_min - max))m; routine missed or stalled its expected run (ACTION NEEDED)"
  FAIL=$((FAIL+1))
}

for token in "$@"; do
  check_one "$token"
done

echo "# ---"
echo "# summary	PASS=$PASS	FAIL=$FAIL	UNVERIFIED=$UNV	day=$DOW"
if [ "$FAIL" -gt 0 ]; then echo "# RESULT: FAIL"; exit 2; fi
if [ "$UNV" -gt 0 ]; then echo "# RESULT: UNVERIFIED"; exit 1; fi
echo "# RESULT: PASS"
exit 0
