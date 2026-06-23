#!/usr/bin/env bash
# scripts/check-complete-backup.sh — SEC-23
#
# Validates that a complete-backup directory (produced by
# scripts/backup-database-complete.sh) contains a real, restorable archive and
# not a placeholder/empty artifact. Sibling of check-backup-integrity.sh.
#
# Used by:
#   * .github/workflows/backup-complete.yml — pre-upload integrity gate
#   * manual operator runs after a suspicious "all green" backup
#
# Usage:   check-complete-backup.sh <backup-dir>
# Exit:    0 all checks passed · 1 a check failed · 2 invocation error
#
# Stdout: one ✅/❌ line per check (machine-parseable, like the sibling script).
# MUST NEVER silently report success on missing data — that is the exact
# false-positive class the Backup Integrity Policy exists to eliminate.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "::error::usage: check-complete-backup.sh <backup-dir>" >&2
  exit 2
fi

BACKUP_DIR="$1"
if [ ! -d "$BACKUP_DIR" ]; then
  echo "::error::backup directory does not exist: $BACKUP_DIR" >&2
  exit 2
fi

FAILED=0

# ── 1. Manifest ─────────────────────────────────────────────────────────────
# shellcheck disable=SC2012
MANIFEST="$(ls "$BACKUP_DIR"/MANIFEST_*.json 2>/dev/null | head -1 || true)"
if [ -z "$MANIFEST" ] || [ ! -f "$MANIFEST" ]; then
  echo "❌ manifest: no MANIFEST_*.json found"
  FAILED=1
else
  MANIFEST_RESULT="$(python3 - "$MANIFEST" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        m = json.load(f)
except Exception as e:
    print(f"FAIL:invalid JSON ({e})"); sys.exit(0)
schemas = m.get("schemas", [])
# auth is the schema whose absence makes a backup non-restorable (no users).
for required in ("public", "auth", "storage"):
    if required not in schemas:
        print(f"FAIL:manifest missing required schema '{required}' (schemas={schemas})")
        sys.exit(0)
rc = m.get("row_counts")
if not isinstance(rc, dict):
    print("FAIL:manifest has no row_counts object"); sys.exit(0)
print(f"OK:schemas={','.join(schemas)} tables={len(rc)} roles={m.get('roles_status')}")
PYEOF
)"
  if [[ "$MANIFEST_RESULT" == OK:* ]]; then
    echo "✅ manifest: ${MANIFEST_RESULT#OK:}"
  else
    echo "❌ manifest: ${MANIFEST_RESULT#FAIL:}"
    FAILED=1
  fi
fi

# ── 2. Complete dump archive ────────────────────────────────────────────────
# shellcheck disable=SC2012
DUMP="$(ls "$BACKUP_DIR"/lyra_complete_*.dump 2>/dev/null | head -1 || true)"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "❌ complete dump: no lyra_complete_*.dump found"
  FAILED=1
else
  SIZE=$(stat -c%s "$DUMP" 2>/dev/null || stat -f%z "$DUMP")
  # pg_dump custom-format archives begin with the magic string "PGDMP".
  HEADER="$(head -c 5 "$DUMP" || true)"
  if [ "$HEADER" != "PGDMP" ]; then
    echo "❌ complete dump: not a pg_dump custom archive (header='$HEADER', expected 'PGDMP')"
    FAILED=1
  elif [ "$SIZE" -lt 1024 ]; then
    echo "❌ complete dump: suspiciously small ($SIZE bytes)"
    FAILED=1
  else
    echo "✅ complete dump: valid PGDMP archive, $SIZE bytes"
  fi
fi

# ── 3. Roles globals present (status is informational) ──────────────────────
# shellcheck disable=SC2012
ROLES="$(ls "$BACKUP_DIR"/roles_*.sql 2>/dev/null | head -1 || true)"
if [ -z "$ROLES" ] || [ ! -f "$ROLES" ]; then
  echo "❌ roles: no roles_*.sql found"
  FAILED=1
else
  if grep -q "SKIPPED" "$ROLES"; then
    echo "✅ roles: present (export was SKIPPED — non-fatal, recorded in manifest)"
  else
    echo "✅ roles: present ($(wc -l < "$ROLES" | tr -d ' ') lines)"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
exit 0
