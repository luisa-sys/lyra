#!/usr/bin/env bash
# Lyra - Supabase Database Restore Script
# Usage: ./scripts/restore-database.sh <backup_file>
#
# DANGER: This will DROP all public schema tables and restore from backup.
# Only use this on the target database you intend to restore.
# NEVER run this against production without a current backup first.

set -euo pipefail

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./scripts/restore-database.sh <backup_file>"
  echo ""
  echo "Available backups:"
  ls -lt backups/lyra_backup_*.sql 2>/dev/null | head -10 || echo "  No backups found in ./backups/"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL environment variable is not set."
  exit 1
fi

echo "=== Lyra Database Restore ==="
echo "Backup file: $BACKUP_FILE"
echo "Target database: ${SUPABASE_DB_URL%%@*}@..."
echo ""
echo "⚠️  WARNING: This will DROP all existing public schema tables."
echo "Press Ctrl+C within 10 seconds to cancel..."
sleep 10

echo ""
echo "Resetting the public schema..."
# SEC-23: this used to DROP a hardcoded list of 4 tables + a few types. The
# schema now has 38 public tables, so the old list left ~34 tables in place and
# a restore on top of them collided on constraints/dependencies. Drop and
# recreate the whole public schema instead, so the restore is clean regardless
# of how the schema has grown. (The dump itself recreates public via CREATE
# SCHEMA; we DROP it first so that statement succeeds.)
#
# BUGS-91 (2026-08-09): `supabase_migrations` is reset here too, because the
# dump now CONTAINS it. Leaving it in place would make the restore collide on
# the existing schema_migrations rows — so this must move in lockstep with
# backup-database.sh. Backup and restore drifting apart is how a restore that
# "succeeds" produces a database nobody can migrate afterwards.
#
# Dropping it is safe *in a restore*, which is already destructive by design
# (see the warning above), and the dump recreates it with the lineage that
# matches the data being restored — which is the entire point.
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "
  DROP SCHEMA IF EXISTS public CASCADE;
  CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO postgres;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
" 2>&1

echo "Restoring from backup..."
psql "$SUPABASE_DB_URL" -f "$BACKUP_FILE" 2>&1

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Restore completed successfully"
  echo "   Verify by checking: SELECT count(*) FROM public.profiles;"
else
  echo ""
  echo "❌ Restore failed — check errors above"
  exit 1
fi
