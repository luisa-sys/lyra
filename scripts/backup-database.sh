#!/usr/bin/env bash
# Lyra - Supabase Database Backup Script
# Usage: ./scripts/backup-database.sh [output_dir]
#
# Creates a pg_dump backup of the Lyra database.
# Requires: SUPABASE_DB_URL environment variable or .env.local file
#
# Supabase free plan provides daily backups with 7-day retention,
# but this script gives us independent backups we control.

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${OUTPUT_DIR}/lyra_backup_${TIMESTAMP}.sql"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Get database connection string
# Supabase connection string format: postgresql://postgres.[ref]:[password]@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL environment variable is not set."
  echo ""
  echo "Set it with your Supabase database connection string:"
  echo "  export SUPABASE_DB_URL='postgresql://postgres.[ref]:[password]@aws-0-eu-west-2.pooler.supabase.com:6543/postgres'"
  echo ""
  echo "Find your connection string in:"
  echo "  Supabase Dashboard → Settings → Database → Connection string → URI"
  exit 1
fi

echo "=== Lyra Database Backup ==="
echo "Timestamp: $TIMESTAMP"
echo "Output: $BACKUP_FILE"
echo ""

# Run pg_dump (schema + data, excluding auth schema which is managed by Supabase)
pg_dump "$SUPABASE_DB_URL" \
  --no-owner \
  --no-privileges \
  --schema=public \
  --format=plain \
  --file="$BACKUP_FILE" \
  2>&1

if [ $? -eq 0 ]; then
  FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "✅ Backup completed successfully"
  echo "   File: $BACKUP_FILE"
  echo "   Size: $FILESIZE"
  
  # Keep only last 30 backups
  ls -t "${OUTPUT_DIR}"/lyra_backup_*.sql 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
  BACKUP_COUNT=$(ls "${OUTPUT_DIR}"/lyra_backup_*.sql 2>/dev/null | wc -l | tr -d ' ')
  echo "   Backups retained: $BACKUP_COUNT"
else
  echo "❌ Backup failed"
  exit 1
fi
