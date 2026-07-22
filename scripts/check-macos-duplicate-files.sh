#!/usr/bin/env bash
# scripts/check-macos-duplicate-files.sh
#
# KAN-357: Reject committed macOS Finder-duplicate files/directories.
#
# When a file or folder is copied in macOS Finder (or lands via certain
# sync/merge accidents) it gets a " 2" / " 3" … suffix appended to the base
# name, e.g.:
#
#   src/app/api/recommendations/[slug] 2/route.ts      (duplicated directory)
#   tests/unit/profile-sections 2.cjs                  (duplicated source file)
#
# These shadow the real module, are never imported, silently rot, and confuse
# audits ("which is canonical?"). They have slipped into worktrees before
# (KAN-357 / findings cross-repo-05, web-arch-8). This guard fails the PR if
# any TRACKED path carries the Finder-copy suffix, so the class of regression
# can never reach develop.
#
# Scope: git-tracked paths only (untracked scratch files are ignored). Applies
# to source-code extensions and to any directory component, since a duplicated
# route directory ([slug] 2) is the higher-risk case.
#
# Allow-list: if a " <n>" suffix is ever legitimate (it currently never is in
# this repo), add the exact tracked path to the ALLOWLIST array below with a
# one-line reason. Keep it empty by default.

set -euo pipefail

# Exact tracked paths that are intentionally allowed to carry a " <n>" suffix.
# Format: one path per line. Keep empty unless there is a real, justified case.
ALLOWLIST=$(cat <<'EOF'
EOF
)

# Code file extensions we care about for the "<name> 2.ext" file case.
CODE_EXT_RE='\.(ts|tsx|js|jsx|cjs|mjs|json|md|sql|css|scss)$'

# A path component that is a Finder-copy: ends in a space followed by digits,
# optionally with a trailing extension (files) or nothing (directories).
#   "foo 2"        -> dir copy
#   "foo 2.ts"     -> file copy
#   "[slug] 2"     -> route-dir copy
DUP_COMPONENT_RE=' [0-9]+($|\.)'

violations=0

# Iterate tracked files; NUL-safe against spaces in paths.
while IFS= read -r -d '' path; do
  # Allow-list check (exact match).
  if [ -n "$ALLOWLIST" ] && printf '%s\n' "$ALLOWLIST" | grep -qxF "$path"; then
    continue
  fi

  hit=""

  # 1) Any directory component with a Finder-copy suffix (e.g. "[slug] 2/").
  #    Strip the final basename, then inspect each remaining segment.
  dir="${path%/*}"
  if [ "$dir" != "$path" ]; then
    IFS='/' read -ra segs <<<"$dir"
    for seg in "${segs[@]}"; do
      if printf '%s' "$seg" | grep -qE "$DUP_COMPONENT_RE"; then
        hit="duplicated directory component: '$seg'"
        break
      fi
    done
  fi

  # 2) The file basename itself: "<name> 2.<code-ext>".
  if [ -z "$hit" ]; then
    base="${path##*/}"
    if printf '%s' "$base" | grep -qE " [0-9]+$CODE_EXT_RE" \
      || printf '%s' "$base" | grep -qE " [0-9]+$"; then
      hit="duplicated file: '$base'"
    fi
  fi

  if [ -n "$hit" ]; then
    echo "::error file=$path::macOS Finder-duplicate committed — $hit. Remove it (the un-suffixed path is canonical), or allow-list with a reason in scripts/check-macos-duplicate-files.sh."
    violations=$((violations + 1))
  fi
done < <(git ls-files -z)

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "::error::Found $violations macOS Finder-duplicate path(s). See KAN-357."
  echo "These ' <n>'-suffixed files/dirs shadow the canonical module and must not be committed."
  exit 1
fi

echo "No macOS Finder-duplicate files committed. ✓"
