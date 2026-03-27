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
echo "Dropping existing public schema objects..."
psql "$SUPABASE_DB_URL" -c "
  DROP TABLE IF EXISTS public.school_affiliations CASCADE;
  DROP TABLE IF EXISTS public.external_links CASCADE;
  DROP TABLE IF EXISTS public.profile_items CASCADE;
  DROP TABLE IF EXISTS public.profiles CASCADE;
  DROP TYPE IF EXISTS public.school_relationship CASCADE;
  DROP TYPE IF EXISTS public.link_type CASCADE;
  DROP TYPE IF EXISTS public.visibility_level CASCADE;
  DROP TYPE IF EXISTS public.item_category CASCADE;
  DROP FUNCTION IF EXISTS public.handle_updated_at CASCADE;
  DROP FUNCTION IF EXISTS public.handle_new_user CASCADE;
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
