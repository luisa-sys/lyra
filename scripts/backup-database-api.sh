#!/usr/bin/env bash
# Lyra - Database Backup via Supabase REST API
# Usage: ./scripts/backup-database-api.sh [output_dir]
#
# Alternative to pg_dump when direct database access isn't available.
# Uses the Supabase REST API with the service role key.

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

TABLES=("profiles" "profile_items" "external_links" "school_affiliations")

echo "=== Lyra REST API Backup ==="
echo "Timestamp: $TIMESTAMP"

for TABLE in "${TABLES[@]}"; do
  FILE="${OUTPUT_DIR}/${TABLE}_${TIMESTAMP}.json"
  echo "Backing up $TABLE..."
  curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${TABLE}?select=*" \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" > "$FILE"
  SIZE=$(du -h "$FILE" | cut -f1)
  echo "  $FILE ($SIZE)"
done

echo ""
echo "Backup complete: $OUTPUT_DIR/*_${TIMESTAMP}.json"
