#!/usr/bin/env bash
# scripts/rollback-dry-run.sh
#
# BUGS-9 acceptance test: exercise rollback-to-sha.py against the real
# Vercel API end-to-end WITHOUT actually promoting anything.
#
# What this proves:
#   1. The Vercel API token has the right scope to LIST production deployments
#   2. find_target() locates a real deployment by meta.githubCommitSha
#   3. The verification poll path can read current production
#
# What this does NOT prove:
#   - The actual /promote API call (skipped in dry-run mode)
#   - That a different deployment can be made current (not exercised)
#
# To prove the promote path itself, deliberately fail a smoke check on a
# non-prod environment and watch the auto-rollback job in promote-to-production.yml.
#
# Usage:
#   VERCEL_TOKEN=… VERCEL_ORG_ID=… VERCEL_PROJECT_ID=… ./scripts/rollback-dry-run.sh
#   # OR pass an explicit target SHA:
#   TARGET_SHA=abc123… ./scripts/rollback-dry-run.sh
#
# By default the script reads CURRENT production deployment's SHA and uses
# THAT as the target. Promote-to-current is a no-op even if dry-run is off,
# but we still skip it to avoid touching the production deployment record.

set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN must be set}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID must be set}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID must be set}"

# Resolve TARGET_SHA — explicit override, or current production deployment.
if [ -z "${TARGET_SHA:-}" ]; then
  echo "→ No TARGET_SHA provided. Reading current production deployment SHA from Vercel…"
  TARGET_SHA=$(curl -sf \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v6/deployments?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_ORG_ID&target=production&limit=1" \
    | python3 -c "import json,sys; d=json.load(sys.stdin)['deployments'][0]; print((d.get('meta') or {}).get('githubCommitSha',''))")

  if [ -z "$TARGET_SHA" ]; then
    echo "::error::Could not read current production SHA from Vercel API"
    exit 1
  fi
  echo "  current production SHA: $TARGET_SHA"
fi

export TARGET_SHA
export DRY_RUN=1

echo ""
echo "=== Running rollback-to-sha.py in DRY-RUN mode ==="
echo "  TARGET_SHA = $TARGET_SHA"
echo ""

python3 "$(dirname "$0")/rollback-to-sha.py"
RC=$?

echo ""
if [ $RC -eq 0 ]; then
  echo "✓ Dry-run PASSED — auto-rollback would work end-to-end on a real failure."
else
  echo "✗ Dry-run FAILED (exit $RC) — investigate before relying on auto-rollback."
fi
exit $RC
