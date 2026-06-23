#!/usr/bin/env bash
# scripts/backup-database-complete.sh — SEC-23 (DR/backup coverage hardening)
#
# COMPLETE logical backup of the Lyra Supabase Postgres database.
#
# WHY THIS EXISTS — the gap it closes:
#   scripts/backup-database.sh dumps ONLY the `public` schema
#   (`pg_dump --schema=public`). That backup CANNOT reconstruct a working
#   platform: it has profiles whose user_id FKs point at auth.users rows that
#   were never captured, so nobody could log in after a restore. The 2026-06-21
#   DR runbook (SEC-5) and the real 2026-06-21 backup artifact both confirm:
#   no `CREATE SCHEMA auth`, no auth/storage tables in the dump.
#
# This script captures everything needed to stand the platform back up from
# zero into a brand-new (even non-Supabase) Postgres:
#   * roles + grants    — pg_dumpall --roles-only --no-role-passwords  (best effort)
#   * public  + data    — application data (profiles, gatherings, api_keys, …)
#   * auth    + data     — users, identities, sessions, mfa  (THE GAP)
#   * storage + data     — bucket + object METADATA (object blobs are synced
#                          separately by backup-complete.yml against the S3 API)
#
# SECURITY: the auth dump contains password hashes and refresh tokens. The
# output of this script MUST be encrypted before it leaves CI (see KAN-121 and
# backup-complete.yml). Never commit or upload it unencrypted.
#
# Output (into $OUTPUT_DIR, all stamped with one $TIMESTAMP):
#   roles_<ts>.sql            role/grant globals (or a documented SKIPPED marker)
#   lyra_complete_<ts>.dump   pg_dump custom-format archive (-Fc) of the 3 schemas
#   MANIFEST_<ts>.json        schemas captured + per-table row counts + sha256
#
# Requires: SUPABASE_DB_URL  (a SESSION connection — port 5432 / direct, not the
#   6543 transaction pooler, which breaks pg_dumpall).
#
# Exit non-zero on ANY failure of a critical step. No silent placeholders.
# (Workflow & Backup Integrity Policy — false positives are worse than failures.)

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# Schemas that together make a restorable platform. Internal/replication
# schemas (pg_catalog, information_schema, pgbouncer, realtime, vault internals)
# are deliberately excluded — they are recreated by the target Postgres/Supabase.
SCHEMAS=(public auth storage)

ROLES_FILE="${OUTPUT_DIR}/roles_${TIMESTAMP}.sql"
DUMP_FILE="${OUTPUT_DIR}/lyra_complete_${TIMESTAMP}.dump"
MANIFEST_FILE="${OUTPUT_DIR}/MANIFEST_${TIMESTAMP}.json"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "::error::SUPABASE_DB_URL is not set — cannot take a complete backup." >&2
  echo "Set it to a SESSION connection string (port 5432 / 'Direct connection')," >&2
  echo "not the 6543 transaction pooler (pg_dumpall does not work over the pooler)." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "=== Lyra COMPLETE Database Backup ==="
echo "Timestamp:  $TIMESTAMP"
echo "Schemas:    ${SCHEMAS[*]}"
echo "Output dir: $OUTPUT_DIR"
echo ""

# ── 1. Roles / grants (best effort) ─────────────────────────────────────────
# Roles matter for a clean-room (non-Supabase) restore. A Supabase-to-Supabase
# restore already has anon/authenticated/service_role, so a failure here is a
# WARNING, not fatal — but it is recorded honestly in the manifest, never faked.
ROLES_STATUS="captured"
if pg_dumpall --roles-only --no-role-passwords --dbname "$SUPABASE_DB_URL" \
      > "$ROLES_FILE" 2> "${ROLES_FILE}.stderr.log"; then
  echo "✓ roles exported: $(wc -l < "$ROLES_FILE") lines"
else
  ROLES_STATUS="skipped:pg_dumpall_failed"
  echo "::warning::pg_dumpall --roles-only failed (often: SUPABASE_DB_URL is the 6543 pooler, which cannot do --roles-only). A Supabase target already has the standard roles, so this is non-fatal; a non-Supabase clean-room restore must recreate roles manually. See ${ROLES_FILE}.stderr.log."
  echo "-- roles export SKIPPED: pg_dumpall --roles-only failed; see stderr log --" > "$ROLES_FILE"
fi

# ── 2. Complete schema + data dump (custom format) ──────────────────────────
# -Fc = compressed custom-format archive, restorable selectively with
# pg_restore. --no-owner/--no-privileges keep it portable across projects.
DUMP_ARGS=(--format=custom --no-owner --no-privileges --file="$DUMP_FILE")
for s in "${SCHEMAS[@]}"; do
  DUMP_ARGS+=(--schema="$s")
done

echo "Running pg_dump (${SCHEMAS[*]})..."
pg_dump "$SUPABASE_DB_URL" "${DUMP_ARGS[@]}"

if [ ! -s "$DUMP_FILE" ]; then
  echo "::error::pg_dump produced an empty archive ($DUMP_FILE)" >&2
  exit 1
fi

# pg_restore --list reads the archive WITHOUT a database connection. Use it to
# prove the dump actually contains each required schema before we trust it.
DUMP_TOC="$(pg_restore --list "$DUMP_FILE")"
for s in "${SCHEMAS[@]}"; do
  if ! grep -qE "SCHEMA - ${s}\b|TABLE ${s} |TABLE DATA ${s} " <<<"$DUMP_TOC"; then
    echo "::error::dump archive contains no objects for schema '${s}' — incomplete backup" >&2
    exit 1
  fi
done
echo "✓ complete dump: $(du -h "$DUMP_FILE" | cut -f1), schemas present: ${SCHEMAS[*]}"

# ── 3. Manifest — per-table row counts (round-trip baseline for the drill) ──
# The restore drill compares these counts against the restored database. Counts
# are taken live at backup time. If this query fails we fail loud: a backup
# whose contents we cannot enumerate is not a backup we can trust.
echo "Building manifest (per-table row counts)..."
ROWCOUNTS_JSON="$(psql "$SUPABASE_DB_URL" -X -t -A <<'SQL'
SELECT COALESCE(json_object_agg(qualified, n), '{}'::json)::text
FROM (
  SELECT format('%I.%I', schemaname, relname) AS qualified, n_live_tup AS n
  FROM pg_stat_user_tables
  WHERE schemaname IN ('public','auth','storage')
) t;
SQL
)"

if [ -z "$ROWCOUNTS_JSON" ]; then
  echo "::error::could not read row counts for the manifest" >&2
  exit 1
fi

DUMP_SHA="$(sha256sum "$DUMP_FILE" | cut -d' ' -f1)"
SCHEMAS_JSON="$(printf '"%s",' "${SCHEMAS[@]}" | sed 's/,$//')"

cat > "$MANIFEST_FILE" <<JSON
{
  "backup_type": "complete-logical",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "timestamp_tag": "${TIMESTAMP}",
  "schemas": [${SCHEMAS_JSON}],
  "roles_status": "${ROLES_STATUS}",
  "dump_file": "$(basename "$DUMP_FILE")",
  "dump_format": "pg_dump custom (-Fc)",
  "dump_sha256": "${DUMP_SHA}",
  "row_counts": ${ROWCOUNTS_JSON}
}
JSON

echo "✓ manifest written: $MANIFEST_FILE"
echo ""
echo "✅ Complete backup finished:"
ls -la "$ROLES_FILE" "$DUMP_FILE" "$MANIFEST_FILE"
