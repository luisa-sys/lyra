#!/usr/bin/env bash
#
# scripts/check-routine-ownership.sh
#
# KAN-361 — "one concern → one owner" regression guard.
#
# KAN-361 de-duplicated the scheduled ops routines so that each shared
# concern (liveness / security / test-release / doc-sync) has exactly ONE
# owner, and every other routine *cites* that owner's last result instead of
# independently re-deriving the same signal. That de-dup landed as merged
# repo changes (PR #437), but nothing in CI prevents a later edit from
# silently re-introducing the quadruplicated probing the ticket removed —
# e.g. re-adding a multi-endpoint liveness curl loop to weekly-report.yml
# Section 1, or growing security-audit.yml back into a second authoritative
# security sweep. This static, READ-ONLY guard asserts the load-bearing
# ownership markers are still present so such a regression fails the PR.
#
# It is intentionally a *presence* guard over stable, human-authored marker
# strings — not a behavioural test. Each assertion maps to a KAN-361
# acceptance criterion ("no routine re-computes another's signal"). The full
# owner map lives in docs/OPS_ROUTINES_CONTROL_ROOM.md.
#
# Run from pr-checks.yml so any PR that removes an ownership marker fails CI.
#
# Honesty (Workflow & Backup Integrity Policy / KAN-167): a target file that
# is missing or unreadable is a FAIL, never a silent pass — an ownership
# invariant that cannot be verified is treated as broken.
#
# Exit codes:
#   0 — every ownership marker present
#   1 — one or more markers missing (or a target file is absent/unreadable)

set -euo pipefail

# Resolve repo root from this script's location so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FAILURES=0

# check_marker <relative-file> <fixed-string> <human-description>
#
# Asserts <file> exists, is readable, and contains <fixed-string> (literal,
# via grep -F). Increments FAILURES and prints a GitHub ::error:: annotation
# on any miss so the failure surfaces in the run summary, not just the log.
check_marker() {
  local rel="$1" needle="$2" desc="$3"
  local file="$ROOT/$rel"

  if [[ ! -f "$file" ]]; then
    echo "::error::KAN-361 ownership guard — MISSING FILE: $rel (cannot verify: $desc)"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [[ ! -r "$file" ]]; then
    echo "::error::KAN-361 ownership guard — UNREADABLE FILE: $rel (cannot verify: $desc)"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if ! grep -qF -- "$needle" "$file"; then
    echo "::error::KAN-361 ownership guard — MARKER LOST in $rel: $desc"
    echo "           expected to find: \"$needle\""
    FAILURES=$((FAILURES + 1))
    return
  fi
  echo "OK  $rel — $desc"
}

echo "KAN-361 one-concern-one-owner guard — checking ownership markers..."
echo

# ── Liveness owner = health-check.yml ───────────────────────────────────────
# weekly-report.yml Section 1 must READ the last health-check.yml conclusion
# via `gh run list`, not re-curl the endpoint list itself.
check_marker ".github/workflows/weekly-report.yml" \
  "--workflow=health-check.yml" \
  "weekly-report Section 1 reads health-check.yml (liveness owner), not re-curl"

# ── Security owner = the Daily Security routine ─────────────────────────────
# security-audit.yml must stay demoted to a thin belt-and-braces npm audit,
# explicitly deferring to the Daily Security routine as the authoritative sweep.
check_marker ".github/workflows/security-audit.yml" \
  "Belt-and-braces only" \
  "security-audit.yml stays demoted (belt-and-braces, not the authoritative sweep)"
check_marker ".github/workflows/security-audit.yml" \
  "Daily Security routine" \
  "security-audit.yml cites the Daily Security routine as security owner"

# weekly-report.yml Section 5 keeps its counts but cites Daily Security as SoR.
check_marker ".github/workflows/weekly-report.yml" \
  "Source of record: **Daily Security routine**" \
  "weekly-report Section 5 cites the Daily Security routine as source of record"

# ── Release owner = the Weekly Health + Regression routine ──────────────────
# SEC-153 added Section 15b (CTL-065 production deploy drift) to weekly-report.
# That is a RELEASE concern, and weekly-report is a *reporting* surface — so the
# section must keep deferring to the release owner rather than becoming a second
# authority on release state. Marker added 2026-08-16 after the SEC-153 PR
# ticked "Ops routine / Control-Room registry — N/A", which was wrong: adding a
# release-concern section to the reporting routine IS an ownership event, and
# recording nothing is how a second owner appears without anyone deciding to
# create one.
check_marker ".github/workflows/weekly-report.yml" \
  "Source of record: **Weekly Health" \
  "weekly-report Section 15b cites the Weekly Health + Regression routine as release owner"

# ── Stale liveness snapshot must stay labelled a point-in-time snapshot ──────
check_marker "docs/ENDPOINT_HEALTH_AUDIT.md" \
  "POINT-IN-TIME SNAPSHOT" \
  "ENDPOINT_HEALTH_AUDIT.md stays a dated snapshot, not a live liveness signal"

# ── The owner map itself must remain in the Control Room mirror ─────────────
check_marker "docs/OPS_ROUTINES_CONTROL_ROOM.md" \
  "One concern → one owner." \
  "OPS_ROUTINES_CONTROL_ROOM.md states the one-concern-one-owner rule"
check_marker "docs/OPS_ROUTINES_CONTROL_ROOM.md" \
  "Concern → single owner" \
  "OPS_ROUTINES_CONTROL_ROOM.md keeps the concern→owner map (KAN-361)"

# ── Staging-soak owner = the Staging Soak routine + its design doc (KAN-413) ──
check_marker "docs/OPS_ROUTINES_CONTROL_ROOM.md" \
  "Staging-soak of record" \
  "OPS_ROUTINES_CONTROL_ROOM.md names the Staging Soak routine as staging-soak owner (KAN-413)"
check_marker "docs/STAGING_SOAK_ROUTINE.md" \
  "release contract" \
  "STAGING_SOAK_ROUTINE.md keeps its release-updatable contract (C1–C6)"
check_marker ".github/signup-surface.paths" \
  "src/app/(auth)/signup/**" \
  "signup-surface manifest still lists the sign-up form path (un-skippable gate, KAN-413)"

echo
if [[ "$FAILURES" -gt 0 ]]; then
  echo "FAIL — $FAILURES KAN-361 ownership marker(s) lost. A routine de-dup"
  echo "       invariant has regressed. See docs/OPS_ROUTINES_CONTROL_ROOM.md"
  echo "       (owner map) before removing any cited marker."
  exit 1
fi

echo "PASS — all KAN-361 one-concern-one-owner markers present."
exit 0
