#!/usr/bin/env bash
# scripts/check-extraction-dod.sh
#
# KAN-428 — the Extraction Definition-of-Done gate (guard #13).
#
# The modularisation programme's primary activity is MOVING FILES. Everything
# that classifies a file by its PATH — CI gates, manifests, docs, runbooks,
# mutation globs, the signup-surface list — keeps reporting green after a move
# while protecting nothing. KAN-419's inventory measured the baseline: the
# unguarded doc layer had already rotted to 18% dead path literals before
# anybody moved a file on purpose.
#
# So the estate rework is not a closing phase. It ships in the SAME PR as the
# move, and this guard is what makes that non-optional.
#
# WHAT IT DOES
#   The guard is INERT unless the PR deletes or renames a file under `src/`
#   (an "extraction PR"). When it fires, for every moved-FROM path it requires:
#
#     stale-refs      no literal reference to the old path remains in
#                     `.github/`, `scripts/` or `docs/`
#     doc-manifest    no literal reference remains in
#                     `docs/DOC_SOURCE_OF_TRUTH.md` (called out separately
#                     because the doc-mirror guards key off that file)
#     module-manifest no literal reference remains in `modules.json` — the
#                     module's path entry moved with it
#     test-estate     no literal reference remains under `tests/` — the
#                     module's tests moved with it
#
#   and, from the PR body (the template supplies the lines):
#
#     out-of-repo     both out-of-repo attestations are answered
#     coverage        the covering Playwright project + soak clause are named,
#                     or `no coverage` is recorded as a finding
#     routine-prompts when a moved path is named verbatim in a claude.ai
#                     routine prompt, the PR body names the routine + trigger ID
#
#   `out-of-repo` and `routine-prompts` are HUMAN attestations, and the DoD doc
#   says so plainly: `~/lyra-design-system/build.py` and the routine prompts
#   live outside every repository this CI can read, so no grep will ever see
#   their drift (KAN-419 §5). A ticked box is weaker than a machine check. It
#   is not dressed up as equivalent — it is simply the only control available.
#
# FAIL-CLOSED (exit 2, never a silent pass — Workflow & Backup Integrity Policy)
#   * the diff base cannot be resolved, so we cannot tell if this is an
#     extraction PR at all (unlike KAN-411's UI guard there is no CODEOWNERS
#     backstop underneath this one, so "unknown" must not mean "fine");
#   * an artefact we must read is missing or unparseable;
#   * an extraction PR whose body is unavailable — an unverifiable human
#     attestation is a failed one.
#
# ESCAPE HATCH
#   A commit in the range may carry:
#       EXTRACTION-DOD-OK: <JIRA-KEY> <check-id>
#   It suppresses EXACTLY the named check and nothing else, requires a Jira
#   key, and every active exception is printed on every run — the
#   `UI-Change-Approved` loudness standard. Exceptions are counted; more than
#   3 emits a ::warning:: that the hatch is papering over drift.
#
# EXIT CODES
#   0  pass (including: not an extraction PR)
#   1  DoD violation
#   2  cannot verify — fail closed
#
# ENV
#   BASE_REF      default origin/develop
#   HEAD_REF      default HEAD
#   PR_BODY       the pull-request description
#   PR_BODY_FILE  file holding it (takes precedence; used by CI and the tests)
#
# See docs/MODULARISATION_EXTRACTION_DOD.md for the per-path checklist this
# enforces, and docs/modularisation/KAN-419-path-coupling.md for the register
# it is derived from.
set -uo pipefail

BASE_REF="${BASE_REF:-origin/develop}"
HEAD_REF="${HEAD_REF:-HEAD}"

SWEEP_DIRS=(.github scripts docs)
MANIFEST_DOC="docs/DOC_SOURCE_OF_TRUTH.md"
MODULE_MANIFEST="modules.json"
TEST_DIR="tests"

# Paths named verbatim inside claude.ai routine prompts (KAN-419 §5.2). These
# are prefixes: any moved path at or under one of them needs a routine-prompt
# review, because the prompt's copy of it cannot be updated by any PR.
ROUTINE_COUPLED=(
  "scripts/staging-soak.sh"
  "scripts/check-ui-copy-ownership.sh"
  "src/app/globals.css"
  "src/components"
  "src/lib/invite-text.ts"
  "src/lib/convene/invites"
  "src/lib/beta-access/email.ts"
  "src/app/dashboard/profile/affiliation-fields.ts"
  "src/app/dashboard/convene/organise/organise-fields.ts"
)

die_unverifiable() {
  echo "::error::check-extraction-dod: $1"
  echo "::error::  Failing closed (exit 2): this gate protects other gates, so 'cannot verify' must never read as 'fine'."
  exit 2
}

# Run a search and print its hits. grep exits 1 for "no match" — which is the
# answer we want — but >=2 for "the search itself failed", and THAT must never
# be laundered into a clean result. Hence no error-swallowing fallback anywhere
# in this script: on a verification command, swallowing an error is
# indistinguishable from a pass (KAN-167).
search() {
  local desc="$1"; shift
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [ "$rc" -gt 1 ]; then
    die_unverifiable "${desc}: the search command failed (exit ${rc}): ${out}"
  fi
  [ "$rc" -eq 0 ] && printf '%s\n' "$out"
  return 0
}

# Run a git command that must succeed; anything else is unverifiable.
git_or_die() {
  local desc="$1"; shift
  local out rc
  out="$(git "$@" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    die_unverifiable "${desc}: \`git $*\` failed (exit ${rc}): ${out}"
  fi
  printf '%s\n' "$out"
}

# ---------------------------------------------------------------- diff range
if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  die_unverifiable "base ref '$BASE_REF' not found — cannot compute the change range."
fi
MERGE_BASE="$(git merge-base "$BASE_REF" "$HEAD_REF" 2>/dev/null)" || MERGE_BASE=""
if [ -z "$MERGE_BASE" ]; then
  die_unverifiable "no merge-base for ${BASE_REF}..${HEAD_REF} — cannot compute the change range."
fi

# Moved-FROM paths under src/: D (deleted) and R (renamed) entries.
MOVED=()
while IFS=$'\t' read -r st old _rest; do
  [ -z "${st:-}" ] && continue
  case "$st" in
    D*|R*) ;;
    *) continue ;;
  esac
  case "$old" in
    src/*) MOVED+=("$old") ;;
  esac
done <<<"$(git_or_die "computing the change range" diff --name-status -M "$MERGE_BASE" "$HEAD_REF")"

if [ "${#MOVED[@]}" -eq 0 ]; then
  echo "check-extraction-dod: no file under src/ was deleted or renamed in this range — not an extraction PR. OK."
  exit 0
fi

echo "check-extraction-dod: extraction PR detected — ${#MOVED[@]} moved path(s) under src/:"
printf '  moved: %s\n' "${MOVED[@]}"

# ------------------------------------------------------------- escape hatches
COMMIT_MSGS="$(git_or_die "reading commit messages" log "${MERGE_BASE}..${HEAD_REF}" --format=%B)"
HATCH_RE='^EXTRACTION-DOD-OK:[[:space:]]*[A-Z][A-Z0-9]+-[0-9]+[[:space:]]+[a-z-]+[[:space:]]*$'
BARE_HATCH_RE='^EXTRACTION-DOD-OK:'

SUPPRESSED=()
HATCH_LINES=()
while IFS= read -r line; do
  [ -z "$line" ] && continue
  HATCH_LINES+=("$line")
done <<<"$(search "escape-hatch scan" grep -E "$BARE_HATCH_RE" - <<<"$COMMIT_MSGS")"

VALID_CHECKS=(stale-refs doc-manifest module-manifest test-estate out-of-repo coverage routine-prompts)
is_valid_check() {
  local c="$1" v
  for v in "${VALID_CHECKS[@]}"; do [ "$c" = "$v" ] && return 0; done
  return 1
}

HATCH_BAD=0
for line in "${HATCH_LINES[@]}"; do
  # strip trailing CR / whitespace
  line="${line%$'\r'}"
  if ! grep -Eq "$HATCH_RE" <<<"$line"; then
    echo "::error::check-extraction-dod: malformed escape hatch: '${line}'"
    echo "::error::  required form: 'EXTRACTION-DOD-OK: <JIRA-KEY> <check-id>' — a bare marker, a missing Jira key or a missing check-id is itself a failure."
    HATCH_BAD=1
    continue
  fi
  key="$(awk '{print $2}' <<<"$line")"
  chk="$(awk '{print $3}' <<<"$line")"
  if ! is_valid_check "$chk"; then
    echo "::error::check-extraction-dod: escape hatch names unknown check '${chk}' (${key}). Known: ${VALID_CHECKS[*]}"
    HATCH_BAD=1
    continue
  fi
  SUPPRESSED+=("$chk")
  echo "check-extraction-dod: ACTIVE EXCEPTION — check '${chk}' suppressed by ${key}"
done

if [ "${#SUPPRESSED[@]}" -gt 3 ]; then
  echo "::warning::check-extraction-dod: ${#SUPPRESSED[@]} checks suppressed in one PR — the escape hatch is being used to paper over estate drift, not to record a considered exception."
fi

is_suppressed() {
  local c="$1" s
  for s in "${SUPPRESSED[@]:-}"; do [ "$s" = "$c" ] && return 0; done
  return 1
}

FAILED=0
[ "$HATCH_BAD" -eq 1 ] && FAILED=1

# -------------------------------------------------------- reference sweeps
# Report every remaining literal reference to a moved-from path, with file:line.
sweep() {
  local check="$1"; shift
  local -a targets=("$@")
  local -a present=()
  local t
  for t in "${targets[@]}"; do
    [ -e "$t" ] && present+=("$t")
  done
  if [ "${#present[@]}" -eq 0 ]; then
    die_unverifiable "check '${check}': none of the artefacts [${targets[*]}] exist — the estate cannot be swept."
  fi
  if is_suppressed "$check"; then
    echo "check-extraction-dod: [${check}] SKIPPED by an active exception."
    return 0
  fi
  local hits=0 old
  for old in "${MOVED[@]}"; do
    local out
    out="$(search "${check} sweep for '${old}'" grep -rnHF --exclude-dir=node_modules -- "$old" "${present[@]}")"
    if [ -n "$out" ]; then
      hits=1
      echo "::error::check-extraction-dod: [${check}] stale reference to moved path '${old}':"
      while IFS= read -r hit; do
        [ -z "$hit" ] && continue
        echo "::error::    ${hit}"
      done <<<"$out"
    fi
  done
  if [ "$hits" -eq 1 ]; then
    FAILED=1
  else
    echo "check-extraction-dod: [${check}] clean — no moved path is still referenced."
  fi
}

# `stale-refs` owns .github/ + scripts/ + docs/, minus the mirror manifest,
# which `doc-manifest` owns so the two can be excepted independently.
SWEEP_PRESENT=()
for d in "${SWEEP_DIRS[@]}"; do [ -d "$d" ] && SWEEP_PRESENT+=("$d"); done
if [ "${#SWEEP_PRESENT[@]}" -eq 0 ]; then
  die_unverifiable "none of the estate directories [${SWEEP_DIRS[*]}] exist — the estate cannot be swept."
fi
if is_suppressed stale-refs; then
  echo "check-extraction-dod: [stale-refs] SKIPPED by an active exception."
else
  hits=0
  for old in "${MOVED[@]}"; do
    out="$(search "stale-refs sweep for '${old}'" grep -rnHF --exclude-dir=node_modules -- "$old" "${SWEEP_PRESENT[@]}")"
    out="$(search "stale-refs manifest split" grep -vF "${MANIFEST_DOC}:" - <<<"$out")"
    [ -z "${out//[[:space:]]/}" ] && out=""
    if [ -n "$out" ]; then
      hits=1
      echo "::error::check-extraction-dod: [stale-refs] stale reference to moved path '${old}':"
      while IFS= read -r hit; do
        [ -z "$hit" ] && continue
        echo "::error::    ${hit}"
      done <<<"$out"
    fi
  done
  if [ "$hits" -eq 1 ]; then FAILED=1; else
    echo "check-extraction-dod: [stale-refs] clean — no moved path is still referenced in ${SWEEP_PRESENT[*]}."
  fi
fi

sweep doc-manifest "$MANIFEST_DOC"
sweep module-manifest "$MODULE_MANIFEST"
sweep test-estate "$TEST_DIR"

# ------------------------------------------------------- PR-body attestations
PR_BODY_TEXT=""
if [ -n "${PR_BODY_FILE:-}" ]; then
  [ -f "$PR_BODY_FILE" ] || die_unverifiable "PR_BODY_FILE '$PR_BODY_FILE' does not exist."
  PR_BODY_TEXT="$(cat "$PR_BODY_FILE")"
else
  PR_BODY_TEXT="${PR_BODY:-}"
fi

if [ -z "${PR_BODY_TEXT//[[:space:]]/}" ]; then
  die_unverifiable "this is an extraction PR but the PR body is empty or unavailable — the out-of-repo attestations cannot be read, and an unverifiable human attestation is a failed one."
fi

# An attestation line must carry a non-empty answer after the colon.
attest() {
  local check="$1" marker="$2" what="$3"
  if is_suppressed "$check"; then
    echo "check-extraction-dod: [${check}] SKIPPED by an active exception."
    return 0
  fi
  local line
  line="$(search "${check} attestation scan" grep -m1 -E "^[[:space:]]*[-*]?[[:space:]]*(\[[ xX]\][[:space:]]*)?${marker}" - <<<"$PR_BODY_TEXT")"
  if [ -z "$line" ]; then
    echo "::error::check-extraction-dod: [${check}] the PR body has no '${marker}' line. ${what}"
    FAILED=1
    return 0
  fi
  local answer="${line#*${marker}}"
  answer="${answer#:}"
  answer="$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' <<<"$answer")"
  if [ -z "$answer" ]; then
    echo "::error::check-extraction-dod: [${check}] '${marker}' is present but unanswered. ${what}"
    FAILED=1
    return 0
  fi
  # An unedited template placeholder is not an attestation. The PR template
  # ships `FILL-IN` as the answer precisely so that leaving it fails.
  case "$answer" in
    *FILL-IN*)
      echo "::error::check-extraction-dod: [${check}] '${marker}' still carries the unedited template placeholder (FILL-IN). ${what}"
      FAILED=1
      return 0
      ;;
  esac
  echo "check-extraction-dod: [${check}] attested — ${marker} ${answer}"
  return 0
}

attest out-of-repo "EXTRACTION-DOD-DESIGN-SYSTEM" \
  "If this PR moves src/app/globals.css or any ui-kit file, the source pointer in ~/lyra-design-system/build.py must be updated and the generator re-run before merge (KAN-419 §5.1). Answer 'done' or 'n/a — <reason>'. CI cannot check this: build.py is on Luisa's machine and in no git repo."

attest out-of-repo "EXTRACTION-DOD-ROUTINE-PROMPTS" \
  "If this PR renames a script or changes a protected-surface path list named verbatim in a claude.ai routine prompt, the prompt must be updated in the same session (KAN-419 §5.2). Answer 'done' or 'n/a — <reason>'. CI cannot check this: routine prompts are not in git."

attest coverage "EXTRACTION-DOD-COVERAGE" \
  "Name the Playwright project and the soak contract clause (C1-C6) covering the moved module, or write 'no coverage' — recording the gap is a finding, hiding it is a regression."

# routine-prompts: only fires when a moved path is one the prompts name verbatim.
ROUTINE_HITS=()
for old in "${MOVED[@]}"; do
  for rc in "${ROUTINE_COUPLED[@]}"; do
    case "$old" in
      "$rc"|"$rc"/*) ROUTINE_HITS+=("$old") ;;
    esac
  done
done

if [ "${#ROUTINE_HITS[@]}" -eq 0 ]; then
  echo "check-extraction-dod: [routine-prompts] no moved path is named in a routine prompt — not applicable."
elif is_suppressed routine-prompts; then
  echo "check-extraction-dod: [routine-prompts] SKIPPED by an active exception."
else
  printf '::warning::check-extraction-dod: moved path is named verbatim in a claude.ai routine prompt: %s\n' "${ROUTINE_HITS[@]}"
  if grep -qE 'trig_[A-Za-z0-9]+' <<<"$PR_BODY_TEXT"; then
    echo "check-extraction-dod: [routine-prompts] PR body names a routine trigger ID. OK."
  else
    echo "::error::check-extraction-dod: [routine-prompts] this PR moves a path named verbatim in a claude.ai routine prompt, but the PR body names no routine trigger ID."
    echo "::error::  Name the affected routine and its trig_… ID (see docs/OPS_ROUTINES_CONTROL_ROOM.md). Luisa updates the prompt; no PR can."
    FAILED=1
  fi
fi

# ------------------------------------------------------------------- verdict
if [ "${#SUPPRESSED[@]}" -gt 0 ]; then
  echo "check-extraction-dod: ${#SUPPRESSED[@]} active exception(s) this run: ${SUPPRESSED[*]}"
fi

if [ "$FAILED" -eq 0 ]; then
  echo "check-extraction-dod: extraction Definition-of-Done satisfied. OK."
  exit 0
fi

cat <<'EOF'

The Extraction Definition-of-Done (KAN-428) is not satisfied. An extraction
carries its own estate rework in the SAME PR — see
docs/MODULARISATION_EXTRACTION_DOD.md for the per-path checklist, and
docs/modularisation/KAN-419-path-coupling.md for why (an unguarded path layer
rots at 18% before anyone moves a file on purpose).

Fix the references, or record a considered exception on a commit in this PR:

  EXTRACTION-DOD-OK: <JIRA-KEY> <check-id>

which suppresses exactly one check. Known check-ids:
  stale-refs  doc-manifest  module-manifest  test-estate
  out-of-repo  coverage  routine-prompts
EOF
exit 1
