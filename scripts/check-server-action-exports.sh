#!/usr/bin/env bash
# scripts/check-server-action-exports.sh
#
# BUGS-12: Static scan of every `'use server'` file in src/ for non-async-function
# exports. Next.js 16+ / React 19 reject any non-async-function export from a
# `'use server'` file at action-invocation time with:
#
#   Error: A "use server" file can only export async functions, found "X"
#
# The build does NOT catch this; the validator runs only when an action is
# invoked. Without this check, a regression like the one in BUGS-12 (an
# `export const ALLOWED_PROFILE_FIELDS` in actions.ts) ships green to dev
# and breaks the entire wizard for users.
#
# Move any offending exports to a sibling module and import them.
#
# Allow-list: append `// server-action-exports-ok: <reason>` to a line to
# skip it (e.g. a re-export of an async function from another module).

set -euo pipefail

# All files in src/ whose first non-empty line is a `'use server'` directive.
# (Some `'use server'` directives appear inline in client files for actions —
# we restrict to module-level by checking the first ~5 lines.)
# Written portably for bash 3.2 (macOS) and bash 5.x (Ubuntu CI).
USE_SERVER_FILES=$(
  grep -rln --include='*.ts' --include='*.tsx' "'use server'" src/ 2>/dev/null | while read -r f; do
    if head -5 "$f" | grep -qE "^['\"]use server['\"];?[[:space:]]*$"; then
      echo "$f"
    fi
  done
)

if [ -z "$USE_SERVER_FILES" ]; then
  echo "No 'use server' module files found in src/."
  exit 0
fi

FILE_COUNT=$(echo "$USE_SERVER_FILES" | wc -l | tr -d ' ')
echo "Scanning $FILE_COUNT 'use server' module file(s) for non-async exports…"

VIOLATIONS=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  # Match top-level non-async exports:
  #   export const X
  #   export let X
  #   export var X
  #   export class X
  #   export enum X
  #   export interface X    ← (allowed: types are erased — but flag for cleanliness)
  #   export function X     ← (NON-async function — broken)
  # NOT flagged:
  #   export type X         ← types are erased at compile time
  #   export async function ← the only legal runtime export
  #   export { foo }        ← re-exports are runtime checked at the source module
  while IFS=: read -r linenum content; do
    [ -z "$linenum" ] && continue
    # Allow-list comment
    if echo "$content" | grep -q "server-action-exports-ok"; then
      continue
    fi
    echo "::error file=$f,line=$linenum::Non-async-function export in 'use server' file. Move to a sibling module. → $content"
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(
    grep -nE '^export (const|let|var|class|enum|interface) [A-Za-z_]' "$f" || true
    grep -nE '^export function [A-Za-z_]' "$f" || true
  )
done <<EOF
$USE_SERVER_FILES
EOF

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "::error::Found $VIOLATIONS non-async-function export(s) in 'use server' files."
  echo "Next.js 16+ rejects these at action-invocation time. See BUGS-12."
  echo "Fix: move the export to a sibling .ts module and import it from the action file."
  exit 1
fi

echo "All 'use server' files export only async functions. ✓"
