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

# The sweep used to be (.github scripts docs), which left src/, supabase/,
# controls/ and qa-sweep/ unswept. Measured after the KAN-415 D1 extraction: 13
# live stale references had accumulated in those zones — including
# controls/registry.json's description of CTL-037, which told the reader that
# `src/lib/env.ts is exempt by design` when the exempt file had moved. A gate
# whose own registry misdescribes it is the failure this script exists for.
#
# Zero stale references existed in the three swept directories. The sweep was
# working perfectly, over a third of the estate.
SWEEP_DIRS=(.github scripts docs src supabase controls qa-sweep)
MANIFEST_DOC="docs/DOC_SOURCE_OF_TRUTH.md"
MODULE_MANIFEST="modules.json"
# Public, so this coupling can be CHECKED rather than attested (see mcp-repo below).
MCP_REPO="luisa-sys/lyra-mcp-server"
TEST_DIR="tests"

# Paths named verbatim inside claude.ai routine prompts (KAN-419 §5.2). These
# are prefixes: any moved path at or under one of them needs a routine-prompt
# review, because the prompt's copy of it cannot be updated by any PR.
# ⚠️ THESE ARE THE PROMPTS' SPELLINGS, NOT THE TREE'S. DO NOT REWRITE ON A MOVE.
#
# This list mirrors text that lives in claude.ai routine prompts, outside every
# repository CI can read. Its entries are correct when they match what the
# PROMPT says — which, after a move and before Luisa edits the prompt, is the
# OLD path. That is the whole reason the attestation exists.
#
# The check below compares MOVED-FROM paths against this list. So rewriting an
# entry to its new path in the same commit that moves the file makes the moved
# path stop matching, the gate report "not applicable", and the attestation —
# the one saying a human must go and update the prompt — silently disappear.
# A commit that carries itself through the gate it is disabling.
#
# That happened here: KAN-415's tail moved invite-text.ts and beta-access/
# email.ts, a blanket path rewrite caught this list too, and the gate went
# quiet. Caught by reading the diff, not by any control — nothing registers
# these patterns with CTL-035, so a dead entry here is invisible.
#
# An entry may only be updated once the corresponding routine prompt has
# actually been edited, in a commit that says so.
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

VALID_CHECKS=(stale-refs doc-manifest module-manifest test-estate out-of-repo coverage routine-prompts mcp-repo)
is_valid_check() {
  local c="$1" v
  for v in "${VALID_CHECKS[@]}"; do [ "$c" = "$v" ] && return 0; done
  return 1
}

HATCH_BAD=0
# bash 3.2 (macOS) errors on expanding an EMPTY array under `set -u`; bash 4.4+
# does not. Every run with no escape hatch therefore died here on a developer
# machine while passing in CI — 18 permanently-red tests that trained everyone
# to stop reading this suite (gotcha #28). The `+` form expands to nothing when
# the array is empty and is identical on both.
for line in ${HATCH_LINES[@]+"${HATCH_LINES[@]}"}; do
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

# ── Dated evidence is not drift (KAN-415) ───────────────────────────────────
# A handful of tracked files are RECORDS OF WHAT WAS TRUE ON A DATE, not
# descriptions of the tree: generated scan snapshots, a superseded scanner, the
# dated plan whose whole content is "these paths are about to move", and a
# run-ledger row. Rewriting an old path inside one of those does not fix drift —
# it falsifies the evidence, and the evidence is the reason the file exists.
#
# Without this, every remaining extraction (D2…D8) would have to waive
# `stale-refs` wholesale via the escape hatch, which is far weaker: the hatch
# turns the entire check off, including for the live artefacts that genuinely
# must be updated. A narrow, named list keeps the check sharp everywhere else.
#
# Two rules keep this from becoming a suppression list:
#   1. LITERAL PATHS ONLY, never globs or a directory. A glob would silently
#      adopt future files nobody decided to archive.
#   2. EVERY SUPPRESSED HIT IS PRINTED on every run. An exclusion that is
#      silent is indistinguishable from a check that does not run — the exact
#      SEC-79 failure this script exists to prevent. These are visible, they
#      just do not fail the build.
ARCHIVE_FILES=(
  "docs/modularisation/data/kan422-dead-exports.json"     # KAN-422 dead-export scan output
  "docs/modularisation/data/kan432-revalidation.json"     # KAN-432 plan-revalidation snapshot
  "docs/modularisation/data/kan421-profiles-inventory.json" # KAN-421 profiles survey: a per-file
                                                           # census taken on a date, like its two
                                                           # siblings above
  "docs/modularisation/KAN-416-boundaries-allowlist.seed.json" # KAN-416 boundary SEED: the
                                                           # measured edge list that seeded the
                                                           # allowlist. Rewriting an edge would
                                                           # falsify what was measured.
  "docs/modularisation/kan419-scan.py"                    # superseded by scripts/check-guard-path-drift.py
  "docs/modularisation/LYRA_MODULARISATION_PLAN_2026-07-26.md"  # dated plan: names the pre-move layout by design
  "docs/modularisation/KAN-414-F4-HANDOVER-2026-08-01.md" # dated handover: a snapshot of that day's findings
  "docs/modularisation/KAN-414-F6-threading-fallout.md"   # a MEASUREMENT of 2026-07-29, whose own text says the doc is the deliverable
  "docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md"              # dated run-ledger rows quote the paths of the day
  # ── The WRITE-UPS whose DATA files are already archived above (KAN-415 tail) ──
  # This list archived the .json outputs and missed their .md counterparts, so
  # every extraction rewrote the prose while protecting the data. The two halves
  # of the same measurement then disagree.
  #
  # Not hypothetical, and the damage is already done: KAN-419-path-coupling.md
  # says "Produced: 2026-07-27 · Tracked files at scan time: 791" and today
  # contains 19 references to `src/modules/` — a directory that did not exist
  # when that scan ran. D1..D9 rewrote them. Restoring the original text needs
  # git archaeology and is tracked separately; adding them here stops the
  # bleeding.
  #
  # Each one states its own status in its header — "Spike · research artefact ·
  # read-only", with a Produced/Run date and the exact commit it was measured
  # at. That is the test for membership of this list: a file pinned to a SHA is
  # describing a moment, not the tree.
  "docs/modularisation/KAN-419-path-coupling.md"          # scan of 2026-07-27; its LIVE/DEAD table IS the measurement
  "docs/modularisation/KAN-421-profiles-god-table.md"     # run of 2026-07-28 @ 1cadd57; file:line census, sibling of the archived .json
  "docs/modularisation/KAN-416-module-manifest.md"        # derivation of 2026-07-28 @ 1d6cb5f
  "docs/modularisation/PLAN-REVALIDATION-2026-07-28.md"   # KAN-432 re-derivation @ 674f0a7; sibling of the archived kan432-revalidation.json
)

# Whole directories that are records rather than descriptions. Kept separate
# from ARCHIVE_FILES because the membership test is a prefix, not equality —
# and deliberately short, for the same reason ARCHIVE_FILES is literal.
ARCHIVE_DIRS=(
  "supabase/migrations/"   # APPLIED history. Editing one changes nothing on any
                           # database and destroys the record of what actually ran.
                           # Three of them name a path D1 moved; all three are correct.
)
is_archival() {
  local f="$1" a d
  for a in "${ARCHIVE_FILES[@]}"; do [ "$f" = "$a" ] && return 0; done
  for d in "${ARCHIVE_DIRS[@]}"; do case "$f" in "$d"*) return 0 ;; esac; done
  return 1
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
  archived=0
  for old in "${MOVED[@]}"; do
    out="$(search "stale-refs sweep for '${old}'" grep -rnHF --exclude-dir=node_modules -- "$old" "${SWEEP_PRESENT[@]}")"
    out="$(search "stale-refs manifest split" grep -vF "${MANIFEST_DOC}:" - <<<"$out")"
    [ -z "${out//[[:space:]]/}" ] && out=""
    [ -z "$out" ] && continue

    # Split the hits into live (fail) and archival (report only). Done per-line
    # rather than by pre-filtering the search, so an archival file that stops
    # being archival is one list edit away from failing again.
    live=""
    arch=""
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      if is_archival "${hit%%:*}"; then
        arch="${arch}${hit}"$'\n'
      else
        live="${live}${hit}"$'\n'
      fi
    done <<<"$out"

    if [ -n "${live//[[:space:]]/}" ]; then
      hits=1
      echo "::error::check-extraction-dod: [stale-refs] stale reference to moved path '${old}':"
      while IFS= read -r hit; do
        [ -z "$hit" ] && continue
        echo "::error::    ${hit}"
      done <<<"$live"
    fi
    if [ -n "${arch//[[:space:]]/}" ]; then
      archived=1
      echo "check-extraction-dod: [stale-refs] '${old}' also appears in dated evidence (recorded, not failed):"
      while IFS= read -r hit; do
        [ -z "$hit" ] && continue
        echo "check-extraction-dod:     ${hit%%:*}:$(echo "${hit#*:}" | cut -d: -f1)"
      done <<<"$arch"
    fi
  done
  if [ "$archived" -eq 1 ]; then
    echo "check-extraction-dod: [stale-refs] the lines above are in ARCHIVE_FILES — records of what was true on a date. Rewriting them would falsify the record, so they are printed rather than enforced."
  fi
  if [ "$hits" -eq 1 ]; then FAILED=1; else
    echo "check-extraction-dod: [stale-refs] clean — no moved path is still referenced in ${SWEEP_PRESENT[*]} (outside dated evidence)."
  fi
fi

sweep doc-manifest "$MANIFEST_DOC"
sweep module-manifest "$MODULE_MANIFEST"
sweep test-estate "$TEST_DIR"

# ------------------------------------------------------- PR-body attestations
#
# ⚠️ TWO THINGS ABOUT EDITING THESE ANSWERS THAT WILL WASTE YOUR TIME (KAN-473).
#
# 1. EDITING THE PR BODY DOES NOT RE-RUN THIS GATE, and re-running the failed
#    job does not pick the edit up either. pr-checks.yml triggers on
#    `pull_request` with the default activity types — opened, synchronize,
#    reopened — so `edited` fires nothing; and `PR_BODY` is interpolated from
#    `github.event.pull_request.body`, which is frozen in the run's event
#    payload, so a re-run replays the ORIGINAL body. Fixing an attestation
#    therefore requires a PUSH. Verified 2026-08-12: a corrected body plus
#    `rerun_failed_jobs` reproduced the identical failure, and the re-run's own
#    log echoed the stale text.
#
# 2. THE MARKER MUST START THE LINE (modulo a bullet and a checkbox) — see the
#    regex in attest(). Markdown emphasis around it does not survive:
#
#        - [x] **EXTRACTION-DOD-COVERAGE:** playwright project 'public-pages'
#                ^^ the `**` sits between the checkbox and the marker, so the
#                   line does not match and the answer reads as ABSENT
#        - [x] EXTRACTION-DOD-COVERAGE: playwright project 'public-pages'   <- ok
#
#    The failure mode is worth naming because it is indistinguishable from the
#    one it is not: a gate that read none of your three answers reports exactly
#    what a gate that read them and disagreed would report. Three answers were
#    written, all three were bolded, and all three came back "the PR body has
#    no '<marker>' line".
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
  "If this PR moves src/app/globals.css or any ui-kit file, the design-system source pointer must be updated and the generator re-run before merge (KAN-419 §5.1). Answer 'done' or 'n/a — <reason>'. CI cannot check this: the design system is in git at github.com/luisa-sys/lyra-design-system, but that is a different repo this CI cannot read (KAN-441)."

attest out-of-repo "EXTRACTION-DOD-ROUTINE-PROMPTS" \
  "If this PR renames a script or changes a protected-surface path list named verbatim in a claude.ai routine prompt, the prompt must be updated in the same session (KAN-419 §5.2). Answer 'done' or 'n/a — <reason>'. CI cannot check this: routine prompts are not in git."

# ── mcp-repo: the OTHER repo points back at this one ────────────────────────
# The DoD had two out-of-repo couplings, both human attestations, because
# neither the design-system repo nor the claude.ai routine prompts can be read
# from CI. luisa-sys/lyra-mcp-server is different: it is PUBLIC, so this is a
# real check rather than a ticked box — and a ticked box is what we would
# otherwise be adding, for a coupling that has already broken.
#
# It HAD already broken, silently, in the D1 extraction. Three files in that
# repo point at lyra paths that no longer exist:
#   src/sentry-scrub.ts:4        "port of the web app's src/lib/sentry-scrub.ts"
#   src/sanitise.ts:17           "mirrors the web app's src/lib/sanitise.ts"
#   tests/sentry-scrub.test.cjs:9  "port of lyra/src/lib/sentry-scrub.ts"
#
# Those comments are the ONLY instruction telling a maintainer where the
# authoritative copy lives. src/sanitise.ts carries the SEC-59 / CodeQL
# incomplete-multi-character-sanitization fix; apply the next fix of that class
# in lyra and follow the pointer from the MCP repo, and you get nothing. Both
# suites stay green while the mirror drifts — the BUGS-85 shape exactly.
#
# Uses the same zero-secret route as CTL-043: public repo, built-in GITHUB_TOKEN.
if is_suppressed mcp-repo; then
  echo "check-extraction-dod: [mcp-repo] SKIPPED by an active exception."
elif [ -z "${MCP_TARBALL:-}" ] && ! command -v gh >/dev/null 2>&1; then
  # gh is only actually invoked below when MCP_TARBALL is unset (the `gh api`
  # tarball download). When MCP_TARBALL IS set — the test suite's injection
  # point, or an operator's own pre-fetched tarball — gh is never called, so
  # its mere absence must not fail this check closed.
  die_unverifiable "gh is not available, so the lyra-mcp-server back-references could not be checked. This coupling has already broken once undetected."
else
  # ONE request. The first cut fetched every candidate file once per moved path
  # — ~200 files x 18 paths — which is thousands of API calls and minutes of
  # wall-clock on a gate that must not tempt anyone into skipping it.
  MCP_TMP="$(mktemp -d)"
  trap 'rm -rf "$MCP_TMP"' EXIT
  # MCP_TARBALL lets the test suite INJECT a fixture instead of hitting the
  # network. Deliberately an injection point rather than a skip flag: the check
  # still runs end to end, so its detection logic is covered, and there is no
  # `if TESTING then pass` branch — that pattern is how a gate gets switched off
  # in production by an env var nobody remembers setting (KAN-167).
  if [ -n "${MCP_TARBALL:-}" ]; then
    if [ ! -r "$MCP_TARBALL" ]; then
      die_unverifiable "MCP_TARBALL is set to '${MCP_TARBALL}' but that file is not readable."
    fi
    cp "$MCP_TARBALL" "$MCP_TMP/repo.tar.gz"
  elif ! gh api "repos/${MCP_REPO}/tarball/HEAD" > "$MCP_TMP/repo.tar.gz" 2>/dev/null; then
    die_unverifiable "could not download ${MCP_REPO} (tarball request failed). Refusing to report a clean cross-repo check that did not run."
  fi
  if ! tar -xzf "$MCP_TMP/repo.tar.gz" -C "$MCP_TMP" 2>/dev/null; then
    die_unverifiable "could not unpack the ${MCP_REPO} tarball."
  fi
  MCP_SRC="$(find "$MCP_TMP" -maxdepth 1 -type d -name '*lyra-mcp-server*' | head -1)"
  [ -z "$MCP_SRC" ] && MCP_SRC="$(find "$MCP_TMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
  if [ -z "$MCP_SRC" ] || [ ! -d "$MCP_SRC" ]; then
    die_unverifiable "unpacked ${MCP_REPO} but found no source directory — the layout changed."
  fi
  # Prove the corpus is real before trusting a clean answer from it.
  MCP_FILE_COUNT="$(find "$MCP_SRC" -type f \( -name '*.ts' -o -name '*.cjs' -o -name '*.mjs' -o -name '*.js' -o -name '*.md' -o -name '*.json' \) | wc -l | tr -d ' ')"
  if [ "${MCP_FILE_COUNT:-0}" -lt 10 ]; then
    die_unverifiable "${MCP_REPO} unpacked to only ${MCP_FILE_COUNT} source files — that is not credible, so a clean result would be meaningless."
  fi
  mcp_hits=0
  for old in "${MOVED[@]}"; do
    out="$(search "mcp-repo scan for '${old}'" grep -rnHF --include='*.ts' --include='*.tsx' --include='*.cjs' --include='*.mjs' --include='*.js' --include='*.md' --include='*.json' --include='*.yml' --include='*.yaml' -- "$old" "$MCP_SRC")"
    [ -z "${out//[[:space:]]/}" ] && continue
    mcp_hits=1
    echo "::error::check-extraction-dod: [mcp-repo] ${MCP_REPO} still points at '${old}':"
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      echo "::error::    ${hit#"$MCP_SRC"/}"
    done <<<"$out"
  done
  if [ "$mcp_hits" -eq 1 ]; then
    echo "::error::check-extraction-dod: [mcp-repo] Those comments are the only instruction saying where the authoritative copy lives."
    echo "::error::  Open a linked PR on ${MCP_REPO} updating them (MCP-main lockstep policy, KAN-222), then re-run."
    FAILED=1
  else
    echo "check-extraction-dod: [mcp-repo] no file in ${MCP_REPO} references a moved path. ✓"
  fi
fi

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
