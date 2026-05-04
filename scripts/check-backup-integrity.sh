#!/usr/bin/env bash
# scripts/check-backup-integrity.sh — KAN-167 Phase 4
#
# Validates that a downloaded lyra-platform-backup-* artifact directory
# contains real data, not placeholder strings from failed export commands.
#
# Used by:
#   * .github/workflows/backup-platform.yml — pre-upload integrity gate
#   * .github/workflows/weekly-report.yml   — Section 13: Backup integrity
#   * Manual operator runs after suspicious "all-green" weekly reports
#
# Usage:
#   check-backup-integrity.sh <backup-dir>
#
# Exit codes:
#   0  — all checks passed
#   1  — one or more checks failed (details on stdout + stderr)
#   2  — invocation error (missing arg, dir doesn't exist)
#
# Stdout format: one line per check, prefixed with ✅ or ❌, machine-parseable
# (used by weekly-report.yml to build the email section).
#
# This script must NEVER silently report success on missing data — that is
# the exact false-positive class KAN-167 was filed to eliminate.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "::error::usage: check-backup-integrity.sh <backup-dir>" >&2
  exit 2
fi

BACKUP_DIR="$1"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "::error::backup directory does not exist: $BACKUP_DIR" >&2
  exit 2
fi

FAILED=0

# ── 1. cloudflare-dns.json ──────────────────────────────────
DNS_FILE="$BACKUP_DIR/cloudflare-dns.json"
if [ ! -f "$DNS_FILE" ]; then
  echo "❌ cloudflare-dns.json: missing"
  FAILED=1
else
  if DNS_RESULT=$(python3 - "$DNS_FILE" <<'PYEOF'
import json, sys
path = sys.argv[1]
try:
    with open(path) as f:
        d = json.load(f)
except json.JSONDecodeError as e:
    print(f"FAIL:invalid JSON ({e})")
    sys.exit(0)
except Exception as e:
    print(f"FAIL:read error ({e})")
    sys.exit(0)
if not isinstance(d, dict):
    print(f"FAIL:top-level is not an object")
    sys.exit(0)
if not d.get("success"):
    errs = d.get("errors", [])
    print(f"FAIL:success=false errors={errs}")
    sys.exit(0)
result = d.get("result", [])
if not isinstance(result, list):
    print(f"FAIL:result is not a list")
    sys.exit(0)
if len(result) < 1:
    print(f"FAIL:0 records (expected >0)")
    sys.exit(0)
print(f"OK:{len(result)} records")
PYEOF
  ); then
    if [[ "$DNS_RESULT" == OK:* ]]; then
      echo "✅ cloudflare-dns.json: ${DNS_RESULT#OK:}"
    else
      echo "❌ cloudflare-dns.json: ${DNS_RESULT#FAIL:}"
      FAILED=1
    fi
  else
    echo "❌ cloudflare-dns.json: validator script crashed"
    FAILED=1
  fi
fi

# ── 2. supabase-schema.sql ──────────────────────────────────
SQL_FILE="$BACKUP_DIR/supabase-schema.sql"
if [ ! -f "$SQL_FILE" ]; then
  echo "❌ supabase-schema.sql: missing"
  FAILED=1
else
  HEADER=$(head -c 2 "$SQL_FILE" || true)
  if [ "$HEADER" != "--" ]; then
    PREVIEW=$(head -c 60 "$SQL_FILE" | tr '\n' ' ' | tr -d '\r')
    echo "❌ supabase-schema.sql: invalid header (first 60 chars: $PREVIEW)"
    FAILED=1
  elif ! grep -q "CREATE TABLE" "$SQL_FILE"; then
    echo "❌ supabase-schema.sql: no CREATE TABLE statements"
    FAILED=1
  else
    LINE_COUNT=$(wc -l < "$SQL_FILE" | tr -d ' ')
    echo "✅ supabase-schema.sql: $LINE_COUNT lines, contains CREATE TABLE"
  fi
fi

# ── 3. github-secrets-list.txt ──────────────────────────────
SECRETS_FILE="$BACKUP_DIR/github-secrets-list.txt"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "❌ github-secrets-list.txt: missing"
  FAILED=1
else
  # Match the placeholder strings backup-platform.yml writes on per-repo
  # failure: "(failed to fetch", "fetch failed", "Resource not accessible".
  # Use grep -E with `set +e` because grep exits 1 on no match (which is
  # the success case here) and that would trip `set -e`.
  set +e
  PLACEHOLDER_HITS=$(grep -cE "\(failed to fetch|fetch failed|Resource not accessible" "$SECRETS_FILE")
  set -e
  if [ "$PLACEHOLDER_HITS" -gt 0 ]; then
    echo "❌ github-secrets-list.txt: contains $PLACEHOLDER_HITS placeholder marker(s)"
    FAILED=1
  else
    set +e
    SECRET_COUNT=$(grep -cE "^[A-Z][A-Z0-9_]*$" "$SECRETS_FILE")
    set -e
    echo "✅ github-secrets-list.txt: $SECRET_COUNT secret name(s), no failure markers"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
exit 0
