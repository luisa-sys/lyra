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
# SEC-23: a schema-only dump easily passes the size/header checks. Prove real
# data was captured using the REAL COUNT(*) critical_row_counts (n_live_tup in
# row_counts is a statistical estimate). auth.users==0 means the accounts — the
# whole reason the complete backup exists — were not captured.
crit = m.get("critical_row_counts")
if not isinstance(crit, dict) or "auth_users" not in crit:
    print("FAIL:manifest has no critical_row_counts.auth_users (SEC-23 — cannot prove accounts were captured)"); sys.exit(0)
try:
    auth_users = int(crit.get("auth_users", 0))
except (TypeError, ValueError):
    print(f"FAIL:critical_row_counts.auth_users is not numeric ({crit.get('auth_users')!r})"); sys.exit(0)
if auth_users < 1:
    print(f"FAIL:critical_row_counts.auth_users is {auth_users} — a complete backup with zero users is not restorable"); sys.exit(0)
print(f"OK:schemas={','.join(schemas)} tables={len(rc)} auth_users={auth_users} profiles={crit.get('public_profiles')} roles={m.get('roles_status')}")
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

# ── 3. Roles globals captured (SEC-23: SKIPPED is a FAILURE by default) ──────
# Previously a SKIPPED roles export passed silently. But SKIPPED almost always
# means SUPABASE_DB_URL is the 6543 transaction pooler (which cannot do
# pg_dumpall --roles-only), and a clean-room (non-Supabase) restore from such a
# backup would be missing ALL roles/grants — a green-but-lossy backup, exactly
# the false-positive class the Backup Integrity Policy forbids. Fail unless the
# operator DELIBERATELY opts into a Supabase→Supabase-only backup.
# shellcheck disable=SC2012
ROLES="$(ls "$BACKUP_DIR"/roles_*.sql 2>/dev/null | head -1 || true)"
if [ -z "$ROLES" ] || [ ! -f "$ROLES" ]; then
  echo "❌ roles: no roles_*.sql found"
  FAILED=1
elif grep -q "SKIPPED" "$ROLES"; then
  if [ "${BACKUP_ALLOW_SKIPPED_ROLES:-}" = "true" ]; then
    echo "⚠️  roles: export was SKIPPED — BACKUP_ALLOW_SKIPPED_ROLES=true set; a clean-room (non-Supabase) restore would have NO roles/grants"
  else
    echo "❌ roles: export was SKIPPED (pg_dumpall --roles-only failed — usually SUPABASE_DB_URL is the 6543 pooler, not a 5432 session URL). A clean-room restore would be missing ALL roles/grants. Fix the DB URL to a session/5432 connection, or re-dispatch with allow_skipped_roles=true for a Supabase→Supabase-only backup."
    FAILED=1
  fi
else
  echo "✅ roles: captured ($(wc -l < "$ROLES" | tr -d ' ') lines)"
fi

# ── 4. Cloudflare KV (waitlist) export present + well-formed (SEC-23) ────────
# The 0-keys false-green is gated in backup-complete.yml's KV step (allow_empty_kv);
# here we assert the file exists and parses so the integrity gate — not just the
# producing step — confirms the waitlist export is real JSON with a keys list.
# shellcheck disable=SC2012
KVFILE="$(ls "$BACKUP_DIR"/cloudflare-kv-*.json 2>/dev/null | head -1 || true)"
if [ -z "$KVFILE" ] || [ ! -f "$KVFILE" ]; then
  echo "❌ kv: no cloudflare-kv-*.json found (waitlist export missing)"
  FAILED=1
else
  KV_RESULT="$(python3 - "$KVFILE" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
except Exception as e:
    print(f"FAIL:invalid JSON ({e})"); sys.exit(0)
keys = d.get("keys")
if not isinstance(keys, list):
    print("FAIL:kv export has no 'keys' list"); sys.exit(0)
print(f"OK:{len(keys)} key(s)")
PYEOF
)"
  if [[ "$KV_RESULT" == OK:* ]]; then
    echo "✅ kv: ${KV_RESULT#OK:} exported"
  else
    echo "❌ kv: ${KV_RESULT#FAIL:}"
    FAILED=1
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
exit 0
