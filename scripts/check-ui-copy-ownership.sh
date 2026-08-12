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
#   * UI-Change-Approved: <JIRA-KEY>  — a Luisa-initiated design/copy change.
#   * UI-Bugfix-Only:     <JIRA-KEY>  — a fix STRICTLY limited to a text error
#                                       (typo/wrong/stale string) or a rendering
#                                       error (blank page, broken layout, styling
#                                       regression), which *restores* the intended
#                                       design rather than changing it.
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
  [[ $f == src/lib/invite-text.ts ]] && return 0
  [[ $f == src/lib/convene/invites/templates.ts ]] && return 0
  [[ $f == src/lib/convene/invites/sms-templates.ts ]] && return 0
  [[ $f == src/lib/beta-access/email.ts ]] && return 0
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
TRAILER_RE='^(UI-Change-Approved|UI-Bugfix-Only):[[:space:]]*[A-Z][A-Z0-9]+-[0-9]+'
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

  UI-Change-Approved: <JIRA-KEY>   # Luisa-initiated design/copy change
  UI-Bugfix-Only:     <JIRA-KEY>   # fix limited to a text error or rendering error

and label the Jira ticket `ui-approval-required`. If this really is not a
UI/copy change, the path may need adding to the carve-out list in this script.
EOF
exit 1
