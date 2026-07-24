#!/usr/bin/env bash
# scripts/check-doc-mirror-content.sh
#
# KAN-363: content guard for the documentation mirror manifest.
#
# Companion to scripts/check-doc-mirror-manifest.sh. That guard is PRESENCE
# only — it fails if a listed repo mirror was deleted or renamed. This guard
# fails if a listed mirror EXISTS but is an empty / placeholder / stub file:
# the next-cheapest form of doc drift, and exactly the KAN-167 failure mode
# ("a backup that looks successful but contains placeholder content is worse
# than no backup"). A mirror that has been reduced to a one-line stub, a
# fetch-failure placeholder, or lorem-ipsum filler would pass the presence
# check yet carry no real content — this guard catches that.
#
# For every `.md` path listed in the mirror manifest inside
# docs/DOC_SOURCE_OF_TRUTH.md, it asserts the file:
#   * exists and is non-empty (whitespace-only fails),
#   * has at least MIN_HEADINGS Markdown heading line(s) (^#...),
#   * has at least MIN_NONBLANK non-blank lines.
#
# These are deliberately STRUCTURAL, content-agnostic checks with no
# false-positive surface. An earlier draft also scanned for stub/placeholder
# sentinel phrases (e.g. "schema export failed"), but that mis-fires on docs
# that legitimately *document* those anti-patterns — docs/PROJECT_INSTRUCTIONS.md
# mirrors the CLAUDE.md gotchas, which quote the KAN-167 "Schema export failed"
# example verbatim. Per the workflow-integrity policy ("false positives are
# worse than failures"), the sentinel scan was dropped; a stub file is caught
# by the emptiness/substance/heading checks regardless of what filler it holds.
#
# It is repo-only and needs no network — full content-drift detection against
# the canonical Confluence page still needs a Confluence API token in CI and
# remains a separate, founder/ops-gated leg of KAN-363 (see the doc's
# "Not yet covered" section). Non-.md manifest entries are intentionally left
# to the presence guard (a content/heading check is meaningless on a script or
# workflow file) and are reported as skipped, never silently dropped.
#
# The KAN-167 lesson applies: this script distinguishes "manifest unreadable"
# (exit 2) from "all mirrors have real content" (exit 0) and "a mirror is a
# stub" (exit 1) — it never silently reports a clean pass.
#
# Exit codes:
#   0  every listed .md mirror has real content
#   1  one or more listed .md mirrors are missing / empty / stub / placeholder
#   2  the manifest file or its delimited block could not be read
#
# Env overrides (used by the unit test to point at a fixture):
#   MANIFEST_FILE   path to the doc containing the manifest block
#   REPO_ROOT       root that manifest paths are resolved against
#   MIN_HEADINGS    minimum Markdown heading lines required (default 1)
#   MIN_NONBLANK    minimum non-blank lines required (default 5)

set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
MANIFEST_FILE="${MANIFEST_FILE:-$REPO_ROOT/docs/DOC_SOURCE_OF_TRUTH.md}"
MIN_HEADINGS="${MIN_HEADINGS:-1}"
MIN_NONBLANK="${MIN_NONBLANK:-5}"

START_MARK='<!-- doc-mirror-manifest:start -->'
END_MARK='<!-- doc-mirror-manifest:end -->'

if [ ! -f "$MANIFEST_FILE" ]; then
  echo "::error::manifest file not found: $MANIFEST_FILE"
  exit 2
fi

# Extract the lines strictly between the two markers (same parse as the
# presence guard, so the two stay in lock-step on what "the manifest" is).
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
PATHS="$(printf '%s\n' "$BLOCK" \
  | grep -oE '`[^`]+`' \
  | tr -d '`' \
  | grep -E '^(docs|scripts|\.github|src|tests)/' \
  || true)"

if [ -z "$PATHS" ]; then
  echo "::error::no repo paths found inside the mirror-manifest block in $MANIFEST_FILE"
  exit 2
fi

BAD=0
CHECKED=0
SKIPPED=0
while IFS= read -r rel; do
  [ -z "$rel" ] && continue

  # Content/heading checks only make sense for Markdown docs. A manifest may
  # also list a script or workflow as a mirror; leave those to the presence
  # guard rather than false-positive on them. Report the skip, never hide it.
  case "$rel" in
    *.md) : ;;
    *)
      SKIPPED=$((SKIPPED + 1))
      echo "doc-mirror-content: skipping non-markdown manifest entry (presence guard covers it): $rel"
      continue
      ;;
  esac

  CHECKED=$((CHECKED + 1))
  abs="$REPO_ROOT/$rel"

  if [ ! -f "$abs" ]; then
    echo "::error::manifest lists a mirror that is missing from the repo: $rel"
    BAD=$((BAD + 1))
    continue
  fi

  # Non-blank line count and heading count. grep -c prints the count and
  # exits 1 when the count is 0; with no `set -e` that non-zero exit is
  # harmless and the printed "0" is exactly what we want — so do NOT add a
  # `|| echo 0` fallback (it would append a second "0", making the value a
  # two-line non-integer that breaks the numeric tests below).
  nonblank="$(grep -cE '[^[:space:]]' "$abs")"
  headings="$(grep -cE '^#{1,6}[[:space:]]' "$abs")"

  if [ "$nonblank" -eq 0 ]; then
    echo "::error::mirror is empty (no non-blank lines): $rel"
    BAD=$((BAD + 1))
    continue
  fi
  if [ "$nonblank" -lt "$MIN_NONBLANK" ]; then
    echo "::error::mirror looks like a stub — only $nonblank non-blank line(s), need >= $MIN_NONBLANK: $rel"
    BAD=$((BAD + 1))
    continue
  fi
  if [ "$headings" -lt "$MIN_HEADINGS" ]; then
    echo "::error::mirror has no Markdown heading (need >= $MIN_HEADINGS '#' heading line): $rel"
    BAD=$((BAD + 1))
    continue
  fi
done <<EOF
$PATHS
EOF

if [ "$BAD" -gt 0 ]; then
  echo "doc-mirror-content: $BAD of $CHECKED checked mirror(s) FAILED the content check — see errors above."
  exit 1
fi

echo "doc-mirror-content: all $CHECKED checked .md mirror(s) have real content ($SKIPPED non-markdown entr(y/ies) skipped)."
exit 0
