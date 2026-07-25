#!/usr/bin/env bash
#
# check-signup-surface-gate.sh — KAN-412 un-skippable signup gate (detection half).
#
# Decides whether a develop → staging promotion TOUCHES the user sign-up /
# account-creation surface, so the promotion workflow can require the signup E2E
# to have passed before it proceeds. See docs/SIGNUP_SURFACE_GATE.md.
#
#   Usage:  scripts/check-signup-surface-gate.sh <base-ref> <head-ref>
#           (compares base..head; e.g. origin/staging..origin/develop)
#           Or:  scripts/check-signup-surface-gate.sh --files <file-list-path>
#           (a newline-delimited list of changed paths, for testing.)
#
# Manifest: .github/signup-surface.paths (globs; '#'/blank ignored). Files under
# supabase/migrations/ are CONTENT-FILTERED: they count only if they reference
# the account-creation surface (SIGNUP_MIGRATION_PATTERN) — so ordinary
# migrations don't trip the gate, only ones that can alter account creation.
#
# Exit codes (fail-closed — an unverifiable gate is treated as TOUCHED):
#   0  CLEAN   — signup surface NOT touched; signup E2E not required this promotion
#   10 TOUCHED — signup surface touched; the signup E2E is REQUIRED and must pass
#   1  ERROR   — manifest missing/unreadable, or the diff could not be computed
#                (treated as TOUCHED by the caller — never a silent pass)
#
# Honesty (Workflow & Backup Integrity Policy / KAN-167): if we cannot read the
# manifest or compute the changed set, we FAIL rather than wave the promotion
# through — a gate that can't prove "clean" must assume "touched".
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="${SIGNUP_SURFACE_MANIFEST:-$ROOT/.github/signup-surface.paths}"
SIGNUP_MIGRATION_PATTERN="${SIGNUP_MIGRATION_PATTERN:-handle_new_user|auth\.users|on_auth_user|(create|alter) table[^;]*profiles}"

err() { echo "::error::signup-surface gate — $*"; }

# ── Resolve the changed file list ───────────────────────────────────────────
CHANGED=""
if [[ "${1:-}" == "--files" ]]; then
  FILE_LIST="${2:-}"
  if [[ -z "$FILE_LIST" || ! -r "$FILE_LIST" ]]; then
    err "cannot read --files list '$FILE_LIST'"; exit 1
  fi
  CHANGED="$(cat "$FILE_LIST")"
else
  BASE="${1:-}"; HEAD="${2:-}"
  if [[ -z "$BASE" || -z "$HEAD" ]]; then
    err "usage: $0 <base-ref> <head-ref>  (or --files <path>)"; exit 1
  fi
  if ! CHANGED="$(git -C "$ROOT" diff --name-only "$BASE" "$HEAD" 2>/dev/null)"; then
    err "git diff $BASE..$HEAD failed — cannot compute changed set (fail-closed)"; exit 1
  fi
fi

# ── Load the manifest ───────────────────────────────────────────────────────
if [[ ! -r "$MANIFEST" ]]; then
  err "manifest not readable: $MANIFEST (fail-closed → TOUCHED)"; exit 1
fi
GLOBS=()
while IFS= read -r line; do
  line="${line%%#*}"; line="$(echo "$line" | xargs 2>/dev/null || true)"
  [[ -n "$line" ]] && GLOBS+=("$line")
done < "$MANIFEST"
if [[ "${#GLOBS[@]}" -eq 0 ]]; then
  err "manifest has no patterns: $MANIFEST (fail-closed → TOUCHED)"; exit 1
fi

# fnmatch with '**' support via bash extended globbing.
shopt -s extglob globstar nullglob 2>/dev/null || true
matches_glob() { # <file> <glob>
  local f="$1" g="$2"
  # Translate '**' → match any depth; rely on bash [[ == ]] pattern matching.
  case "$f" in
    $g) return 0 ;;
  esac
  # '**' at the end (dir/**) should also match the dir prefix at any depth.
  if [[ "$g" == *'/**' ]]; then
    local pref="${g%/**}"
    [[ "$f" == "$pref/"* ]] && return 0
  fi
  return 1
}

TOUCHED_FILES=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  for g in "${GLOBS[@]}"; do
    if matches_glob "$file" "$g"; then
      # Content-filter migrations: only count ones that touch account creation.
      if [[ "$file" == supabase/migrations/* ]]; then
        target="$ROOT/$file"
        if [[ -r "$target" ]] && grep -Eqi "$SIGNUP_MIGRATION_PATTERN" "$target"; then
          TOUCHED_FILES+=("$file (migration → account-creation surface)")
        elif [[ ! -r "$target" ]]; then
          # Can't read the migration to content-filter → fail-closed: count it.
          TOUCHED_FILES+=("$file (migration, unreadable → fail-closed)")
        fi
        # Migration that does NOT reference the surface → not counted; keep scanning.
      else
        TOUCHED_FILES+=("$file")
      fi
      break
    fi
  done
done <<< "$CHANGED"

echo "signup-surface gate — manifest: $MANIFEST"
echo "changed files scanned: $(echo "$CHANGED" | grep -c . || true)"
if [[ "${#TOUCHED_FILES[@]}" -gt 0 ]]; then
  echo "RESULT: TOUCHED — the following changes hit the sign-up surface:"
  printf '  - %s\n' "${TOUCHED_FILES[@]}"
  echo "→ the un-skippable signup E2E is REQUIRED and must pass for this promotion."
  exit 10
fi
echo "RESULT: CLEAN — no sign-up-surface path touched; signup E2E not required this promotion."
exit 0
