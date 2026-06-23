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
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "
  DROP SCHEMA IF EXISTS public CASCADE;
  CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO postgres;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
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
