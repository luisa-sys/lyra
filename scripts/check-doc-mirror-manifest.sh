#!/usr/bin/env bash
# scripts/check-doc-mirror-manifest.sh
#
# KAN-363: presence guard for the documentation mirror manifest.
#
# The single source-of-truth direction lives in docs/DOC_SOURCE_OF_TRUTH.md.
# That file carries a machine-readable "mirror manifest" block delimited by
#   <!-- doc-mirror-manifest:start --> ... <!-- doc-mirror-manifest:end -->
# listing every critical runbook/compliance doc that is mirrored between the
# repo and the Confluence wiki. This guard parses that block, extracts each
# backtick-quoted repo path, and FAILS if any listed path no longer exists on
# disk — so a mirror cannot be silently deleted or renamed out of the tree
# (the cheapest, most common form of doc drift).
#
# This is deliberately a PRESENCE check only. Full content-drift detection
# against Confluence needs a Confluence API token in CI and is a separate,
# founder/ops-gated leg of KAN-363 (see the doc's "Not yet covered" section).
#
# The KAN-167 lesson applies: this script distinguishes "manifest unreadable"
# (exit 2) from "all mirrors present" (exit 0) and "a mirror is missing"
# (exit 1) — it never silently reports a clean pass.
#
# Exit codes:
#   0  every path in the manifest exists
#   1  one or more manifest paths are missing (drift)
#   2  the manifest file or its delimited block could not be read
#
# Env overrides (used by the unit test to point at a fixture):
#   MANIFEST_FILE   path to the doc containing the manifest block
#   REPO_ROOT       root that manifest paths are resolved against

set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
MANIFEST_FILE="${MANIFEST_FILE:-$REPO_ROOT/docs/DOC_SOURCE_OF_TRUTH.md}"

START_MARK='<!-- doc-mirror-manifest:start -->'
END_MARK='<!-- doc-mirror-manifest:end -->'

if [ ! -f "$MANIFEST_FILE" ]; then
  echo "::error::manifest file not found: $MANIFEST_FILE"
  exit 2
fi

# Extract the lines strictly between the two markers.
BLOCK="$(awk -v s="$START_MARK" -v e="$END_MARK" '
  index($0, s) { grab=1; next }
  index($0, e) { grab=0 }
  grab { print }
' "$MANIFEST_FILE")"

if [ -z "${BLOCK//[$'\t\r\n ']/}" ]; then
  echo "::error::mirror-manifest block is empty or its start/end markers are missing in $MANIFEST_FILE"
  exit 2
fi

# The first backtick-quoted token on each manifest row is the repo path.
# Pull every `...` token, then keep only those that look like repo paths
# (docs/, scripts/, .github/, src/, tests/) — the other columns hold prose.
PATHS="$(printf '%s\n' "$BLOCK" \
  | grep -oE '`[^`]+`' \
  | tr -d '`' \
  | grep -E '^(docs|scripts|\.github|src|tests)/' \
  || true)"

if [ -z "$PATHS" ]; then
  echo "::error::no repo paths found inside the mirror-manifest block in $MANIFEST_FILE"
  exit 2
fi

MISSING=0
COUNT=0
while IFS= read -r rel; do
  [ -z "$rel" ] && continue
  COUNT=$((COUNT + 1))
  if [ ! -e "$REPO_ROOT/$rel" ]; then
    echo "::error::manifest lists a mirror that is missing from the repo: $rel"
    MISSING=$((MISSING + 1))
  fi
done <<EOF
$PATHS
EOF

if [ "$MISSING" -gt 0 ]; then
  echo "doc-mirror-manifest: $MISSING of $COUNT listed mirror(s) MISSING — see errors above."
  exit 1
fi

echo "doc-mirror-manifest: all $COUNT listed mirror(s) present."
exit 0
