#!/usr/bin/env bash
#
# gen-db-types.sh — regenerate ONE environment's committed schema snapshot
# (`src/types/database/<env>.ts`).
#
# SEC-133. This exists because the remediation instruction was a dangling
# reference: `check-live-schema-parity.py` told you to "regenerate a stale
# snapshot with the documented step in docs/RUNBOOK.md", and that step did not
# exist — nothing in docs/ or scripts/ mentioned `supabase gen types` at all.
# The daily snapshot-freshness check now depends on this being a one-command
# fix, because a red that is awkward to clear becomes a red people learn to
# expect, and this repo has paid for that lesson twice (gotcha #30, and the 18
# "expected" macOS failures).
#
# USAGE
#     npm run gen:db-types -- --env dev
#     bash scripts/gen-db-types.sh --env staging
#
# The project ref is read from `src/types/database/index.ts` (SCHEMA_PROJECT_REFS)
# rather than repeated here. Two copies of a project ref is one copy too many —
# and that file is already the place the drift gates read.
#
# REQUIRES `SUPABASE_ACCESS_TOKEN`. If it is absent this FAILS LOUD and exits
# non-zero; it never writes a partial file and never reports success. Per the
# Workflow & Backup Integrity Policy, a step that cannot run must not be green.
#
# ALTERNATIVE, when you have no CLI token: the Supabase MCP tool
# `generate_typescript_types` returns the identical output for a project ref.
# Paste it into the same path. Same result, different transport.
#
# Portability: bash 3.2-clean (no mapfile/readarray, no declare -A, no ${v,,})
# — macOS ships bash 3.2 and this runs by hand far more often than in CI.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX="$REPO_ROOT/src/types/database/index.ts"

ENV_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --env=*) ENV_NAME="${1#--env=}"; shift ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "::error::gen-db-types: unknown argument '$1'"; exit 2 ;;
  esac
done

case "$ENV_NAME" in
  dev|staging|prod) ;;
  "") echo "::error::gen-db-types: --env is required (dev | staging | prod)"; exit 2 ;;
  *)  echo "::error::gen-db-types: unknown environment '$ENV_NAME' (expected dev | staging | prod)"; exit 2 ;;
esac

# Assert the input exists rather than inferring it from a grep exit code —
# gotcha #30: never conclude "the file was searched" from an exit status.
if [ ! -f "$INDEX" ] || [ ! -r "$INDEX" ]; then
  echo "::error::gen-db-types: $INDEX is missing or unreadable, so the project ref cannot be resolved."
  echo "::error::  Failing closed rather than guessing a ref and overwriting a snapshot."
  exit 2
fi

PROJECT_REF=$(grep -E "^[[:space:]]*${ENV_NAME}:[[:space:]]*'[a-z]+'" "$INDEX" \
  | head -1 | sed -E "s/^[^']*'([a-z]+)'.*/\1/")

if [ -z "$PROJECT_REF" ]; then
  echo "::error::gen-db-types: no project ref for '$ENV_NAME' in $INDEX (SCHEMA_PROJECT_REFS)."
  exit 2
fi

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "::error::gen-db-types: SUPABASE_ACCESS_TOKEN is not set."
  echo "::error::  Cannot reach the Supabase Management API, so the snapshot cannot be"
  echo "::error::  regenerated. NOT writing anything — a truncated or error-body snapshot"
  echo "::error::  is worse than a stale one, because the drift gates would then compare"
  echo "::error::  against garbage and report a difference nobody can interpret."
  echo "::error::"
  echo "::error::  Either export SUPABASE_ACCESS_TOKEN, or use the Supabase MCP tool"
  echo "::error::  generate_typescript_types with project ref $PROJECT_REF and write the"
  echo "::error::  output to src/types/database/${ENV_NAME}.ts."
  exit 2
fi

TARGET="$REPO_ROOT/src/types/database/${ENV_NAME}.ts"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "gen-db-types: regenerating $ENV_NAME ($PROJECT_REF) -> src/types/database/${ENV_NAME}.ts"
if ! npx --yes supabase gen types typescript --project-id "$PROJECT_REF" > "$TMP" 2>"$TMP.err"; then
  echo "::error::gen-db-types: 'supabase gen types' failed for $ENV_NAME ($PROJECT_REF):"
  sed 's/^/::error::  /' "$TMP.err" | head -20
  rm -f "$TMP.err"
  exit 1
fi
rm -f "$TMP.err"

# Validate before overwriting. The whole point of this script is that a bad
# write is worse than no write: these files are the input to two blocking gates.
if ! grep -q "export type Database" "$TMP"; then
  echo "::error::gen-db-types: output does not contain 'export type Database' — refusing to write."
  echo "::error::  First 5 lines of what came back:"
  head -5 "$TMP" | sed 's/^/::error::  /'
  exit 1
fi

LINES=$(wc -l < "$TMP" | tr -d ' ')
if [ "$LINES" -lt 200 ]; then
  echo "::error::gen-db-types: output is only $LINES lines — implausibly short for a full schema."
  echo "::error::  Refusing to write. Suspect an auth or project-ref problem."
  exit 1
fi

mv "$TMP" "$TARGET"
trap - EXIT
echo "gen-db-types: wrote $LINES lines to src/types/database/${ENV_NAME}.ts"
echo "gen-db-types: now run  python3 scripts/check-live-schema-parity.py --snapshot-only --env $ENV_NAME"
echo "gen-db-types: and commit the regenerated file."
