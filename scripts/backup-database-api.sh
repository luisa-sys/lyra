#!/usr/bin/env bash
# Lyra - Database Backup via Supabase REST API
# Usage: ./scripts/backup-database-api.sh [output_dir]
#
# Alternative to pg_dump when direct database access isn't available.
# Uses the Supabase REST API with the service role key.
#
# KAN-167 Phase 2: hardened against silent failures.
# - All curl calls use `-fSL` so non-2xx HTTP responses fail the script.
# - Each table backup is validated as valid JSON array, not error response.
# - All tables are attempted (not stopped at first failure) so we know which
#   ones failed; the script then exits non-zero at the end if any failed.

set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

TABLES=("profiles" "profile_items" "external_links" "school_affiliations")

echo "=== Lyra REST API Backup ==="
echo "Timestamp: $TIMESTAMP"
echo ""

FAILED_TABLES=()

for TABLE in "${TABLES[@]}"; do
  FILE="${OUTPUT_DIR}/${TABLE}_${TIMESTAMP}.json"
  echo "Backing up $TABLE..."

  # `-f` makes curl exit non-zero on HTTP 4xx/5xx (so we don't write error
  # JSON to a file that looks like a successful backup).
  # `-S` shows errors even with `-s`. `-L` follows redirects.
  # We do NOT exit on first failure — we want to know which tables failed.
  if curl -fSL "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${TABLE}?select=*" \
      -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -o "$FILE" 2>&1; then

    # Validate the response is a JSON array. The REST API returns arrays for
    # successful queries; error responses are objects like {"code":...,"message":...}
    if python3 -c "import json,sys; d=json.load(open('$FILE')); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null; then
      ROW_COUNT=$(python3 -c "import json; print(len(json.load(open('$FILE'))))")
      SIZE=$(du -h "$FILE" | cut -f1)
      echo "  ✓ $TABLE: $ROW_COUNT rows ($SIZE)"
    else
      echo "  ✗ $TABLE: response is not a JSON array (likely auth/permission error in body)"
      echo "    First 200 chars: $(head -c 200 "$FILE")"
      FAILED_TABLES+=("$TABLE")
    fi
  else
    echo "  ✗ $TABLE: HTTP error (curl exited non-zero)"
    FAILED_TABLES+=("$TABLE")
  fi
done

echo ""
if [ "${#FAILED_TABLES[@]}" -gt 0 ]; then
  echo "ERROR: ${#FAILED_TABLES[@]} table(s) failed to back up: ${FAILED_TABLES[*]}" >&2
  exit 1
fi

echo "✅ Backup complete: $OUTPUT_DIR/*_${TIMESTAMP}.json"
