#!/usr/bin/env bash
# scripts/check-action-pinning.sh
#
# SEC-77 finding F-22 (supply-chain) / regression guard for SEC-20 (#356):
# every remote GitHub Action referenced by a workflow must be pinned to a
# full 40-hex commit SHA, never a mutable tag or branch.
#
# Why: a mutable ref (e.g. `@v4`, `@main`) lets the upstream owner — or anyone
# who compromises the tag/branch — change the code that runs in our CI without
# our review. That is the classic third-party-action supply-chain vector.
# Pinning to an immutable commit SHA closes it. Pinning does NOT freeze the
# version: Dependabot still bumps the SHA as long as a trailing `# vX.Y.Z`
# comment records the human-readable version, so provenance stays honest and
# updates keep flowing.
#
# The one-time SHA-pin across the tree already happened (SEC-20 #356). This
# script is the DURABLE guard that stops a future PR from silently
# re-introducing an un-pinned action. It only inspects this repo's own
# workflow files — it never resolves or changes a SHA itself.
#
# Run from pr-checks.yml so any PR that (re)introduces a mutable ref fails CI.
#
# What counts as pinned:
#   uses: actions/checkout@<40-hex-sha>   # v4        ✓ pinned
#   uses: docker://image@sha256:<64-hex>              ✓ pinned (image digest)
#   uses: ./.github/workflows/reusable.yml            ✓ local (in-repo, exempt)
#   uses: actions/checkout@v4                         ✗ mutable tag
#   uses: some/action@main                            ✗ mutable branch
#
# Escape hatch (rare, must be justified): append
#   # integrity-ok: pin <reason>
# to the offending `uses:` line if a non-SHA ref is genuinely intentional.

set -euo pipefail

WORKFLOW_DIR=".github/workflows"
PROBLEMS=0

if [ ! -d "$WORKFLOW_DIR" ]; then
  echo "::error::No $WORKFLOW_DIR directory found"
  exit 1
fi

echo "Scanning $WORKFLOW_DIR for un-pinned (mutable-ref) actions..."
echo ""

for f in "$WORKFLOW_DIR"/*.yml; do
  [ -f "$f" ] || continue

  # Candidate lines: a `uses:` referencing a remote action `owner/repo[...]@ref`.
  # Local reusable workflows (`uses: ./...`) are in-repo and exempt.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    lineno="${line%%:*}"
    body="${line#*:}"

    # Already pinned? A full 40-hex commit SHA, or a docker image sha256
    # digest, immediately followed by end-of-token (space, '#', or EOL).
    if printf '%s' "$body" | grep -qE '@([0-9a-f]{40}|sha256:[0-9a-f]{64})([[:space:]#]|$)'; then
      continue
    fi
    # Intentional, documented exception on the same line?
    if printf '%s' "$body" | grep -qiE '#[[:space:]]*integrity-ok:[[:space:]]*pin'; then
      continue
    fi
    echo "::error file=$f,line=$lineno::un-pinned action (mutable ref) — pin to a full 40-hex commit SHA with a trailing '# vX.Y.Z' comment:$body"
    PROBLEMS=$((PROBLEMS + 1))
  done < <(grep -nE '^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@' "$f" \
             | grep -vE 'uses:[[:space:]]*\.' || true)
done

echo ""
if [ "$PROBLEMS" -eq 0 ]; then
  echo "✓ All workflow actions are SHA-pinned"
  exit 0
fi
echo "::error::Found $PROBLEMS un-pinned action reference(s). Pin to a commit SHA before merging."
echo "    A mutable tag/branch ref lets upstream change CI code without review (supply-chain risk)."
echo "    Dependabot keeps SHA pins current when a trailing '# vX.Y.Z' comment is present."
echo "    Intentional exception: append '# integrity-ok: pin <reason>' to the uses: line."
exit 1
