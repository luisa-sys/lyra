#!/usr/bin/env bash
# scripts/check-ui-copy-ownership.sh
#
# KAN-411 — machine backstop for the "LOOK AND TEXT belong to Luisa" rule.
#
# The look and text of Lyra's user-facing pages are Luisa's to own: such work
# must be FOUNDER-INITIATED, and the Backlog Autopilot must skip it (see
# CLAUDE.md "LOOK AND TEXT", the autopilot House rules 9/10 on Confluence
# Control Room 33554434, and the `ui-approval-required` Jira label). Until now
# that rule lived only in prompts, policy docs and CODEOWNERS. This guard makes
# it a mechanical PR gate.
#
# What it does: over the PR's change range it classifies every changed file
# against the FOUNDER-OWNED UI/COPY surface (mirrored 1:1 from the autopilot's
# protected-surface list so the guard and the robot agree). If any protected
# path is touched, it requires an approval trailer on a commit in the range:
#   * UI-Change-Approved:  <JIRA-KEY> — a Luisa-initiated design/copy change.
#   * UI-Bugfix-Only:      <JIRA-KEY> — a fix STRICTLY limited to a text error
#                                       (typo/wrong/stale string) or a rendering
#                                       error (blank page, broken layout, styling
#                                       regression), which *restores* the intended
#                                       design rather than changing it.
#   * UI-No-Visual-Change: <JIRA-KEY> — the diff touches a protected path but
#                                       changes NEITHER the rendered output NOR
#                                       any user-visible string. See below.
#
# WHY THE THIRD TRAILER EXISTS (SEC-152).
# The guard matches on PATH, so any .tsx under src/app trips it — including
# changes that alter no pixel and no word: threading a prop, a type signature, a
# rename, a parameter passed through to a server action. For those, BOTH of the
# original trailers are false statements. `UI-Change-Approved` asserts the
# founder approved a design change that does not exist; `UI-Bugfix-Only` asserts
# a text or rendering error that does not exist either.
#
# That mattered more than a wording quibble. CLAUDE.md already records the trap
# that "the trailer is a string, not evidence" — a gate reads a commit message
# and cannot read a design. That analysis assumed the failure mode is someone
# claiming approval they do not have. This is the MIRROR IMAGE and is more
# corrosive: a rule that forces a routine, unavoidable misstatement teaches
# everyone that the trailer is a formality to satisfy rather than a claim to
# mean. Once it is noise, the founder-approval signal is worth nothing, and the
# first genuinely unapproved design change rides through on the same reflex.
#
# Concrete case: SEC-46 Phase C (2026-08-16) threaded an RFC 8707 `resource`
# parameter through src/app/oauth/authorize/page.tsx — six lines, zero design
# delta, zero copy delta. It shipped under `UI-Bugfix-Only:` with the
# discrepancy disclosed in the commit body, the PR and this ticket, because
# there was no honest option.
#
# ⚠️ WHAT WAS DELIBERATELY *NOT* DONE: carving src/app/oauth/** out of
# `is_protected`. That path genuinely holds founder-owned consent-screen copy,
# and narrowing the surface would remove it from ownership permanently and
# SILENTLY — the KAN-473 failure exactly, where extracting three components to
# src/modules/ would have dropped them out of protection with no red build. A
# third trailer keeps the surface intact and makes the claim honest.
#
# ⚠️ AND THE HONEST LIMIT OF IT: this trailer is checked no more than the other
# two. Nothing here verifies that the diff really is visually inert — a changed
# className changes rendering, and no cheap static test distinguishes that from
# a renamed variable. It is a truthful CLAIM, not evidence, and it is recorded
# as such rather than dressed up as a check.
#
# No trailer → HARD FAIL (a false positive only forces a human to add a trailer;
# a false negative would let the product's voice/look drift silently, which is
# the case we bias hard against).
#
# Fail-OPEN only on infrastructure failure: if the diff base cannot be resolved
# (shallow/detached CI history), we emit a ::warning:: and pass, because
# CODEOWNERS still requires Luisa's review on every one of these paths — a git
# hiccup must not block every unrelated PR. When the base IS resolvable the gate
# is strict.
#
# Range: merge-base(BASE_REF, HEAD_REF)..HEAD_REF.
#   BASE_REF defaults to origin/develop; HEAD_REF defaults to HEAD. Both are
#   overridable via env so the unit tests can drive crafted histories.
set -euo pipefail

# ---------------------------------------------------------------------------
# --describe : emit the founder-owned surface, DERIVED from is_protected()
# ---------------------------------------------------------------------------
#
# KAN-474. This exists because the surface was maintained in TWO places — this
# guard, and the Backlog Autopilot's prompt, which is a SaaS routine no CI job
# can read. They are supposed to be 1:1 mirrors. They drifted twice:
#
#   * KAN-415 moved `src/lib/invite-text.ts` and `src/lib/beta-access/email.ts`
#     into `src/modules/`. The guard was updated; the prompt was not, so two
#     copy modules were protected by CI and unprotected by the robot.
#   * KAN-473 added `src/modules/*.tsx`. Again the guard only. The autopilot
#     would have read three founder-owned components as fair game.
#
# Neither drift could go red, because nothing in CI can see a routine prompt.
# So the fix is not another checker — it is removing the second copy. The
# autopilot now reads this at runtime instead of restating it, and the guard
# becomes the single source of truth.
#
# ⚠️ THE OUTPUT IS PARSED OUT OF is_protected() ITSELF, not hand-written
# alongside it. That distinction is the whole point: a hand-written
# description is a third copy and would drift exactly like the second one did.
# Add a rule to the function and it appears here with no further edit —
# `tests/scripts/check-ui-copy-ownership.test.js` proves that by adding one.
#
# Contract: line-oriented and stable, because a routine prompt parses it.
#   PROTECTED <glob>     founder-owned; autopilot must not touch
#   CARVE-OUT <glob>     explicitly NOT founder-owned; checked first, wins
# Carve-outs are printed FIRST because that is the order they are evaluated in.
describe_surface() {
  local body
  body="$(sed -n '/^is_protected()/,/^}/p' "$0")"

  echo "# Founder-owned UI/copy surface — KAN-411."
  echo "# Derived from is_protected() in scripts/check-ui-copy-ownership.sh."
  echo "# Do not restate this list anywhere; read it."
  echo "#"
  echo "# CARVE-OUT lines are evaluated FIRST and win over PROTECTED lines."
  echo

  # ⚠️ The extraction must tolerate a TRAILING COMMENT and arbitrary internal
  # whitespace, because the function is written for humans and several rules
  # carry both. The first cut of this anchored on `]] && return N$` and
  # silently emitted 1 carve-out instead of 4, dropping `src/*.css` — a list
  # that LOOKS right while omitting rules is the exact failure mode KAN-474
  # exists to end, so the parser is strict about the shape it matches and the
  # test below pins the counts rather than trusting the output looks sensible.
  extract_rules() {  # $1 = return code to select
    printf '%s\n' "$body" \
      | sed -n "s/^[[:space:]]*\[\[[[:space:]]*\\\$f[[:space:]]*==[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*\]\][[:space:]]*\&\&[[:space:]]*return[[:space:]]*$1[[:space:]]*\(#.*\)\{0,1\}\$/\1/p"
  }

  # `return 1` inside the function = explicitly not protected.
  while IFS= read -r line; do
    [ -n "$line" ] && printf 'CARVE-OUT %s\n' "$line"
  done < <(extract_rules 1)

  # `return 0` = founder-owned.
  while IFS= read -r line; do
    [ -n "$line" ] && printf 'PROTECTED %s\n' "$line"
  done < <(extract_rules 0)
}

if [ "${1:-}" = "--describe" ]; then
  describe_surface
  exit 0
fi

BASE_REF="${BASE_REF:-origin/develop}"
HEAD_REF="${HEAD_REF:-HEAD}"

if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "::warning::check-ui-copy-ownership: base ref '$BASE_REF' not found — cannot compute the diff; skipping (CODEOWNERS still gates every UI/copy path)."
  exit 0
fi
MERGE_BASE="$(git merge-base "$BASE_REF" "$HEAD_REF" 2>/dev/null || true)"
if [ -z "$MERGE_BASE" ]; then
  echo "::warning::check-ui-copy-ownership: no merge-base for ${BASE_REF}..${HEAD_REF} — skipping (CODEOWNERS still gates)."
  exit 0
fi

# Founder-owned UI/copy surface. Non-protected carve-outs are checked FIRST and
# win. In bash [[ == ]] a '*' matches across '/', so 'src/app/*.tsx' catches any
# nested .tsx page/layout/component under src/app.
is_protected() {
  local f="$1"
  # --- explicit NON-protected carve-outs (these win) ---
  [[ $f == src/app/admin/* ]] && return 1     # Luisa-only console behind CF Access
  [[ $f == src/app/api/* ]]   && return 1     # route handlers = logic
  [[ $f == */route.ts ]]      && return 1     # any route handler = logic
  [[ $f == src/middleware.ts ]] && return 1
  # --- named user-facing copy modules ---
  [[ $f == src/modules/dashboard/invite-text.ts ]] && return 0
  [[ $f == src/lib/convene/invites/templates.ts ]] && return 0
  [[ $f == src/lib/convene/invites/sms-templates.ts ]] && return 0
  [[ $f == src/modules/access/beta-access/email.ts ]] && return 0
  [[ $f == src/app/dashboard/profile/affiliation-fields.ts ]] && return 0
  [[ $f == src/app/dashboard/convene/organise/organise-fields.ts ]] && return 0
  # --- design / styling / brand ---
  [[ $f == src/*.css ]] && return 0           # globals.css + any css under src/
  [[ $f == postcss.config.* ]] && return 0
  [[ $f == tailwind.config.* ]] && return 0
  [[ $f == public/lyra-logo* ]] && return 0
  [[ $f == public/lyra-icon-* ]] && return 0
  [[ $f == public/og-image.png ]] && return 0
  [[ $f == public/manifest.webmanifest ]] && return 0
  [[ $f == public/offline.html ]] && return 0
  # --- all page / layout / component TSX under src/app + everything in src/components ---
  [[ $f == src/app/*.tsx ]] && return 0
  [[ $f == src/components/* ]] && return 0
  # --- extracted UI: any TSX under src/modules/ (KAN-473 / KAN-415 D9) ---
  #
  # WHY THIS IS BROAD RATHER THAN NAMED. D9 moved three founder-owned components
  # out of src/app/[slug]/ into src/modules/public-profile/. Measured before the
  # move: all three were FOUNDER-OWNED at the old path and NOT PROTECTED at the
  # new one, because nothing here matched src/modules/ at all. The extraction
  # would therefore have removed them from founder ownership permanently, with
  # NO red build — "matches nothing" is detectable, "matches less than it used
  # to" is not (the same shape as the ^src/lib/ depcruise narrowing in D1).
  #
  # Worse, the `UI-Change-Approved:` trailer authorising the move would have
  # carried it through this very gate, and the move would then have switched the
  # gate off for those files from then on — turning a one-time approval into a
  # standing one.
  #
  # So the rule is stated on the FILE TYPE, not on a module name: src/modules/
  # holds domain logic, and a .tsx there is by definition a rendered component.
  # KAN-415 has D7 and D8 still to come; a named rule would have to be extended
  # by whoever does them, and the failure mode of forgetting is silent. This one
  # covers them by default, and exempting a module is a visible diff here.
  [[ $f == src/modules/*.tsx ]] && return 0
  return 1
}

CHANGED=()
while IFS= read -r _line; do CHANGED+=("$_line"); done < <(git diff --name-only "$MERGE_BASE" "$HEAD_REF")
if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "check-ui-copy-ownership: no changed files in range — OK."
  exit 0
fi

PROTECTED_HITS=()
for f in "${CHANGED[@]}"; do
  [ -z "$f" ] && continue
  if is_protected "$f"; then PROTECTED_HITS+=("$f"); fi
done

if [ "${#PROTECTED_HITS[@]}" -eq 0 ]; then
  echo "check-ui-copy-ownership: no founder-owned UI/copy paths changed — OK."
  exit 0
fi

# A UI/copy change is present → require an approval trailer somewhere in range.
COMMIT_MSGS="$(git log "${MERGE_BASE}..${HEAD_REF}" --format='%B' 2>/dev/null || true)"
TRAILER_RE='^(UI-Change-Approved|UI-Bugfix-Only|UI-No-Visual-Change):[[:space:]]*[A-Z][A-Z0-9]+-[0-9]+'
# here-strings (not pipes) so `set -o pipefail` can't SIGPIPE-fail a match.
if grep -Eq "$TRAILER_RE" <<<"$COMMIT_MSGS"; then
  TRAILER="$(grep -m1 -Eo "$TRAILER_RE" <<<"$COMMIT_MSGS" || true)"
  echo "check-ui-copy-ownership: UI/copy paths changed and an approval trailer is present (${TRAILER}). OK."
  printf '  touched: %s\n' "${PROTECTED_HITS[@]}"
  exit 0
fi

echo "::error::check-ui-copy-ownership: this PR changes founder-owned UI/copy paths but carries no approval trailer."
printf '::error::  founder-owned path changed: %s\n' "${PROTECTED_HITS[@]}"
cat <<'EOF'

The look and text of Lyra's user-facing pages belong to Luisa (CLAUDE.md
"LOOK AND TEXT"; autopilot House rule 9). A change to these paths must be
FOUNDER-INITIATED. Add ONE of these trailers to a commit in this PR:

  UI-Change-Approved:  <JIRA-KEY>  # Luisa-initiated design/copy change
  UI-Bugfix-Only:      <JIRA-KEY>  # fix limited to a text error or rendering error
  UI-No-Visual-Change: <JIRA-KEY>  # touches a protected path but changes NEITHER
                                   # the rendered output NOR any user-visible
                                   # string (a prop threaded through, a type, a
                                   # rename). SEC-152.

Pick the one that is TRUE. Each is a claim someone may later be held to, not a
formality — if none of them describes your change, that is a finding worth
raising rather than a trailer worth guessing.

Label the Jira ticket `ui-approval-required` for the first two. If this really
is not a UI/copy path at all, it may need adding to the carve-out list in this
script — but prefer a trailer: narrowing the surface removes a path from
founder ownership permanently and silently (KAN-473).
EOF
exit 1
